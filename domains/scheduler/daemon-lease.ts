import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteJson } from '../../platform/fs/atomic-write.js';
import { ownerTag } from './queue.js';

/**
 * 调度器的**单实例租约**（P4 后续 / C3 前置）：一个项目同时只应该有一个调度器。
 *
 * 为什么需要它：C1 只保证「不会选中同一条任务」，两个 daemon 仍然可以各跑一条任务；
 * 而用户对"无人值守"的心智模型是**一个调度器、它内部并发**。没有这把锁，
 * 「CLI 起一个 + serve 内嵌一个」或"两个终端各起一个"就会变成两个 worker。
 *
 * 形式是租约 + 心跳（不是进程信号）：持有者每 10s 刷新一次 `heartbeat_at`，
 * 超过 `staleAfterMs` 没刷新就视为崩溃遗留，可被接管——与 ADR 0024 的租约语义同源，
 * 也天然支持"换台机器接着跑"。
 */

export const DAEMON_LEASE_SCHEMA = 'cometflow.daemon-lease.v1';
export const DEFAULT_HEARTBEAT_MS = 10_000;
export const DEFAULT_STALE_AFTER_MS = 60_000;

export interface DaemonLeaseRecord {
  schema: typeof DAEMON_LEASE_SCHEMA;
  /** 与队列 owner 同格式：`pid@host`。 */
  owner: string;
  pid: number;
  host: string;
  mode: string;
  agent: string;
  started_at: string;
  heartbeat_at: string;
}

export function daemonLeasePath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'daemon.lease.json');
}

export async function readDaemonLease(projectRoot: string): Promise<DaemonLeaseRecord | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(daemonLeasePath(projectRoot), 'utf8')) as Partial<DaemonLeaseRecord>;
    if (parsed.schema !== DAEMON_LEASE_SCHEMA) return null;
    return parsed as DaemonLeaseRecord;
  } catch {
    return null;
  }
}

export function isLeaseFresh(lease: DaemonLeaseRecord, options: { now?: Date; staleAfterMs?: number } = {}): boolean {
  const now = (options.now ?? new Date()).getTime();
  const heartbeat = Date.parse(lease.heartbeat_at);
  if (Number.isNaN(heartbeat)) return false;
  return now - heartbeat < (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
}

export interface DaemonLeaseHandle {
  record: DaemonLeaseRecord;
  heartbeat: () => Promise<void>;
  release: () => Promise<void>;
}

export interface AcquireLeaseResult {
  acquired: boolean;
  /** 被别人持有时给出持有者，供 CLI/界面显示"谁在跑"。 */
  holder: DaemonLeaseRecord | null;
  lease: DaemonLeaseHandle | null;
}

export interface AcquireLeaseOptions {
  mode: string;
  agent: string;
  now?: Date;
  staleAfterMs?: number;
  heartbeatMs?: number;
}

export async function acquireDaemonLease(
  projectRoot: string,
  options: AcquireLeaseOptions,
): Promise<AcquireLeaseResult> {
  const now = options.now ?? new Date();
  const existing = await readDaemonLease(projectRoot);
  if (existing !== null && isLeaseFresh(existing, options)) {
    return { acquired: false, holder: existing, lease: null };
  }

  const record: DaemonLeaseRecord = {
    schema: DAEMON_LEASE_SCHEMA,
    owner: ownerTag(),
    pid: process.pid,
    host: os.hostname(),
    mode: options.mode,
    agent: options.agent,
    started_at: now.toISOString(),
    heartbeat_at: now.toISOString(),
  };
  const filePath = daemonLeasePath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteJson(filePath, record);

  const write = async (next: DaemonLeaseRecord): Promise<void> => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await atomicWriteJson(filePath, next);
  };
  const lease: DaemonLeaseHandle = {
    record,
    heartbeat: async () => {
      record.heartbeat_at = new Date().toISOString();
      await write(record);
    },
    release: async () => {
      // 只清自己写下的那份：别人接管后不要把它删掉。
      const current = await readDaemonLease(projectRoot);
      if (current !== null && current.owner === record.owner && current.started_at === record.started_at) {
        await fs.rm(filePath, { force: true });
      }
    },
  };

  // 长任务期间也要续租（单任务默认超时 30 分钟，只在轮次间续租会显得"已死"）。
  const timer = setInterval(() => {
    void lease.heartbeat().catch(() => undefined);
  }, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  timer.unref?.();
  const release = lease.release;
  lease.release = async () => {
    clearInterval(timer);
    await release();
  };

  return { acquired: true, holder: null, lease };
}
