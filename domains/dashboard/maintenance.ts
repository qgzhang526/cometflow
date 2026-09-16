import path from 'node:path';
import {
  findOrphanTempFiles,
  removeOrphanTempFiles,
  type OrphanTempFile,
} from '../../platform/fs/atomic-write.js';
import { forceUnlock, inspectLock, type LockRecord } from '../../platform/fs/file-lock.js';
import { applyJobGc, collectJobUsage, planJobGc } from '../server/job-store.js';

/**
 * 维护动作的「预告 → 确认 → 执行」三段式。
 *
 * 三个动作都会删东西（残留的原子写临时文件 / 已结束任务的证据 / 滞留的事务锁），而且删除不可逆。
 * 所以流程被固定成：`collectMaintenancePlan` 只读地算出「将要删什么」→ 界面把这份预告显示给人看，
 * 并把其中的**可比较量**回传 → `apply*` 在执行前重新算一次，与回传值不一致就拒绝。
 *
 * 这样「确认时看到的是 A、执行时删的是 B」不会发生：宁可让人重看一眼，也不静默删错。
 * 注意这里的扫描根与 doctor 完全一致（`.cometflow`），否则「doctor 报 3 个、按钮删 5 个」就说不清了。
 */

/** 与 doctor 同源：孤儿临时文件的扫描根。 */
export function maintenanceTempRoot(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow');
}

/**
 * 预览值与执行时的实际值不一致。
 *
 * `expected` / `actual` 只用于回显（数字或持有者字符串），API 层据此返回 409；
 * 抛出它时**保证什么都没删**——每个 apply* 都是先比对、后动手。
 */
export class StaleMaintenancePreviewError extends Error {
  readonly expected: number | string | null;
  readonly actual: number | string | null;

  constructor(expected: number | string | null, actual: number | string | null, message: string) {
    super(message);
    this.name = 'StaleMaintenancePreviewError';
    this.expected = expected;
    this.actual = actual;
  }
}

export interface MaintenanceTempPlan {
  /** 完整数量：它就是回传给 clean-temp 的 expectedFiles。 */
  count: number;
  totalBytes: number;
  /** 最多 5 条，仅用于确认弹窗展示「将删除什么」；判断数量一律用 count。 */
  sample: Array<{ path: string; size: number }>;
}

export interface MaintenanceJobPlan {
  files: number;
  bytes: number;
  finished: number;
  running: number;
  /** 超出保留窗口、可回收的已结束任务数：它就是回传给 clean-jobs 的 expectedCandidates。 */
  candidates: number;
  reclaimableBytes: number;
}

export interface MaintenanceLockPlan {
  held: boolean;
  stale: boolean;
  reason: string | null;
  /** `pid@host@startedAt`：回传给 force-unlock 的 expectedHolder。 */
  holder: string | null;
  record: LockRecord | null;
}

export interface MaintenancePlan {
  temp: MaintenanceTempPlan;
  jobs: MaintenanceJobPlan;
  lock: MaintenanceLockPlan;
}

/** 持有者身份：pid + host + 起始时间——单文件锁，这三者合起来唯一。 */
export function lockHolderKey(record: Pick<LockRecord, 'pid' | 'host' | 'startedAt'>): string {
  return record.pid + '@' + record.host + '@' + record.startedAt;
}

async function scanTempFiles(projectRoot: string): Promise<OrphanTempFile[]> {
  return findOrphanTempFiles(maintenanceTempRoot(projectRoot));
}

/** 只读预告：三个维护动作各自「将要删什么」。界面据此渲染确认弹窗。 */
export async function collectMaintenancePlan(projectRoot: string): Promise<MaintenancePlan> {
  const [orphans, jobUsage, jobPlan, lock] = await Promise.all([
    scanTempFiles(projectRoot),
    collectJobUsage(projectRoot),
    planJobGc(projectRoot),
    inspectLock(projectRoot),
  ]);

  return {
    temp: {
      count: orphans.length,
      totalBytes: orphans.reduce((sum, file) => sum + file.size, 0),
      sample: orphans.slice(0, 5).map((file) => ({ path: file.path, size: file.size })),
    },
    jobs: {
      files: jobUsage.files,
      bytes: jobUsage.bytes,
      finished: jobUsage.finished,
      running: jobUsage.running,
      candidates: jobPlan.candidates.length,
      reclaimableBytes: jobPlan.reclaimableBytes,
    },
    lock: {
      held: lock.record !== null,
      stale: lock.stale,
      reason: lock.reason,
      holder: lock.record === null ? null : lockHolderKey(lock.record),
      record: lock.record,
    },
  };
}

export interface TempCleanupResult {
  removed: number;
  bytes: number;
  paths: string[];
}

/** 清理残留的原子写临时文件。数量与预告不一致时拒绝，且不删任何文件。 */
export async function applyTempCleanup(
  projectRoot: string,
  expectedFiles: number,
): Promise<TempCleanupResult> {
  const orphans = await scanTempFiles(projectRoot);
  if (orphans.length !== expectedFiles) {
    throw new StaleMaintenancePreviewError(
      expectedFiles,
      orphans.length,
      '残留临时文件数量已变化（预告 ' +
        expectedFiles +
        ' → 实际 ' +
        orphans.length +
        '），未删除任何文件；请刷新后重新确认',
    );
  }
  const paths = await removeOrphanTempFiles(orphans);
  return {
    removed: paths.length,
    bytes: orphans.reduce((sum, file) => sum + file.size, 0),
    paths,
  };
}

export interface JobCleanupResult {
  removed: number;
  bytes: number;
  /** 回收后仍在运行的（永不回收）：回显给界面，确认「没误伤」。 */
  running: number;
}

/**
 * 回收超出保留窗口的任务证据（双阈值：最近 200 条 + 30 天，运行中的永不回收）。
 * 候选数与预告不一致时拒绝，且不删任何文件。
 */
export async function applyJobCleanup(
  projectRoot: string,
  expectedCandidates: number,
): Promise<JobCleanupResult> {
  const plan = await planJobGc(projectRoot);
  if (plan.candidates.length !== expectedCandidates) {
    throw new StaleMaintenancePreviewError(
      expectedCandidates,
      plan.candidates.length,
      '可回收任务数已变化（预告 ' +
        expectedCandidates +
        ' → 实际 ' +
        plan.candidates.length +
        '），未回收任何任务；请刷新后重新确认',
    );
  }
  const cleaned = await applyJobGc(projectRoot, plan);
  return { removed: cleaned.removed, bytes: cleaned.bytes, running: plan.running };
}

export interface ForceUnlockResult {
  removed: boolean;
  holder: string;
}

/**
 * 清理滞留的事务锁。这是三个人工判断里最危险的一个：清错 = 两个进程同时写同一项目。
 * 因此除了「有没有锁」，还要比对**持有者身份**——预告时是 A 的锁、执行时变成 B 的锁，同样拒绝。
 */
export async function applyForceUnlock(
  projectRoot: string,
  expectedHolder: string,
): Promise<ForceUnlockResult> {
  const inspection = await inspectLock(projectRoot);
  if (inspection.record === null) {
    throw new StaleMaintenancePreviewError(
      expectedHolder,
      null,
      '当前没有滞留锁（可能已被其他进程清理），未做任何修改',
    );
  }
  const holder = lockHolderKey(inspection.record);
  if (holder !== expectedHolder) {
    throw new StaleMaintenancePreviewError(
      expectedHolder,
      holder,
      '锁的持有者已变化（预告 ' + expectedHolder + ' → 实际 ' + holder + '），未做任何修改',
    );
  }
  const removed = await forceUnlock(projectRoot);
  return { removed, holder };
}
