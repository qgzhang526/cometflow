import path from 'node:path';
import { startDaemon } from '../../domains/scheduler/daemon.js';
import { readBudgetUsage, resetBudgetUsage } from '../../domains/scheduler/budget.js';
import type { SchedulerMode } from '../../domains/scheduler/idle-governor.js';
import { resolveAgentId } from '../../domains/scheduler/flow-run.js';
import { resolveModel } from '../../domains/project/config.js';
import { parseScheduleWindow } from '../../domains/scheduler/schedule.js';

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
  await startDaemon({
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
  });
}
