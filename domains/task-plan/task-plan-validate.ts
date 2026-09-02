import { parseSpecFile } from '../spec/spec-parse.js';
import { listSpecFiles } from '../spec/spec-index.js';
import { loadProjectContext } from '../project/context.js';
import type { PlanFinding, PlanValidationResult, TaskPlan, TaskRecord } from './types.js';

export async function validateTaskPlan(projectRoot: string, plan: TaskPlan): Promise<PlanValidationResult> {
  const findings: PlanFinding[] = [];
  const specFiles = new Set(await listSpecFiles(projectRoot));
  const taskIds = new Set(plan.tasks.map((task) => task.id));
  const tasksBySpec = new Map<string, TaskRecord[]>();
  const context = await loadProjectContext(projectRoot);
  const backend = context?.tech_stack.backend?.toLowerCase() ?? '';

  for (const task of plan.tasks) {
    if (task.kind === 'implementation' && (!task.test_scope || task.definition_of_done.length === 0)) {
      findings.push({
        taskId: task.id,
        severity: 'error',
        code: 'missing-test-contract',
        message: 'implementation task must declare test_scope and definition_of_done',
      });
    }
    if (task.kind === 'implementation' && backend) {
      const forbidden = backend.includes('go')
        ? ['npm test', 'npm run test', 'pytest', 'pip install']
        : backend.includes('node') || backend.includes('typescript') || backend.includes('javascript')
          ? ['go test', 'go build', 'go vet']
          : [];
      for (const command of forbidden) {
        if (task.definition_of_done.some((item) => item.includes(command))) {
          findings.push({
            taskId: task.id,
            severity: 'error',
            code: 'stack-command-mismatch',
            message: 'definition_of_done contains forbidden command for backend ' + backend + ': ' + command,
          });
        }
      }
    }
  }

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

    const list = tasksBySpec.get(task.spec_ref) ?? [];
    list.push(task);
    tasksBySpec.set(task.spec_ref, list);

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

  // 覆盖检查：计划引用的每个 spec，其全部 anchor 都应有对应任务（拆解遗漏）
  for (const [specRef, tasks] of tasksBySpec) {
    const parsed = await parseSpecFile(projectRoot, specRef);
    const coveredAnchors = new Set(tasks.map((task) => task.spec_anchor));
    for (const anchor of parsed.anchors) {
      if (!coveredAnchors.has(anchor.heading)) {
        findings.push({
          taskId: tasks[0].id,
          severity: 'error',
          code: 'missing-coverage',
          message: `spec ${specRef} 的 anchor 没有对应任务: ${anchor.heading}`,
        });
      }
    }
  }

  // 依赖环检查：depends_on 图必须无环
  const adjacency = new Map<string, string[]>();
  for (const task of plan.tasks) {
    adjacency.set(task.id, task.depends_on.filter((dep) => taskIds.has(dep)));
  }
  const visitState = new Map<string, 'visiting' | 'done'>();
  const findCycleNode = (id: string): string | null => {
    const state = visitState.get(id);
    if (state === 'done') return null;
    if (state === 'visiting') return id;
    visitState.set(id, 'visiting');
    for (const dep of adjacency.get(id) ?? []) {
      const cycleNode = findCycleNode(dep);
      if (cycleNode) return cycleNode;
    }
    visitState.set(id, 'done');
    return null;
  };
  for (const id of taskIds) {
    const cycleNode = findCycleNode(id);
    if (cycleNode) {
      findings.push({
        taskId: cycleNode,
        severity: 'error',
        code: 'dependency-cycle',
        message: '任务依赖存在环: ' + cycleNode,
      });
      break;
    }
  }

  return { valid: findings.every((finding) => finding.severity !== 'error'), findings };
}
