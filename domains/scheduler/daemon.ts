import { loadavg } from 'node:os';
import { getBuiltInAgentRunner } from '../../platform/agents/registry.js';
import type { AgentRunner } from '../../platform/agents/types.js';
import { Budget } from './budget.js';
import { runFlowRun } from './flow-run.js';
import { idleGovernorAllows, type SchedulerMode } from './idle-governor.js';

export interface DaemonOptions {
  projectRoot: string;
  agentId: string;
  mode: SchedulerMode;
  budgetMs?: number;
  intervalMs?: number;
  idleCpuThreshold?: number;
  model?: string;
}

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
  const budget = new Budget({ budgetMs: options.budgetMs ?? 0 });
  const intervalMs = options.intervalMs ?? 60_000;
  let index = 0;

  while (!budget.isExhausted()) {
    const iteration = await runDaemonIteration(runner, options, index);
    console.log(['daemon', String(index), iteration.ran ? 'ran' : 'skip', iteration.reason].join(' '));
    index += 1;
    if (budget.isExhausted()) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
