import path from 'node:path';
import { startDaemon } from '../../domains/scheduler/daemon.js';
import type { SchedulerMode } from '../../domains/scheduler/idle-governor.js';
import { resolveAgentId } from '../../domains/scheduler/flow-run.js';
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
    model: options.model,
    scheduleStartMinutes,
    scheduleEndMinutes,
    safetyBundle: options.safetyBundle === true,
  });
}
