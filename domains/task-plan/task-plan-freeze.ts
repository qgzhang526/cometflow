import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseSpecFile } from '../spec/spec-parse.js';
import { readTextFile } from '../../platform/fs/read-file.js';
import type { TaskPlan, TaskRecord } from './types.js';

function sha256(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

export async function freezeTaskPlan(projectRoot: string, plan: TaskPlan): Promise<TaskPlan> {
  const frozenTasks: TaskRecord[] = [];

  for (const task of plan.tasks) {
    if (task.kind === 'spec-authoring' || !task.spec_ref || !task.spec_anchor) {
      frozenTasks.push({ ...task, status: 'frozen' as const });
      continue;
    }

    const parsed = await parseSpecFile(projectRoot, task.spec_ref);
    const anchor = parsed.anchors.find((entry) => entry.heading === task.spec_anchor);
    if (!anchor) throw new Error('Missing anchor for task ' + task.id);
    const acceptance = anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance;
    if (acceptance.length === 0) throw new Error('No acceptance for task ' + task.id);

    const content = await readTextFile(path.join(projectRoot, task.spec_ref));
    frozenTasks.push({
      ...task,
      acceptance_ids: acceptance.map((item) => item.id),
      spec_version: 1,
      spec_hash: sha256(content),
      status: 'frozen' as const,
    });
  }

  return { ...plan, status: 'frozen' as const, tasks: frozenTasks };
}
