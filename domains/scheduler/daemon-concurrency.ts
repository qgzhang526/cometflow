import { HOOK_PLATFORMS, hookStatus } from '../guard/hook-install.js';
import type { QueueTask } from './queue.js';

/**
 * 并发准入、并发单元与**模块级排除**（ADR 0028 及两轮修订的执行部分）。
 *
 * 两条任务能不能同时在跑，判据有三条：
 * 1. **不同并发单元**（`spec_ref`，起草类回退到 capability）——同一份契约下的任务共享
 *    spec 与 module，并行改同一块代码是必然冲突，不是概率问题；
 * 2. **写保护守卫的归属无歧义**——装了守卫时，并发单元从 `spec_ref` 换成 **module**：
 *    module 相等（两个 change 都写 src/api）或互相包含（src vs src/api）时，路径落在谁的
 *    module 里是歧义的，守卫会回落到 current-change 指针；而指针在并发下只指向"最后创建的
 *    change"，不是"正在写的 change"，所以这种组合必须串行；
 * 3. **module 已声明**——没声明 module 的任务在守卫在位时归属不可判，按最坏情况独占跑。
 *
 * 第 2、3 条不再表现为"拒绝启动"，而是**领取时的排除**：冲突的候选跳过、让后面的候选先跑
 * （`nextClaimableTask`），于是"同一个 module 的任务串行、不同 module 的任务并行"是同一个
 * 调度器的正常形态，而不是一开一关的二选一。
 */

/**
 * 并发单元：capability spec。
 *
 * 起草类任务（spec-authoring）没有 `spec_ref`，用它的 capability 当单元——
 * 否则同一个 capability 的多个起草任务会被当成不同单元并行跑。
 */
export function concurrencyUnit(task: Pick<QueueTask, 'spec_ref' | 'capability' | 'task'>): string {
  if (task.spec_ref !== null && task.spec_ref !== undefined && task.spec_ref !== '') return task.spec_ref;
  return 'capability:' + (task.capability ?? task.task);
}

export interface GuardStatus {
  installed: boolean;
  platforms: string[];
}

/** 有没有装写保护守卫（只看「支持且已安装」的平台，不把「不支持」当安装）。 */
export async function guardStatus(projectRoot: string): Promise<GuardStatus> {
  const platforms: string[] = [];
  for (const platform of HOOK_PLATFORMS) {
    try {
      const status = await hookStatus(projectRoot, platform);
      if (status.supported && status.installed) platforms.push(platform);
    } catch {
      // 探测失败按「没装」处理：并发准入不该因为探针异常而永久关闭。
    }
  }
  return { installed: platforms.length > 0, platforms };
}

export interface ConcurrencyGate {
  /** 并发单元：没装守卫时是 `spec-ref`，装了守卫时是 `module`（额外做模块级排除）。 */
  unit: 'spec-ref' | 'module';
  reason: string;
}

/**
 * 并发准入（判据 1 之外的场景判定）。
 *
 * 这里**不再拒绝** `--concurrency > 1`：装了守卫的项目也能并发，守卫的归属歧义由领取时的
 * 模块级排除解决（串行是效果，不是拒绝启动）。返回值告诉调度器用哪个并发单元、
 * 以及哪些任务会因此退化成串行——这是给人看的解释，不是门槛。
 */
export async function checkConcurrencyGate(projectRoot: string, requested: number): Promise<ConcurrencyGate> {
  if (requested <= 1) return { unit: 'spec-ref', reason: 'concurrency=1' };
  const guard = await guardStatus(projectRoot);
  if (!guard.installed) return { unit: 'spec-ref', reason: '没装写保护守卫：并发单元 = capability spec（同一 spec_ref 不并行）' };

  /**
   * 装了守卫：并发单元换成 module（守卫先按 module 判写入归属，ADR 0028 的守卫扩容）。
   * 领不到的候选（module 相等 / 互相包含 / 没声明）会被跳过并留一条日志，其余照跑。
   */
  const modules = await pendingImplementationModules(projectRoot);
  const undeclared = modules.filter((entry) => entry.module === null).map((entry) => entry.task);
  return {
    unit: 'module',
    reason:
      '装了写保护守卫（' +
      guard.platforms.join(', ') +
      '）：并发单元 = module 归属，module 相等/互相包含/未声明的任务串行' +
      (undeclared.length === 0 ? '' : '；没声明 module 的任务：' + undeclared.join(', ')),
  };
}

/**
 * 待办实现任务的 module。
 *
 * 取值口径与 `createChangeFromTask` 一致：用**冻结计划里的 `module`**（它由 spec front-matter
 * 写入、`plan validate` 校验过），因为 change 的 module 就是这个值——守卫看到的也是它。
 * 没有（老计划 / spec 没声明）记 null，表示"归属不可判"。
 */
export async function pendingImplementationModules(
  projectRoot: string,
): Promise<Array<{ task: string; module: string | null }>> {
  const { mergeTodoView } = await import('./daemon-todo.js');
  const view = await mergeTodoView(projectRoot);
  const result: Array<{ task: string; module: string | null }> = [];
  for (const task of view.tasks) {
    if (task.status !== 'queued' || task.delivered) continue;
    if (task.kind === 'spec-authoring' || !task.spec_ref) continue;
    result.push({ task: task.goal + ':' + task.task, module: task.module ?? null });
  }
  return result;
}

/**
 * 两个 module 能不能同时开工。
 *
 * 判据是"路径归属是否唯一"：`a === b` 时同一条路径落在两个 module 里；互相包含时嵌套那部分
 * 落在两个 module 里；任一侧没声明 module 时归属无从判断。三种情况都算冲突（串行）。
 */
export function modulesConflict(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true;
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

/**
 * 已被占用的 module：在飞的 change 声明的写入边界。
 *
 * `change` 是占用者的 change 名——候选人自己的 change 不算冲突（那是"续作自己的活"，不是并发）。
 */
export interface OccupiedModule {
  change: string;
  module: string | null;
}

export interface ClaimContext {
  /** 正在跑的并发单元（capability spec）：同一单元不并行。 */
  activeUnits: ReadonlySet<string>;
  /**
   * 已占用的 module。**只有装了守卫时才传**：模块级排除是为了让守卫的归属判定无歧义，
   * 没装守卫的项目继续按 `spec_ref` 去重（不额外牺牲吞吐）。
   */
  occupied?: readonly OccupiedModule[];
  /** 任务声明的 module；缺省视为 null（未声明）。 */
  moduleOf?: (task: QueueTask) => string | null;
  /** 任务对应的 change 名（用来把"自己的 change"从占用集合里排除）。 */
  changeOf?: (task: QueueTask) => string;
}

export interface ClaimSkip {
  task: QueueTask;
  reason: 'unit-busy' | 'module-conflict';
  /** module 冲突时的占用者，日志与状态投影据此说清"在等谁"。 */
  occupier?: OccupiedModule;
}

export type ClaimSelection =
  | { kind: 'claimable'; task: QueueTask }
  /** 队列里没有 `queued`（或全在等依赖）的任务。 */
  | { kind: 'none' }
  /** 有任务，但这一轮谁也领不了：单元被占、或 module 归属有冲突。 */
  | { kind: 'waiting'; skipped: ClaimSkip[] };

/** 这条任务的 module 和某个在飞 change 的 module 是否冲突（自己的 change 除外）。 */
export function moduleConflictFor(task: QueueTask, context: ClaimContext): OccupiedModule | null {
  const occupied = context.occupied;
  if (occupied === undefined || occupied.length === 0) return null;
  const own = context.changeOf?.(task);
  const module = context.moduleOf?.(task) ?? null;
  for (const entry of occupied) {
    if (own !== undefined && entry.change === own) continue;
    if (modulesConflict(module, entry.module)) return entry;
  }
  return null;
}

/**
 * 选下一条**可领取**的任务：`queued` + 依赖已满足 + 并发单元没被占用 + module 归属无冲突。
 *
 * 与 `nextQueuedTask` 的区别是后两条：它看不到"哪些单元正在跑 / 哪些 module 已被占用"，
 * 那些是调度器侧的事实（内存槽位 + change 账本），由调用方传进来。
 *
 * **跳过而不是卡住**：第一条候选被占用时继续往后看——同 module 的任务串行、不同 module 的
 * 任务并行，靠的就是这里"跳过它、先跑别人的"。
 */
export function nextClaimableTask(
  tasks: readonly QueueTask[],
  context: ClaimContext,
): ClaimSelection {
  const skipped: ClaimSkip[] = [];
  for (const task of tasks) {
    if (task.status !== 'queued' || (task.blocked_by?.length ?? 0) > 0) continue;
    if (context.activeUnits.has(concurrencyUnit(task))) {
      skipped.push({ task, reason: 'unit-busy' });
      continue;
    }
    const occupier = moduleConflictFor(task, context);
    if (occupier !== null) {
      skipped.push({ task, reason: 'module-conflict', occupier });
      continue;
    }
    return { kind: 'claimable', task };
  }
  return skipped.length === 0 ? { kind: 'none' } : { kind: 'waiting', skipped };
}
