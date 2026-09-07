import { writeClassicState } from './classic-store.js';
import type { ClassicProfile, ClassicState } from './types.js';

export async function createClassicChange(options: {
  projectRoot: string;
  name: string;
  goal: string;
  task: string;
  profile?: ClassicProfile;
}): Promise<ClassicState> {
  const state: ClassicState = {
    schema: 'cometflow.classic.v1',
    name: options.name,
    goal: options.goal,
    task: options.task,
    profile: options.profile ?? 'full',
    phase: 'open',
    archived: false,
    created_at: new Date().toISOString(),
  };
  await writeClassicState(options.projectRoot, state);
  return state;
}
