import { generateTaskPlan } from './task-plan-generate.js';
import { freezeTaskPlan } from './task-plan-freeze.js';
import type { TaskPlan, TaskRecord } from './types.js';

export interface RegenerateOptions {
  preserveApproved?: boolean;
}

function taskKey(task: TaskRecord): string {
  return [task.kind, task.capability, task.spec_ref ?? '', task.spec_anchor ?? ''].join('\u0000');
}

export async function regenerateTaskPlan(
  projectRoot: string,
  goalId: string,
  previous: TaskPlan,
  options: RegenerateOptions = {},
): Promise<TaskPlan> {
  const freshDraft = await generateTaskPlan(projectRoot, goalId);
  const freshFrozen = await freezeTaskPlan(projectRoot, freshDraft);
  const previousByKey = new Map(previous.tasks.map((task) => [taskKey(task), task]));
  const usedKeys = new Set<string>();
  const tasks: TaskRecord[] = [];

  for (const candidate of freshFrozen.tasks) {
    const key = taskKey(candidate);
    usedKeys.add(key);
    const old = previousByKey.get(key);
    const preserve = options.preserveApproved === true && old && (old.status === "approved" || old.status === "frozen") && old.spec_hash === candidate.spec_hash;
    if (preserve) {
      tasks.push(old);
      continue;
    }
    tasks.push({ ...candidate, status: "draft" });
  }

  if (options.preserveApproved) {
    for (const old of previous.tasks) {
      if (!usedKeys.has(taskKey(old)) && old.status !== "cancelled") {
        tasks.push({ ...old, status: "cancelled" as const });
      }
    }
  }

  return {
    schema: 'cometflow.task-plan.v1',
    goal: goalId,
    status: 'draft',
    tasks,
  };
}
