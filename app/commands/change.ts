import path from 'node:path';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import type { ChangeEvent } from '../../domains/workflow/change-types.js';

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

export async function changeStatusCommand(name: string, targetPath: string): Promise<void> {
  const state = await readChangeState(root(targetPath), name);
  console.log(JSON.stringify(state, null, 2));
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
