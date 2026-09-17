import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteText } from './atomic-write.js';

/**
 * 多文件事务锁（ADR 0021 的第二层）。
 *
 * 单文件写入用 CAS 就够了；但「一次动作要改多个文件」（归档应用提案 spec、冻结计划、恢复历史版本）
 * 需要让另一个进程整段等待。实现刻意不依赖 OS advisory lock：用「创建即独占」的文件 + TTL，
 * 这样 Windows / NFS 语义一致，进程被杀也能靠 TTL 收敛。
 */

export interface LockRecord {
  pid: number;
  host: string;
  startedAt: string;
  action: string;
  ttlMs: number;
}

export const DEFAULT_LOCK_TTL_MS = 120_000;

export function lockPath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'lock');
}

/**
 * 锁的作用域（可选）。
 *
 * 默认（不传）仍然是项目级一把锁——冻结计划、归档、恢复版本这些"一次要改多个文件"的动作继续用它。
 * 但**并发执行 change** 需要更细的粒度：两个不同的 change 各改自己的工作区，不该互相排队。
 * 传了 scope 就落到 `runtime/locks/<scope>.lock`，互不打扰（P4/C3，ADR 0028）。
 */
export function scopedLockPath(projectRoot: string, scope?: string): string {
  if (scope === undefined || scope === '') return lockPath(projectRoot);
  const safe = scope.replace(/[^A-Za-z0-9._-]/gu, '_');
  return path.join(projectRoot, '.cometflow', 'runtime', 'locks', safe + '.lock');
}

export async function readLock(projectRoot: string, options: { scope?: string } = {}): Promise<LockRecord | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(scopedLockPath(projectRoot, options.scope), 'utf8')) as LockRecord;
    return typeof parsed.startedAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** 同主机才看 pid 存活；跨主机只能靠 TTL。 */
function processAlive(record: LockRecord): boolean {
  if (record.host !== os.hostname()) return true;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface LockInspection {
  record: LockRecord | null;
  stale: boolean;
  reason: string | null;
}

export async function inspectLock(
  projectRoot: string,
  options: { now?: Date; ttlMs?: number; scope?: string } = {},
): Promise<LockInspection> {
  const record = await readLock(projectRoot, { scope: options.scope });
  if (record === null) return { record: null, stale: false, reason: null };
  const now = (options.now ?? new Date()).getTime();
  const started = new Date(record.startedAt).getTime();
  const ttl = options.ttlMs ?? record.ttlMs ?? DEFAULT_LOCK_TTL_MS;
  if (Number.isNaN(started)) return { record, stale: true, reason: 'invalid-startedAt' };
  if (now - started > ttl) return { record, stale: true, reason: 'ttl-expired' };
  if (!processAlive(record)) return { record, stale: true, reason: 'holder-process-gone' };
  return { record, stale: false, reason: null };
}

export class LockHeldError extends Error {
  readonly record: LockRecord;

  constructor(record: LockRecord) {
    super(
      '另一个进程正在执行 ' +
        record.action +
        '（pid ' +
        record.pid +
        '@' +
        record.host +
        '，started ' +
        record.startedAt +
        '）：请等它结束后重试，确认它已死可用 cometflow doctor . --force-unlock 清理',
    );
    this.name = 'LockHeldError';
    this.record = record;
  }
}

export interface AcquiredLock {
  record: LockRecord;
  release: () => Promise<void>;
}

/**
 * 取锁；已被占用时立即失败（不排队、不等待）——排队会把「另一个进程在动」变成隐性阻塞。
 * 陈旧锁（TTL 过期或持有进程已死）会自动接管。
 */
export async function acquireLock(
  projectRoot: string,
  action: string,
  options: { ttlMs?: number; now?: Date; scope?: string } = {},
): Promise<AcquiredLock> {
  const target = scopedLockPath(projectRoot, options.scope);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const record: LockRecord = {
    pid: process.pid,
    host: os.hostname(),
    startedAt: (options.now ?? new Date()).toISOString(),
    action,
    ttlMs: options.ttlMs ?? DEFAULT_LOCK_TTL_MS,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(target, 'wx');
      try {
        await handle.writeFile(JSON.stringify(record, null, 2));
        await handle.sync();
      } finally {
        await handle.close();
      }
      return {
        record,
        release: async () => {
          const current = await readLock(projectRoot, { scope: options.scope });
          // 只释放自己持有的锁：接管过陈旧锁的进程不能把新持有者的锁删掉。
          if (current !== null && current.pid === record.pid && current.startedAt === record.startedAt) {
            await fs.rm(target, { force: true }).catch(() => undefined);
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const inspection = await inspectLock(projectRoot, options);
      if (inspection.record === null) continue;
      if (!inspection.stale) throw new LockHeldError(inspection.record);
      // 陈旧：接管（覆盖写），下一轮循环会重新尝试独占创建。
      await atomicWriteText(target, JSON.stringify(record, null, 2));
      return {
        record,
        release: async () => {
          const current = await readLock(projectRoot, { scope: options.scope });
          if (current !== null && current.pid === record.pid && current.startedAt === record.startedAt) {
            await fs.rm(target, { force: true }).catch(() => undefined);
          }
        },
      };
    }
  }
  throw new Error('failed to acquire lock at ' + target);
}

export async function forceUnlock(projectRoot: string): Promise<boolean> {
  const inspection = await inspectLock(projectRoot);
  if (inspection.record === null) return false;
  await fs.rm(lockPath(projectRoot), { force: true });
  return true;
}
