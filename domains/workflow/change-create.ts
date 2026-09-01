import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readTaskPlan } from '../task-plan/task-plan-store.js';
import { changeDir, changeStateFile, writeChangeState } from './change-store.js';
import type { ChangeState } from './change-types.js';

export async function createChangeFromTask(options: {
  projectRoot: string;
  goalId: string;
  taskId: string;
  changeName: string;
}): Promise<ChangeState> {
  const plan = await readTaskPlan(options.projectRoot, options.goalId);
  const task = plan.tasks.find((entry) => entry.id === options.taskId);
  if (!task) throw new Error('Unknown task: ' + options.taskId);
  if (task.status !== 'frozen') throw new Error('Only frozen tasks can create changes');

  const dir = changeDir(options.projectRoot, options.changeName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'brief.md'), '# ' + task.title + '\n\n' + task.definition_of_done.join('\n') + '\n');

  const state: ChangeState = {
    schema: 'cometflow.change.v1',
    name: options.changeName,
    goal: options.goalId,
    task: task.id,
    phase: 'shape',
    status: 'active',
    spec_ref: task.spec_ref,
    spec_anchor: task.spec_anchor,
    acceptance_ids: task.acceptance_ids,
    spec_version: task.spec_version,
    spec_hash: task.spec_hash,
    created_at: new Date().toISOString(),
    archived: false,
  };
  await writeChangeState(options.projectRoot, state);
  return state;
}
