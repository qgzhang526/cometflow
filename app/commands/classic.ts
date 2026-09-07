import path from 'node:path';
import { createClassicChange } from '../../domains/classic/classic-create.js';
import { readClassicState, writeClassicState } from '../../domains/classic/classic-store.js';
import { applyClassicTransition } from '../../domains/classic/classic-transitions.js';
import type { ClassicEvent, ClassicProfile } from '../../domains/classic/types.js';

function root(targetPath: string): string {
  return path.resolve(targetPath);
}

export async function classicNewCommand(
  name: string,
  options: { goal: string; task: string; profile: ClassicProfile; path?: string },
): Promise<void> {
  const projectRoot = root(options.path ?? '.');
  const state = await createClassicChange({
    projectRoot,
    name,
    goal: options.goal,
    task: options.task,
    profile: options.profile,
  });
  console.log('created classic change ' + state.name + ' profile=' + state.profile + ' phase=' + state.phase);
}

export async function classicStatusCommand(name: string, targetPath: string): Promise<void> {
  const state = await readClassicState(root(targetPath), name);
  console.log(JSON.stringify(state, null, 2));
}

export async function classicTransitionCommand(
  name: string,
  event: string,
  targetPath: string,
): Promise<void> {
  const projectRoot = root(targetPath);
  const state = await readClassicState(projectRoot, name);
  const next = applyClassicTransition(state, event as ClassicEvent);
  const filePath = await writeClassicState(projectRoot, next);
  console.log('wrote ' + filePath + ' phase=' + next.phase + ' archived=' + next.archived);
}
