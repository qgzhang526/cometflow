import { loadavg } from 'node:os';
import { getBuiltInAgentRunner } from '../../platform/agents/registry.js';
import type { AgentRunner } from '../../platform/agents/types.js';
import { addBudgetUsage, Budget, readBudgetUsage } from './budget.js';
import { runFlowRun } from './flow-run.js';
import { changeNameForTask, runTaskThroughChange } from './daemon-run-change.js';
import { mergeTodoView } from './daemon-todo.js';
import { clearDaemonControl, readDaemonControl } from './daemon-control.js';
import { idleGovernorAllows, type SchedulerMode } from './idle-governor.js';
import { buildRollbackGuidance, captureGitSafetySnapshot } from './git-safety.js';
import {
  buildQueueFromPlans,
  DEFAULT_LEASE_MS,
  markQueueTask,
  nextQueuedTask,
  readQueue,
  reclaimExpiredLeases,
  writeQueue,
} from './queue.js';
import { countQueue, writeDaemonState, type DaemonLastTask } from './daemon-state.js';
import type { SchedulerQueue } from './queue.js';

export interface DaemonOptions {
  projectRoot: string;
  agentId: string;
  mode: SchedulerMode;
  budgetMs?: number;
  intervalMs?: number;
  idleCpuThreshold?: number;
  model?: string;
  scheduleStartMinutes?: number;
  scheduleEndMinutes?: number;
  safetyBundle?: boolean;
  /** 同一任务连续失败到该次数后不再自动重试（默认 3）。 */
  maxAttempts?: number;
  /** 单任务超时（默认 30 分钟）：没有它，挂起的 agent 会永久阻塞 daemon。 */
  taskTimeoutMs?: number;
}

export const DEFAULT_TASK_TIMEOUT_MS = 30 * 60_000;

export interface DaemonIteration {
  index: number;
  ran: boolean;
  reason: string;
  agentId: string;
}

export function shouldRunIteration(
  mode: SchedulerMode,
  options: { loadavg1: number; idleCpuThreshold: number; nowMinutes: number; scheduleStartMinutes?: number; scheduleEndMinutes?: number } = {
    loadavg1: loadavg()[0] ?? 0,
    idleCpuThreshold: 1.0,
    nowMinutes: 0,
  },
) {
  return idleGovernorAllows(mode, options);
}

export async function runDaemonIteration(
  runner: AgentRunner,
  options: DaemonOptions,
  iterationIndex: number,
): Promise<DaemonIteration> {
  const threshold = options.idleCpuThreshold ?? 1.0;
  const decision = shouldRunIteration(options.mode, {
    loadavg1: loadavg()[0] ?? 0,
    idleCpuThreshold: threshold,
    nowMinutes: new Date().getHours() * 60 + new Date().getMinutes(),
    scheduleStartMinutes: options.scheduleStartMinutes,
    scheduleEndMinutes: options.scheduleEndMinutes,
  });
  if (!decision.allowed) {
    return { index: iterationIndex, ran: false, reason: decision.reason, agentId: options.agentId };
  }
  await runFlowRun(runner, {
    projectRoot: options.projectRoot,
    agentId: options.agentId,
    model: options.model,
  });
  return { index: iterationIndex, ran: true, reason: decision.reason, agentId: options.agentId };
}

export async function startDaemon(options: DaemonOptions): Promise<void> {
  const runner = getBuiltInAgentRunner(options.agentId);
  return runDaemonLoop({ ...options, runner });
}

export interface DaemonLoopOptions extends DaemonOptions {
  runner: AgentRunner;
}

/**
 * daemon 主循环。
 *
 * 与旧实现的区别（D 调度器健壮性）：
 *  1. 启动与每轮都回收过期租约——崩在 running 的任务不再永久卡死；
 *  2. 失败任务有上限，达到上限标 failed 交人工，而不是无限重试；
 *  3. 预算跨重启累计（runtime/budget.json），进程重启不再重置额度；
 *  4. 单任务带超时，挂起的 agent 不会永久阻塞循环。
 */
export async function runDaemonLoop(options: DaemonLoopOptions): Promise<void> {
  const runner = options.runner;
  const maxAttempts = options.maxAttempts ?? 3;
  const taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  const totalBudgetMs = options.budgetMs ?? 0;
  const usage = await readBudgetUsage(options.projectRoot);
  const remainingMs = totalBudgetMs > 0 ? Math.max(0, totalBudgetMs - usage.used_ms) : 0;

  // 状态投影（C5）：面板读的就是这份文件。写失败不阻断调度——它只是给人看的投影。
  let lastTask: DaemonLastTask | null = null;
  const reportState = async (
    currentQueue: SchedulerQueue,
    iteration: number,
    phase: 'started' | 'skipping' | 'ran' | 'stopped',
    decision: { ran: boolean; reason: string; task: string | null } | null,
    stoppedReason: string | null = null,
  ): Promise<void> => {
    try {
      await writeDaemonState(options.projectRoot, {
        pid: process.pid,
        mode: options.mode,
        agent: options.agentId,
        iteration,
        phase,
        stopped_reason: stoppedReason,
        last_decision: decision,
        last_task: lastTask,
        queue: countQueue(currentQueue),
        budget: {
          used_ms: (await readBudgetUsage(options.projectRoot)).used_ms,
          total_ms: totalBudgetMs,
          remaining_ms: totalBudgetMs > 0 ? budget.elapsedMs() : null,
        },
      });
    } catch {
      // 投影写不进去（磁盘满 / 权限）不该让无人值守停下。
    }
  };

  if (totalBudgetMs > 0) {
    console.log(
      ['daemon', 'budget', 'used=' + usage.used_ms + 'ms', 'remaining=' + remainingMs + 'ms'].join(' '),
    );
    if (remainingMs === 0) {
      console.log(['daemon', 'budget-exhausted', 'reset with cometflow daemon reset-budget'].join(' '));
      await reportState(
        (await readQueue(options.projectRoot)) ?? { schema: 'cometflow.queue.v1', tasks: [] },
        0,
        'stopped',
        { ran: false, reason: 'budget-exhausted', task: null },
        'budget-exhausted',
      );
      return;
    }
  }
  const budget = new Budget({ budgetMs: remainingMs });
  const intervalMs = options.intervalMs ?? 60_000;
  // S3：待办由事实推导（plans 的 frozen/approved 减去已归档 change），再叠加运行时覆盖。
  // `queue.json` 从此只是「覆盖 + 上次快照」，不再决定「该不该跑」。
  let queue: SchedulerQueue = {
    schema: 'cometflow.queue.v1',
    tasks: (await mergeTodoView(options.projectRoot)).tasks,
  };

  // 启动时先回收：上一次进程可能崩在 running 上。
  const startup = reclaimExpiredLeases(queue, { maxAttempts });
  queue = startup.queue;
  for (const task of startup.reclaimed) {
    console.log(['daemon', 'reclaimed', task.id, 'attempts=' + task.attempts].join(' '));
  }
  for (const task of startup.exhausted) {
    console.log(
      ['daemon', 'giving-up', task.id, 'attempts=' + task.attempts, '—— 需人工介入后重新入队'].join(' '),
    );
  }
  await writeQueue(options.projectRoot, queue);

  const snapshot = await captureGitSafetySnapshot(options.projectRoot, { bundle: options.safetyBundle === true });
  for (const line of buildRollbackGuidance(snapshot)) console.log(line);
  await reportState(queue, 0, 'started', { ran: false, reason: 'started', task: null });

  let index = 0;
  while (!budget.isExhausted()) {
    // 控制语义（S4）：每轮先看有没有人按下暂停 / 停止。进程仍归 CLI 持有，这里只读一个文件。
    const control = await readDaemonControl(options.projectRoot);
    if (control?.action === 'stop') {
      console.log(['daemon', String(index), 'stopped-by-control', control.requested_by].join(' '));
      // 一次性动作消费掉：否则下次 start 会立刻又停。
      await clearDaemonControl(options.projectRoot);
      await reportState(queue, index, 'stopped', { ran: false, reason: 'stopped-by-control', task: null }, 'stopped-by-control');
      break;
    }
    if (control?.action === 'pause') {
      console.log(['daemon', String(index), 'paused-by-control', control.requested_by].join(' '));
      await reportState(queue, index, 'skipping', { ran: false, reason: 'paused-by-control', task: null }, 'paused-by-control');
      index += 1;
      // 暂停也要能退出：否则预算耗尽的进程会一直停在暂停里出不来。
      if (budget.isExhausted()) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    // 每轮再回收一次：同一轮里也可能有别的进程留下的过期租约。
    const swept = reclaimExpiredLeases(queue, { maxAttempts });
    if (swept.reclaimed.length > 0 || swept.exhausted.length > 0) {
      queue = swept.queue;
      await writeQueue(options.projectRoot, queue);
      for (const task of swept.reclaimed) console.log(['daemon', 'reclaimed', task.id].join(' '));
      for (const task of swept.exhausted) console.log(['daemon', 'giving-up', task.id].join(' '));
    }
    const task = nextQueuedTask(queue);
    if (!task) {
      console.log(['daemon', String(index), 'no-queued-task', 'stop'].join(' '));
      await reportState(queue, index, 'stopped', { ran: false, reason: 'no-queued-task', task: null }, 'no-queued-task');
      break;
    }

    const decision = shouldRunIteration(options.mode, {
      loadavg1: loadavg()[0] ?? 0,
      idleCpuThreshold: options.idleCpuThreshold ?? 1.0,
      nowMinutes: new Date().getHours() * 60 + new Date().getMinutes(),
      scheduleStartMinutes: options.scheduleStartMinutes,
      scheduleEndMinutes: options.scheduleEndMinutes,
    });
    if (!decision.allowed) {
      console.log(['daemon', String(index), 'skip', decision.reason, task.id].join(' '));
      await reportState(queue, index, 'skipping', { ran: false, reason: decision.reason, task: task.id });
      index += 1;
      if (budget.isExhausted()) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    // 租约要长于单任务超时，否则正常执行中的任务会被误判为过期。
    const change = changeNameForTask(task.goal, task.task);
    queue = markQueueTask(queue, task.id, 'running', {
      leaseMs: Math.max(DEFAULT_LEASE_MS, taskTimeoutMs + 60_000),
      change,
    });
    await writeQueue(options.projectRoot, queue);
    const taskStartedAt = Date.now();
    // P4：交付通道——不再把任务丢给无绑定的 flow-run，而是推进一次完整的 change 生命周期。
    const outcome = await runTaskThroughChange({
      projectRoot: options.projectRoot,
      goal: task.goal,
      task: task.task,
      runner,
      model: options.model,
      timeoutMs: taskTimeoutMs,
    });
    const elapsedMs = Date.now() - taskStartedAt;
    const succeeded = outcome.verdict === 'delivered';
    // 需要人工介入的（spec 冲突 / blocked / 未知阶段）直接标 failed 并停下：
    // 让 daemon 继续跑下一个任务，只会把问题掩盖在一串"看起来在推进"的日志后面。
    const gaveUp = outcome.needsHuman || (!succeeded && task.attempts + 1 >= maxAttempts);
    queue = markQueueTask(queue, task.id, succeeded ? 'done' : gaveUp ? 'failed' : 'queued', {
      change: outcome.change,
      verdict: outcome.verdict,
    });
    await writeQueue(options.projectRoot, queue);
    await addBudgetUsage(options.projectRoot, elapsedMs);
    lastTask = {
      id: task.id,
      result: succeeded ? 'done' : 'failed',
      elapsedMs,
      timedOut: false,
      change: outcome.change,
      verdict: outcome.verdict,
      detail: outcome.detail,
    };
    console.log(
      [
        'daemon',
        String(index),
        task.id,
        outcome.verdict,
        'change=' + outcome.change,
        outcome.detail,
        gaveUp ? '（已达重试上限，需人工介入）' : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    await reportState(queue, index, 'ran', {
      ran: true,
      reason: succeeded ? 'task-delivered' : gaveUp ? 'task-needs-human' : 'task-retry',
      task: task.id,
    });
    index += 1;
    if (outcome.needsHuman) {
      // 停机交人工：状态投影里写明原因，界面与 CLI 都能看到「为什么停了」。
      await reportState(
        queue,
        index,
        'stopped',
        { ran: false, reason: 'needs-human:' + outcome.verdict, task: task.id },
        'needs-human:' + outcome.verdict,
      );
      break;
    }
    if (budget.isExhausted()) {
      await reportState(queue, index, 'stopped', { ran: false, reason: 'budget-exhausted', task: null }, 'budget-exhausted');
      break;
    }
    // 失败后退避：连续失败的尝试间隔递增，避免立刻重跑同一个必然失败的任务。
    const backoff = succeeded ? intervalMs : Math.min(intervalMs * (task.attempts + 1), intervalMs * 4);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
}
