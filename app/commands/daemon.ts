import path from 'node:path';
import { startDaemon } from '../../domains/scheduler/daemon.js';
import type { SchedulerMode } from '../../domains/scheduler/idle-governor.js';
import { resolveAgentId } from '../../domains/scheduler/flow-run.js';

export interface DaemonCommandOptions {
  mode: SchedulerMode;
  budget?: number;
  interval?: number;
  agent?: string;
  model?: string;
  cpuThreshold?: number;
}

export async function daemonStartCommand(targetPath: string, options: DaemonCommandOptions): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const agentId = options.agent ?? (await resolveAgentId(projectRoot));
  await startDaemon({
    projectRoot,
    agentId,
    mode: options.mode,
    budgetMs: options.budget,
    intervalMs: options.interval,
    idleCpuThreshold: options.cpuThreshold,
    model: options.model,
  });
}
