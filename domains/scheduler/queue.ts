import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { TaskPlan } from '../task-plan/types.js';

export type QueueTaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface QueueTask {
  id: string;
  goal: string;
  task: string;
  title: string;
  status: QueueTaskStatus;
  attempts: number;
  updated_at: string;
  /**
   * 租约：置为 running 时写下到期时间与持有者。
   * 崩溃后没人续租，下一次启动或循环就能凭它把任务收回，而不是永久卡在 running。
   */
  lease_until?: string | null;
  owner?: string | null;
  /** 驱动这条任务的 change 名（P4：change 名由 `goal-task` 派生，确定性可对账）。 */
  change?: string | null;
  /** 最近一次驱动结论（delivered / agent-failed / verify-failed / spec-conflict / error）。 */
  verdict?: string | null;
  /**
   * 任务的契约形态（推导自计划）：无人值守前置检查要用它判断
   * 「这条任务的验收能不能自动判定」，以及在冻结版本里找 acceptance。
   */
  kind?: string | null;
  spec_ref?: string | null;
  spec_anchor?: string | null;
  spec_hash?: string | null;
}

export interface SchedulerQueue {
  schema: 'cometflow.queue.v1';
  tasks: QueueTask[];
}

export function queuePath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'queue.json');
}

export async function readQueue(projectRoot: string): Promise<SchedulerQueue | null> {
  try {
    const source = await fs.readFile(queuePath(projectRoot), "utf8");
    return JSON.parse(source) as SchedulerQueue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeQueue(projectRoot: string, queue: SchedulerQueue): Promise<string> {
  const filePath = queuePath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(queue, null, 2));
  return filePath;
}

export async function buildQueueFromPlans(projectRoot: string): Promise<SchedulerQueue> {
  const plansDir = path.join(projectRoot, '.cometflow', 'plans');
  let entries: string[];
  try {
    entries = await fs.readdir(plansDir);
  } catch {
    entries = [];
  }

  const tasks: QueueTask[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.task-plan.yaml')) continue;
    try {
      const source = await fs.readFile(path.join(plansDir, entry), 'utf8');
      const plan = parse(source) as TaskPlan;
      tasks.push(...queueFromPlan(plan));
    } catch {
      // ignore unreadable generated plan files
    }
  }
  return { schema: 'cometflow.queue.v1', tasks };
}

export function queueFromPlan(plan: TaskPlan): QueueTask[] {
  const now = new Date().toISOString();
  return plan.tasks.filter((task) => task.status === 'frozen' || task.status === 'approved').map((task) => ({
    id: plan.goal + ":" + task.id,
    goal: plan.goal,
    task: task.id,
    title: task.title,
    status: 'queued' as const,
    attempts: 0,
    updated_at: now,
    kind: task.kind,
    spec_ref: task.spec_ref ?? null,
    spec_anchor: task.spec_anchor ?? null,
    spec_hash: task.spec_hash ?? null,
  }));
}

export function nextQueuedTask(queue: SchedulerQueue): QueueTask | null {
  return queue.tasks.find((task) => task.status === "queued") ?? null;
}

export function markQueueTask(
  queue: SchedulerQueue,
  taskId: string,
  status: QueueTaskStatus,
  options: { leaseMs?: number; now?: Date; change?: string | null; verdict?: string | null } = {},
): SchedulerQueue {
  const now = options.now ?? new Date();
  return {
    ...queue,
    tasks: queue.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            status,
            attempts: status === "running" ? task.attempts + 1 : task.attempts,
            updated_at: now.toISOString(),
            lease_until:
              status === 'running'
                ? new Date(now.getTime() + (options.leaseMs ?? DEFAULT_LEASE_MS)).toISOString()
                : null,
            owner: status === 'running' ? ownerTag() : null,
            // change / verdict 是「调度视角 → 交付视角」的关联（P4 S4）：
            // 面板靠它把队列行与 change 账本对上，不用另开一次推导。
            ...(options.change === undefined ? {} : { change: options.change }),
            ...(options.verdict === undefined ? {} : { verdict: options.verdict }),
          }
        : task,
    ),
  };
}

/** 默认租约时长：要大于单任务超时，否则正常执行中就会被判定为过期。 */
export const DEFAULT_LEASE_MS = 40 * 60_000;

export function ownerTag(): string {
  return process.pid + '@' + (process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'unknown');
}

export interface ReclaimResult {
  queue: SchedulerQueue;
  reclaimed: QueueTask[];
  exhausted: QueueTask[];
}

/**
 * 回收过期租约。
 *
 * 语义是「至少一次」：被回收的任务会重新排队并 attempts+1；达到上限的直接标 failed 交人工，
 * 不再自动重试——否则一个必然失败的任务会无限占用队列。
 */
export function reclaimExpiredLeases(
  queue: SchedulerQueue,
  options: { now?: Date; maxAttempts?: number } = {},
): ReclaimResult {
  const now = (options.now ?? new Date()).getTime();
  const maxAttempts = options.maxAttempts ?? 3;
  const reclaimed: QueueTask[] = [];
  const exhausted: QueueTask[] = [];

  const tasks = queue.tasks.map((task) => {
    if (task.status !== 'running' || !task.lease_until) return task;
    if (Date.parse(task.lease_until) > now) return task;

    const gaveUp = task.attempts >= maxAttempts;
    const next: QueueTask = {
      ...task,
      status: gaveUp ? 'failed' : 'queued',
      // attempts 的口径是「启动过几次」，增量只发生在置为 running 时；
      // 回收不再 +1，否则一次崩溃会被记成两次尝试。
      attempts: task.attempts,
      lease_until: null,
      owner: null,
      updated_at: new Date(now).toISOString(),
    };
    if (gaveUp) exhausted.push(next);
    else reclaimed.push(next);
    return next;
  });

  return { queue: { ...queue, tasks }, reclaimed, exhausted };
}
