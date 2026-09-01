import { parseSpecFile } from '../spec/spec-parse.js';
import { listSpecFiles } from '../spec/spec-index.js';
import type { PlanFinding, PlanValidationResult, TaskPlan } from './types.js';

export async function validateTaskPlan(projectRoot: string, plan: TaskPlan): Promise<PlanValidationResult> {
  const findings: PlanFinding[] = [];
  const specFiles = new Set(await listSpecFiles(projectRoot));
  const taskIds = new Set(plan.tasks.map((task) => task.id));

  for (const task of plan.tasks) {
    if (task.kind === 'spec-authoring') continue;

    if (!task.spec_ref || !specFiles.has(task.spec_ref)) {
      findings.push({
        taskId: task.id,
        severity: 'error',
        code: 'unknown-spec',
        message: '任务引用的 spec 不存在: ' + (task.spec_ref ?? '(null)'),
      });
      continue;
    }

    const parsed = await parseSpecFile(projectRoot, task.spec_ref);
    const anchor = parsed.anchors.find((entry) => entry.heading === task.spec_anchor);
    if (!anchor) {
      findings.push({
        taskId: task.id,
        severity: 'error',
        code: 'unknown-anchor',
        message: '任务引用的 spec anchor 不存在: ' + (task.spec_anchor ?? '(null)'),
      });
    } else if (anchor.acceptance.length === 0 && parsed.acceptance.length === 0) {
      findings.push({
        taskId: task.id,
        severity: 'error',
        code: 'no-acceptance',
        message: '任务关联的 spec 没有 acceptance',
      });
    }

    for (const dep of task.depends_on) {
      if (!taskIds.has(dep)) {
        findings.push({
          taskId: task.id,
          severity: 'error',
          code: 'unknown-dependency',
          message: '依赖任务不存在: ' + dep,
        });
      }
    }
  }

  return { valid: findings.every((finding) => finding.severity !== 'error'), findings };
}
