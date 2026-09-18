import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../platform/fs/atomic-write.js';
import type { SchedulerQueue } from './queue.js';

/**
 * 调度器的状态投影（`.cometflow/runtime/daemon-state.json`）。
 *
 * 存在的理由只有一个：**让人看得出无人值守到底有没有在工作**（审计 C5）。
 * 在此之前，daemon 除了往 stdout 打日志什么都不留——界面只能显示队列与预算，
 * 答不出「它最后一次决策是什么、为什么没干活、上一次任务成没成」。
 *
 * 它是**投影**不是事实源：队列（queue.json）与预算（budget.json）仍是唯一权威，
 * 这里只记「最近一次决策」这几个字，丢了也不影响调度正确性。
 */

export const DAEMON_STATE_SCHEMA = 'cometflow.daemon-state.v1';

export interface DaemonQueueCounts {
  queued: number;
  running: number;
  done: number;
  failed: number;
}

export interface DaemonDecision {
  /** 本轮是否真的跑了 agent。 */
  ran: boolean;
  /** 人话原因：mode 判定 / 无待办 / 预算耗尽等。 */
  reason: string;
  /** 决策针对的任务 id（没有待办时为 null）。 */
  task: string | null;
}

export interface DaemonLastTask {
  id: string;
  result: 'done' | 'failed';
  elapsedMs: number;
  timedOut: boolean;
  /** 驱动这条任务的 change 名与结论（P4：调度视角要对得上交付账本）。 */
  change?: string | null;
  verdict?: string | null;
  detail?: string | null;
}

/**
 * 本轮**想领但没领成**的任务。
 *
 * 存在的理由是「为什么这条没被领」必须能问出答案：并发下一条任务可能是被 module 归属
 * 或并发单元挡住的（C3–C5），而这些理由过去只出现在 daemon 的 stdout 日志里——
 * 无人值守时没人盯着终端，面板上却只看到"队列里还有 queued"。
 */
export interface DaemonSkip {
  /** 被跳过的任务（`goal:task`）。 */
  task: string;
  reason: 'unit-busy' | 'module-conflict';
  /** 挡住它的那个执行者：module 冲突是 change 名（含人手工开的），单元占用是同单元的任务 id。 */
  holder: string | null;
  /** 候选自己声明的 module（没声明就是 null：归属不可判，按最坏情况独占）。 */
  module: string | null;
  /** 占用者声明的 module。 */
  occupier_module: string | null;
}

export interface DaemonStateRecord {
  schema: typeof DAEMON_STATE_SCHEMA;
  /** daemon 进程的 pid：判断「这台机器上还有没有它在跑」的第一个线索。 */
  pid: number;
  mode: string;
  agent: string;
  /** 已完成的轮次序号。 */
  iteration: number;
  /** 当前所处阶段：started / skipping / ran / stopped。 */
  phase: 'started' | 'skipping' | 'ran' | 'stopped';
  /** 停止原因（phase=stopped 时有值）。 */
  stopped_reason: string | null;
  updated_at: string;
  last_decision: DaemonDecision | null;
  last_task: DaemonLastTask | null;
  /** 本轮被跳过的候选（依赖没满足的不算：那是 blocked_by，队列行上已经写了）。 */
  last_skips: DaemonSkip[];
  queue: DaemonQueueCounts;
  budget: { used_ms: number; total_ms: number; remaining_ms: number | null };
}

export function daemonStatePath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'daemon-state.json');
}

export function countQueue(queue: SchedulerQueue): DaemonQueueCounts {
  const counts: DaemonQueueCounts = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const task of queue.tasks) counts[task.status] += 1;
  return counts;
}

export async function writeDaemonState(
  projectRoot: string,
  record: Omit<DaemonStateRecord, 'schema' | 'updated_at'>,
  options: { now?: Date } = {},
): Promise<string> {
  const filePath = daemonStatePath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteJson(filePath, {
    schema: DAEMON_STATE_SCHEMA,
    ...record,
    updated_at: (options.now ?? new Date()).toISOString(),
  } satisfies DaemonStateRecord);
  return filePath;
}

/** 读不到（从未跑过 daemon）或内容不可解析时返回 null——界面据此显示「从未跑过」。 */
export async function readDaemonState(projectRoot: string): Promise<DaemonStateRecord | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(daemonStatePath(projectRoot), 'utf8')) as Partial<DaemonStateRecord>;
    if (parsed.schema !== DAEMON_STATE_SCHEMA) return null;
    return parsed as DaemonStateRecord;
  } catch {
    return null;
  }
}
