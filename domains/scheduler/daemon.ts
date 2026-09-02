import { loadavg } from 'node:os';
import { getBuiltInAgentRunner } from '../../platform/agents/registry.js';
import type { AgentRunner } from '../../platform/agents/types.js';
import { Budget } from './budget.js';
import { runFlowRun } from './flow-run.js';
import { idleGovernorAllows, type SchedulerMode } from './idle-governor.js';
import { buildRollbackGuidance, captureGitSafetySnapshot } from './git-safety.js';
import { buildQueueFromPlans, markQueueTask, nextQueuedTask, readQueue, writeQueue } from './queue.js';

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
  const budget = new Budget({ budgetMs: options.budgetMs ?? 0 });
  const intervalMs = options.intervalMs ?? 60_000;
  let queue = (await readQueue(options.projectRoot)) ?? (await buildQueueFromPlans(options.projectRoot));
  await writeQueue(options.projectRoot, queue);

  const snapshot = await captureGitSafetySnapshot(options.projectRoot, { bundle: options.safetyBundle === true });
  for (const line of buildRollbackGuidance(snapshot)) console.log(line);

  let index = 0;
  while (!budget.isExhausted()) {
    const task = nextQueuedTask(queue);
    if (!task) {
      console.log(['daemon', String(index), 'no-queued-task', 'stop'].join(' '));
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
      index += 1;
      if (budget.isExhausted()) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    queue = markQueueTask(queue, task.id, 'running');
    await writeQueue(options.projectRoot, queue);
    const outcome = await runFlowRun(runner, {
      projectRoot: options.projectRoot,
      agentId: options.agentId,
      model: options.model,
    });
    queue = markQueueTask(queue, task.id, outcome.result.exitCode === 0 ? 'done' : 'failed');
    await writeQueue(options.projectRoot, queue);
    console.log(['daemon', String(index), task.id, outcome.result.exitCode === 0 ? 'done' : 'failed'].join(' '));
    index += 1;
    if (budget.isExhausted()) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
