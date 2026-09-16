import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parse } from 'yaml';
import { buildQueueFromPlans, queueFromPlan, readQueue, writeQueue } from './queue.js';
import type { QueueTask, SchedulerQueue } from './queue.js';
import { listChangeStates } from '../workflow/change-list.js';
import type { TaskPlan } from '../task-plan/types.js';
import { changeNameForTask } from './daemon-run-change.js';

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
  const tasks: QueueTask[] = [];
  for (const plan of await readPlans(projectRoot)) {
    tasks.push(...queueFromPlan(plan));
  }
  return tasks;
}

export async function mergeTodoView(projectRoot: string): Promise<TodoView> {
  const [derived, overlay, delivered, inFlight] = await Promise.all([
    deriveTodoList(projectRoot),
    readQueue(projectRoot),
    deliveredTasks(projectRoot),
    inFlightTasks(projectRoot),
  ]);

  const overlayById = new Map((overlay?.tasks ?? []).map((task) => [task.goal + ':' + task.task, task]));
  const merged: TodoEntry[] = [];

  for (const task of derived) {
    const key = task.goal + ':' + task.task;
    const archived = delivered.get(key);
    if (archived !== undefined) {
      merged.push({ ...task, status: 'done', change: archived, verdict: 'delivered', delivered: true, source: 'delivered' });
      continue;
    }
    const runtime = overlayById.get(key);
    if (runtime !== undefined && runtime.status !== 'queued') {
      // 运行时的事实优先于「推导出待办」：正在跑的不能被重复排队，失败的保留尝试次数。
      merged.push({ ...task, ...runtime, delivered: false, source: 'overlay' });
      continue;
    }
    const claimed = inFlight.get(key);
    if (claimed !== undefined && claimed !== changeNameForTask(task.goal, task.task)) {
      // 有人（或另一条通道）正在这个任务上干活：标记在飞，daemon 让开，别让两个 agent 改同一块代码。
      merged.push({
        ...task,
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
    merged.push({ ...task, change: claimed ?? task.change ?? null, delivered: false, source: 'derived' });
    overlayById.delete(key);
  }

  // 推导里已经没有、但运行时记录还留着的行（计划被取消 / 老路径跑过的 legacy 记录）：保留，不重跑。
  for (const orphan of overlayById.values()) {
    merged.push({ ...orphan, delivered: orphan.verdict === 'delivered', source: 'overlay' });
  }

  return { tasks: merged, derived, overlay };
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
  const derived = await deriveTodoList(projectRoot);
  const delivered = await deliveredTasks(projectRoot);
  const tasks: TodoEntry[] = derived.map((task) => {
    const archived = delivered.get(task.goal + ':' + task.task);
    return archived === undefined
      ? { ...task, attempts: 0, delivered: false, source: 'derived' as const }
      : {
          ...task,
          status: 'done' as const,
          attempts: 0,
          change: archived,
          verdict: 'delivered',
          delivered: true,
          source: 'delivered' as const,
        };
  });
  await writeQueue(projectRoot, { schema: 'cometflow.queue.v1', tasks });
  return { tasks, derived, overlay: null };
}

/** 兼容旧入口：没跑过 daemon 时按计划推导（保留给既有调用方）。 */
export async function deriveQueueCompat(projectRoot: string): Promise<SchedulerQueue> {
  return buildQueueFromPlans(projectRoot);
}
