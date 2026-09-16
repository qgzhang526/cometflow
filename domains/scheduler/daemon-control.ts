import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../platform/fs/atomic-write.js';

/**
 * daemon 的控制语义（P4 / S4）：**进程由 CLI 持有，控制走文件**。
 *
 * 为什么不干脆让界面去启停进程：那意味着 serve/浏览器成为进程主人——日志去哪儿、崩了谁负责、
 * 换台机器 pid 还有效吗，全都没答案。控制文件把「谁持有进程」和「谁能发指令」拆开：
 * `daemon start` 仍然是唯一的 spawn 点，pause / resume / stop 只写一个文件，
 * 循环每轮读它。于是界面可以「可控」，但不必拥有进程。
 */

export const DAEMON_CONTROL_SCHEMA = 'cometflow.daemon-control.v1';

export type DaemonControlAction = 'pause' | 'resume' | 'stop';

export interface DaemonControlRecord {
  schema: typeof DAEMON_CONTROL_SCHEMA;
  /** 当前生效的动作：pause 会一直生效直到 resume/stop；resume/stop 被消费后回落到 idle。 */
  action: DaemonControlAction | 'idle';
  requested_at: string;
  /** 谁发的（CLI / web / 具体用户），只用于解释「谁按的」。 */
  requested_by: string;
}

export function daemonControlPath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'daemon.control.json');
}

export async function readDaemonControl(projectRoot: string): Promise<DaemonControlRecord | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(daemonControlPath(projectRoot), 'utf8')) as Partial<DaemonControlRecord>;
    if (parsed.schema !== DAEMON_CONTROL_SCHEMA) return null;
    return parsed as DaemonControlRecord;
  } catch {
    // 没有控制文件 = 正常运行；坏文件同样按「没有指令」处理，不让它把 daemon 卡死。
    return null;
  }
}

export async function writeDaemonControl(
  projectRoot: string,
  action: DaemonControlAction,
  options: { by?: string; now?: Date } = {},
): Promise<DaemonControlRecord> {
  const record: DaemonControlRecord = {
    schema: DAEMON_CONTROL_SCHEMA,
    action,
    requested_at: (options.now ?? new Date()).toISOString(),
    requested_by: options.by ?? 'cli',
  };
  const filePath = daemonControlPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteJson(filePath, record);
  return record;
}

/** 一次性动作被消费后回落到 idle：否则下一次 `daemon start` 会立刻又停。 */
export async function clearDaemonControl(projectRoot: string, options: { now?: Date } = {}): Promise<void> {
  const filePath = daemonControlPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteJson(filePath, {
    schema: DAEMON_CONTROL_SCHEMA,
    action: 'idle',
    requested_at: (options.now ?? new Date()).toISOString(),
    requested_by: 'daemon',
  } satisfies DaemonControlRecord);
}
