import path from 'node:path';
import { startDaemon } from '../../domains/scheduler/daemon.js';
import { readBudgetUsage, resetBudgetUsage } from '../../domains/scheduler/budget.js';
import type { SchedulerMode } from '../../domains/scheduler/idle-governor.js';
import { resolveAgentId } from '../../domains/scheduler/flow-run.js';
import { resolveModel } from '../../domains/project/config.js';
import { parseScheduleWindow } from '../../domains/scheduler/schedule.js';
import { rebuildQueue, resetQueue, retryQueueTask } from '../../domains/scheduler/daemon-todo.js';
import { writeDaemonControl } from '../../domains/scheduler/daemon-control.js';

export interface DaemonCommandOptions {
  mode: SchedulerMode;
  budget?: number;
  interval?: number;
  agent?: string;
  model?: string;
  cpuThreshold?: number;
  start?: string;
  end?: string;
  safetyBundle?: boolean;
  /** 同一任务连续失败到该次数后不再自动重试。 */
  maxAttempts?: number;
  /** 单任务超时（毫秒）。 */
  taskTimeout?: number;
  /** 并发槽位（ADR 0028：>1 目前会被拒绝并说明原因）。 */
  concurrency?: number;
}

/** 查看/清零跨重启累计的预算用量。 */
export async function daemonBudgetCommand(
  targetPath: string,
  options: { reset?: boolean } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  if (options.reset === true) {
    const usage = await resetBudgetUsage(projectRoot);
    console.log('budget usage reset (used_ms=0) at ' + usage.updated_at);
    return;
  }
  const usage = await readBudgetUsage(projectRoot);
  console.log('used_ms=' + usage.used_ms + ' updated_at=' + usage.updated_at);
}

export async function daemonStartCommand(targetPath: string, options: DaemonCommandOptions): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const agentId = options.agent ?? (await resolveAgentId(projectRoot));
  let scheduleStartMinutes: number | undefined;
  let scheduleEndMinutes: number | undefined;
  if (options.mode === 'schedule') {
    if (!options.start || !options.end) {
      throw new Error('schedule mode requires --start and --end (HH:MM)');
    }
    const window = parseScheduleWindow(options.start, options.end);
    scheduleStartMinutes = window.startMinutes;
    scheduleEndMinutes = window.endMinutes;
  }
  const result = await startDaemon({
    projectRoot,
    agentId,
    mode: options.mode,
    budgetMs: options.budget,
    intervalMs: options.interval,
    idleCpuThreshold: options.cpuThreshold,
    model: options.model ?? (await resolveModel(projectRoot, agentId)),
    scheduleStartMinutes,
    scheduleEndMinutes,
    safetyBundle: options.safetyBundle === true,
    maxAttempts: options.maxAttempts,
    taskTimeoutMs: options.taskTimeout,
    concurrency: options.concurrency,
  });
  console.log('daemon: reason=' + result.reason + ' iterations=' + result.iterations + (result.detail ? ' detail=' + result.detail : ''));
  // 被拒绝的启动不是"正常结束"：给非零退出码，脚本能判断。
  // - lease-held：已有调度器在跑；concurrency-not-open：并发准入没过（装了写保护守卫）。
  if (result.reason === 'lease-held' || result.reason === 'concurrency-not-open') process.exitCode = 1;
}

/**
 * 队列维护（P4 / S3）：把「手工删 `.cometflow/runtime/queue.json`」升级成有语义的命令。
 *
 * - `rebuild`：按事实重算待办（plans 的 frozen/approved 减去已归档 change），**保留**运行时覆盖
 *   —— 包括老路径（daemon 直接跑 agent 的时代）留下的 `done`，迁移期不会因此重跑。
 * - `reset`：清掉运行时覆盖，显式要求全部重跑（已归档 change 的任务仍算已交付，不会被重排）。
 */
export async function daemonQueueCommand(action: string, targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  if (action !== 'rebuild' && action !== 'reset') {
    throw new Error('daemon queue action must be rebuild or reset, got: ' + action);
  }
  const view = action === 'rebuild' ? await rebuildQueue(projectRoot) : await resetQueue(projectRoot);
  const count = (status: string): number => view.tasks.filter((task) => task.status === status).length;
  console.log(
    'daemon queue ' + action + ': ' +
      'queued=' + count('queued') +
      ' running=' + count('running') +
      ' done=' + count('done') +
      ' failed=' + count('failed') +
      ' delivered=' + view.tasks.filter((task) => task.delivered).length,
  );
  for (const task of view.tasks) {
    console.log(
      ['  ', task.goal + ':' + task.task, task.status, task.source, task.change ?? ''].filter(Boolean).join(' '),
    );
  }
}

/**
 * 暂停 / 继续 / 停止正在跑的 daemon（S4）：只写控制文件，不碰进程。
 *
 * 进程由启动它的终端持有——这是刻意的（见 ADR 0026）：界面或脚本能发指令，
 * 但不会让 serve 成为进程主人（日志、退出码、pid 的归属都不变）。
 */
export async function daemonControlCommand(
  action: 'pause' | 'resume' | 'stop',
  targetPath: string,
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const record = await writeDaemonControl(projectRoot, action, { by: 'cli' });
  console.log('daemon control: ' + record.action + ' requested_at=' + record.requested_at);
  if (action === 'stop') {
    console.log('（正在跑的 daemon 会在下一轮退出；没有在跑时这条指令会在下次 start 时被消费）');
  }
}

/** 单条任务重新排队（细粒度恢复）：`daemon queue retry G1:T1`。 */
export async function daemonRetryCommand(taskRef: string, targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await retryQueueTask(projectRoot, taskRef);
  console.log('daemon queue retry: ' + result.reason);
  if (!result.retried) process.exitCode = 1;
}
