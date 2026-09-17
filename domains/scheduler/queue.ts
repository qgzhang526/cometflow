import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { TaskPlan } from '../task-plan/types.js';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';

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
  /** 计划里的任务依赖（同 goal 内的任务 id）：前序必须已交付才可调度。 */
  depends_on?: string[];
  /** 未满足的依赖（调度器据此跳过它，界面据此显示「等待 X 交付」）。 */
  blocked_by?: string[];
  /** capability（并发单元用：同一 capability 的任务不并行，见 ADR 0028）。 */
  capability?: string | null;
  /**
   * spec 声明的代码模块边界（由冻结计划带入，与 change 的 `module` 同源）。
   * 装了写保护守卫时，并发排除按它判：module 相等 / 互相包含 / 未声明都要串行（ADR 0028 修订）。
   */
  module?: string | null;
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
  } catch {
    /**
     * 读不到 / 解析不了都按「没有队列」处理。
     *
     * 后者是并发场景的真实故障模式：写队列与读队列可能同时发生，读到半截 JSON 会直接抛
     * SyntaxError（CI 上就撞到过：`Unexpected end of JSON input`）。写入侧已经改成原子写，
     * 这里再兜一层：队列只是**运行时覆盖 + 快照**，退化到"按计划重新推导"永远比让调度器崩掉好。
     */
    return null;
  }
}

export async function writeQueue(projectRoot: string, queue: SchedulerQueue): Promise<string> {
  const filePath = queuePath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  /**
   * **原子写**（ADR 0014 的口径）：并发调度时写队列与读队列会同时发生，
   * 直接 `writeFile` 会让另一侧读到半截 JSON（CI 上就撞到过 `Unexpected end of JSON input`）。
   * rename 在同一文件系统内是原子的，读者看到的永远是"旧的完整内容"或"新的完整内容"。
   */
  await atomicWriteText(filePath, JSON.stringify(queue, null, 2));
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
    depends_on: task.depends_on ?? [],
    capability: task.capability ?? null,
    module: task.module ?? null,
  }));
}

/**
 * 下一条**可调度**的任务：`queued` 且依赖已满足。
 *
 * 依赖用 `blocked_by` 表达（而不是新增一个状态）：状态词表保持 `queued/running/done/failed`，
 * "为什么还没轮到它"是另一个维度，界面可以同时显示两者（既在待办里，又在等前序交付）。
 */
export function nextQueuedTask(queue: SchedulerQueue): QueueTask | null {
  return queue.tasks.find((task) => task.status === 'queued' && (task.blocked_by?.length ?? 0) === 0) ?? null;
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
