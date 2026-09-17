import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parse } from 'yaml';
import { buildQueueFromPlans, queueFromPlan, readQueue, writeQueue } from './queue.js';
import type { QueueTask, SchedulerQueue } from './queue.js';
import { listChangeStates } from '../workflow/change-list.js';
import type { TaskPlan } from '../task-plan/types.js';
import { changeNameForTask } from './daemon-run-change.js';
import { compareGoals, readScheduleOrder } from '../goal/schedule-order.js';
import type { ScheduleOrder } from '../goal/schedule-order.js';

/**
 * 待办清单的**唯一推导规则**（P4 / S3）：
 *
 *   待办 = plans 里 frozen/approved 的任务
 *          减去已有归档 change 的 (goal, task)   ← 「交付过」由 change 账本回答
 *          叠加运行时覆盖（running 租约 / attempts / 上次结论）← 只有这部分不可派生
 *
 * 在它之前，`queue.json` 是事实源：跑过一次的任务永远不再重跑（除非手删文件），
 * 而计划侧与 change 侧各有一本账回答「做完没有」。现在「做完没有」只有一个出处。
 *
 * `queue.json` 的角色随之改变：它是**运行时覆盖 + 上次快照**，不再决定「该不该跑」。
 */

export interface TodoEntry extends QueueTask {
  /** 交付视角：这条任务是否已有归档 change。 */
  delivered: boolean;
  /** 该任务的结论来自哪里——界面据此区分「交付过」与「只是跑过」。 */
  source: 'derived' | 'overlay' | 'delivered';
}

export interface TodoView {
  /** 合并后的完整视图（面板与状态投影都用它）。 */
  tasks: TodoEntry[];
  /** 本次由事实推导出来的部分（不含运行时覆盖）。 */
  derived: QueueTask[];
  /** 运行时覆盖（`queue.json` 里的非派生行；没有文件时为 null）。 */
  overlay: SchedulerQueue | null;
  /**
   * 本次推导用的 goal 级调度顺序（ADR 0029）：显式清单在前、其余按编号兜底。
   * 界面据此回答「为什么它先跑」——顺序属于推导，不属于运行时覆盖。
   */
  order: ScheduleOrder;
}

async function readPlans(projectRoot: string): Promise<TaskPlan[]> {
  const dir = path.join(projectRoot, '.cometflow', 'plans');
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const plans: TaskPlan[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.task-plan.yaml')) continue;
    try {
      plans.push(parse(await fs.readFile(path.join(dir, entry), 'utf8')) as TaskPlan);
    } catch {
      // 坏计划不该让推导整体失败：跳过，其余照常。
    }
  }
  return plans;
}

/** 已交付的 `(goal, task)` → change 名。归档是唯一判据。 */
export async function deliveredTasks(projectRoot: string): Promise<Map<string, string>> {
  const delivered = new Map<string, string>();
  for (const state of await listChangeStates(projectRoot)) {
    if (!state.archived) continue;
    delivered.set(state.goal + ':' + state.task, state.name);
  }
  return delivered;
}

/**
 * 未归档但已存在的 change：`(goal, task)` → change 名。
 *
 * 用途是**不重复干活**：同一个任务上已经有一个活的 change 时，daemon 必须让开。
 * 但要让开给谁，取决于名字——
 * - 名字等于 daemon 的确定性命名（`goal-task`）：那是它自己上次没跑完的活，**继续做**（崩溃恢复）；
 * - 别的名字：那是人（或另一条通道）正在做的，daemon 只标记「在飞」，不碰它。
 */
export async function inFlightTasks(projectRoot: string): Promise<Map<string, string>> {
  const inFlight = new Map<string, string>();
  for (const state of await listChangeStates(projectRoot)) {
    if (state.archived) continue;
    inFlight.set(state.goal + ':' + state.task, state.name);
  }
  return inFlight;
}

export async function deriveTodoList(projectRoot: string): Promise<QueueTask[]> {
  return deriveTodoListWith(projectRoot, await readScheduleOrder(projectRoot));
}

/**
 * 按给定顺序推导待办（顺序读一次、用一次）。
 *
 * 顺序的判据是 goal（ADR 0029）：清单里列出的按位置，没列出的按编号升序排在后面。
 * 同一个 goal 内部保持计划里的任务顺序。
 */
async function deriveTodoListWith(projectRoot: string, order: ScheduleOrder): Promise<QueueTask[]> {
  const plans = await readPlans(projectRoot);
  plans.sort((left, right) => compareGoals(left.goal, right.goal, order));
  const tasks: QueueTask[] = [];
  for (const plan of plans) {
    tasks.push(...queueFromPlan(plan));
  }
  return tasks;
}

export async function mergeTodoView(projectRoot: string): Promise<TodoView> {
  const order = await readScheduleOrder(projectRoot);
  const [derived, overlay, delivered, inFlight] = await Promise.all([
    deriveTodoListWith(projectRoot, order),
    readQueue(projectRoot),
    deliveredTasks(projectRoot),
    inFlightTasks(projectRoot),
  ]);

  const overlayById = new Map((overlay?.tasks ?? []).map((task) => [task.goal + ':' + task.task, task]));
  const merged: TodoEntry[] = [];

  for (const task of derived) {
    const key = task.goal + ':' + task.task;
    const runtime = overlayById.get(key);
    const archived = delivered.get(key);
    /**
     * 依赖（C2）：`depends_on` 里的任务必须**已交付**（有归档 change）才轮到它。
     * 计划里的依赖是同 goal 内的任务 id，所以这里按 `goal:task` 判定。
     */
    const blockedBy = (task.depends_on ?? []).filter((id) => !delivered.has(task.goal + ':' + id));
    if (archived !== undefined) {
      // 交付由账本定义，但「试了几次、什么时候动的」仍是运行时事实——保留它，
      // 否则交付记录里看不到「这条其实重试过 N 次」。
      merged.push({
        ...task,
        ...(runtime === undefined ? {} : { attempts: runtime.attempts, updated_at: runtime.updated_at }),
        status: 'done',
        change: archived,
        verdict: 'delivered',
        delivered: true,
        source: 'delivered',
      });
      overlayById.delete(key);
      continue;
    }
    if (runtime !== undefined && runtime.status !== 'queued') {
      // 运行时的事实优先于「推导出待办」：正在跑的不能被重复排队，失败的保留尝试次数。
      merged.push({ ...task, ...runtime, blocked_by: blockedBy, delivered: false, source: 'overlay' });
      continue;
    }
    /**
     * 即便是 `queued`（失败后重试中），`attempts` / `updated_at` / `verdict` 也是运行时事实：
     * 推导不知道「这条已经试过几次」。少了这几行，重试计数每轮被清零，尝试上限永远到不了——
     * 一个必然失败的任务会被无限重跑（实测踩到过）。
     */
    const carried =
      runtime === undefined
        ? {}
        : { attempts: runtime.attempts, updated_at: runtime.updated_at, verdict: runtime.verdict ?? null };
    const claimed = inFlight.get(key);
    if (claimed !== undefined && claimed !== changeNameForTask(task.goal, task.task)) {
      // 有人（或另一条通道）正在这个任务上干活：标记在飞，daemon 让开，别让两个 agent 改同一块代码。
      merged.push({
        ...task,
        ...carried,
        blocked_by: blockedBy,
        status: 'running',
        change: claimed,
        verdict: 'in-flight',
        delivered: false,
        source: 'overlay',
        // 刻意不给租约：它不是 daemon 的租约，不该被回收逻辑当成「崩溃遗留」抢回来。
        lease_until: null,
        owner: 'external-change',
      });
      overlayById.delete(key);
      continue;
    }
    // daemon 自己上次没跑完的 change（确定性命名）：保持待办，下一轮由驱动按 phase 续作。
    merged.push({
      ...task,
      ...carried,
      blocked_by: blockedBy,
      change: claimed ?? task.change ?? null,
      delivered: false,
      source: 'derived',
    });
    overlayById.delete(key);
  }

  // 推导里已经没有、但运行时记录还留着的行（计划被取消 / 老路径跑过的 legacy 记录）：保留，不重跑。
  for (const orphan of overlayById.values()) {
    merged.push({ ...orphan, delivered: orphan.verdict === 'delivered', source: 'overlay' });
  }

  return { tasks: merged, derived, overlay, order };
}

/**
 * `rebuild`：按事实重算待办，**保留**运行时覆盖（含老路径留下的 legacy `done`）。
 *
 * 这是迁移期的语义：2048 那类「agent 直接跑出来、没有 change 目录」的任务不会被重新排队。
 */
export async function rebuildQueue(projectRoot: string): Promise<TodoView> {
  const view = await mergeTodoView(projectRoot);
  await writeQueue(projectRoot, { schema: 'cometflow.queue.v1', tasks: view.tasks });
  return view;
}

/**
 * `reset`：清掉运行时覆盖，**显式要求全部重跑**（已交付的仍由 change 账本标 done）。
 *
 * 与 `rebuild` 的区别就是这一句：legacy 的 `done` 会被丢掉，于是那些任务重新进入待办。
 */
export async function resetQueue(projectRoot: string): Promise<TodoView> {
  const order = await readScheduleOrder(projectRoot);
  const derived = await deriveTodoListWith(projectRoot, order);
  const delivered = await deliveredTasks(projectRoot);
  const tasks: TodoEntry[] = derived.map((task) => {
    const archived = delivered.get(task.goal + ':' + task.task);
    // reset 也保留依赖关系：重跑不等于无视前后顺序。
    const blockedBy = (task.depends_on ?? []).filter((id) => !delivered.has(task.goal + ':' + id));
    return archived === undefined
      ? { ...task, blocked_by: blockedBy, attempts: 0, delivered: false, source: 'derived' as const }
      : {
          ...task,
          blocked_by: blockedBy,
          status: 'done' as const,
          attempts: 0,
          change: archived,
          verdict: 'delivered',
          delivered: true,
          source: 'delivered' as const,
        };
  });
  await writeQueue(projectRoot, { schema: 'cometflow.queue.v1', tasks });
  return { tasks, derived, overlay: null, order };
}

/** 兼容旧入口：没跑过 daemon 时按计划推导（保留给既有调用方）。 */
export async function deriveQueueCompat(projectRoot: string): Promise<SchedulerQueue> {
  return buildQueueFromPlans(projectRoot);
}

/**
 * `retry`：把**单条**任务重新排队（S3 之后的细粒度恢复手段）。
 *
 * 动机是补掉粗粒度：daemon 因「需人工介入」停机后，那条任务在队列里是 `failed`，
 * 而 `reset` 会把所有任务的覆盖与 attempts 一起清掉——修一个问题却要重置整个队列。
 * 这里只动一条：其余任务的 running/失败结论与尝试次数原样保留。
 *
 * 已交付（有归档 change）的任务不会被重排：要重跑它得显式新开一个 change 承载同一任务。
 */
export async function retryQueueTask(
  projectRoot: string,
  taskRef: string,
  options: { attempts?: number; now?: Date } = {},
): Promise<{ view: TodoView; retried: boolean; reason: string }> {
  const view = await mergeTodoView(projectRoot);
  const target = view.tasks.find((task) => task.id === taskRef || task.goal + ':' + task.task === taskRef);
  if (target === undefined) {
    return { view, retried: false, reason: '队列里没有这条任务：' + taskRef };
  }
  if (target.delivered) {
    return { view, retried: false, reason: target.id + ' 已交付（有归档 change）；要重跑请新开一个 change 承载同一任务' };
  }

  const now = (options.now ?? new Date()).toISOString();
  const tasks: TodoEntry[] = view.tasks.map((task) =>
    task.id === target.id
      ? {
          ...task,
          status: 'queued' as const,
          attempts: options.attempts ?? 0,
          lease_until: null,
          owner: null,
          verdict: null,
          updated_at: now,
        }
      : task,
  );
  await writeQueue(projectRoot, { schema: 'cometflow.queue.v1', tasks });
  return { view: { ...view, tasks }, retried: true, reason: target.id + ' 已重新排队' };
}
