import type { TaskPlan } from './types.js';

export function traceTaskPlan(plan: TaskPlan): string[] {
  const lines: string[] = [];
  lines.push('goal: ' + plan.goal);
  lines.push('status: ' + plan.status);
  for (const task of plan.tasks) {
    lines.push(task.id + ': ' + task.title);
    lines.push('  capability: ' + task.capability);
    lines.push('  spec: ' + (task.spec_ref ?? '(none)'));
    lines.push('  anchor: ' + (task.spec_anchor ?? '(none)'));
    lines.push('  acceptance: ' + (task.acceptance_ids.length > 0 ? task.acceptance_ids.join(', ') : '(none)'));
    lines.push('  status: ' + task.status);
  }
  return lines;
}
