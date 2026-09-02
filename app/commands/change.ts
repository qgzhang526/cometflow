import path from 'node:path';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { archiveChange, runChange, verifyChange } from '../../domains/workflow/change-execution.js';
import { listChangeStates } from '../../domains/workflow/change-list.js';
import { resumeChange } from '../../domains/workflow/change-resume.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import type { ChangeEvent } from '../../domains/workflow/change-types.js';
import { getBuiltInAgentRunner } from '../../platform/agents/registry.js';
import { resolveAgentId } from '../../domains/scheduler/flow-run.js';

function root(targetPath: string): string {
  return path.resolve(targetPath);
}

export async function changeNewCommand(
  name: string,
  options: { goal: string; task: string; path?: string },
): Promise<void> {
  const projectRoot = root(options.path ?? '.');
  const state = await createChangeFromTask({
    projectRoot,
    goalId: options.goal,
    taskId: options.task,
    changeName: name,
  });
  console.log('created change ' + state.name + ' phase=' + state.phase);
}

export async function changeListCommand(
  targetPath: string,
  options: { all?: boolean; json?: boolean },
): Promise<void> {
  const projectRoot = root(targetPath);
  const states = await listChangeStates(projectRoot);
  const visible = options.all ? states : states.filter((state) => !state.archived);
  if (options.json) {
    console.log(JSON.stringify(visible, null, 2));
    return;
  }
  for (const state of visible) {
    console.log([state.name, state.phase, state.status, state.archived ? 'archived' : 'active'].join(' '));
  }
}

export async function changeResumeCommand(
  name: string,
  targetPath: string,
  options: { json?: boolean },
): Promise<void> {
  const projectRoot = root(targetPath);
  const state = await readChangeState(projectRoot, name);
  const resume = resumeChange(state);
  if (options.json) {
    console.log(JSON.stringify(resume, null, 2));
    return;
  }
  console.log(resume.message);
  if (resume.nextEvent) {
    console.log('command: cometflow change transition ' + name + ' ' + resume.nextEvent);
  }
}

export async function changeStatusCommand(name: string, targetPath: string): Promise<void> {
  const state = await readChangeState(root(targetPath), name);
  console.log(JSON.stringify(state, null, 2));
}

export async function changeRunCommand(
  name: string,
  targetPath: string,
  options: { agent?: string },
): Promise<void> {
  const projectRoot = root(targetPath);
  const agentId = options.agent ?? (await resolveAgentId(projectRoot));
  const runner = getBuiltInAgentRunner(agentId);
  const outcome = await runChange(projectRoot, name, runner);
  console.log('change ' + name + ' phase=' + outcome.state.phase + ' agentExit=' + outcome.agentExitCode);
  if (outcome.agentExitCode !== 0) process.exitCode = outcome.agentExitCode;
}

export async function changeVerifyCommand(name: string, targetPath: string): Promise<void> {
  const projectRoot = root(targetPath);
  const outcome = await verifyChange(projectRoot, name);
  console.log('change ' + name + ' phase=' + outcome.state.phase + ' reportPassed=' + outcome.reportPassed);
}

export async function changeArchiveCommand(name: string, targetPath: string): Promise<void> {
  const projectRoot = root(targetPath);
  const state = await archiveChange(projectRoot, name);
  console.log('change ' + name + ' archived=' + state.archived);
}

export async function changeTransitionCommand(
  name: string,
  event: string,
  targetPath: string,
): Promise<void> {
  const projectRoot = root(targetPath);
  const state = await readChangeState(projectRoot, name);
  const next = applyChangeTransition(state, event as ChangeEvent);
  const filePath = await writeChangeState(projectRoot, next);
  console.log('wrote ' + filePath + ' phase=' + next.phase + ' archived=' + next.archived);
}
