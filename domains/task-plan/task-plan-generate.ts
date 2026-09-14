import path from 'node:path';
import { parseGoals } from '../goal/goal-sync.js';
import { parseSpecFile } from '../spec/spec-parse.js';
import { capabilitySpecFile, listSpecFiles } from '../spec/spec-index.js';
import { normalizeModulePath, parseSpecMeta } from '../spec/spec-meta.js';
import { readTextFile } from '../../platform/fs/read-file.js';
import type { TaskPlan, TaskRecord } from './types.js';

function taskTitle(capability: string, anchor: string): string {
  return '实现 ' + capability + ' - ' + anchor;
}

export async function generateTaskPlan(projectRoot: string, goalId: string): Promise<TaskPlan> {
  const missionPath = path.join(projectRoot, 'COMETFLOW.md');
  const markdown = await readTextFile(missionPath);
  const goals = parseGoals(markdown);
  const goal = goals.find((entry) => entry.id === goalId);
  if (!goal) throw new Error('Unknown goal: ' + goalId);

  const existingSpecs = new Set(await listSpecFiles(projectRoot));
  const tasks: TaskRecord[] = [];

  for (const capability of goal.scope) {
    const specRef = capabilitySpecFile(capability);
    if (!existingSpecs.has(specRef)) {
      tasks.push({
        id: 'T' + (tasks.length + 1),
        title: '起草 ' + capability + ' capability spec',
        kind: 'spec-authoring',
        capability,
        spec_ref: null,
        spec_anchor: null,
        acceptance_ids: [],
        spec_version: null,
        spec_hash: null,
        depends_on: [],
        test_scope: 'specs/' + capability,
        definition_of_done: ['spec 草案经人工审核', 'spec validate 通过'],
        status: 'draft',
      });
      continue;
    }

    const specContent = await readTextFile(path.join(projectRoot, specRef));
    const meta = parseSpecMeta(specContent);
    const module = normalizeModulePath(meta.module);
    const parsed = await parseSpecFile(projectRoot, specRef);
    for (const anchor of parsed.anchors) {
      tasks.push({
        id: 'T' + (tasks.length + 1),
        title: taskTitle(capability, anchor.heading),
        kind: 'implementation',
        capability,
        spec_ref: specRef,
        spec_anchor: anchor.heading,
        acceptance_ids: [],
        spec_version: null,
        spec_hash: null,
        depends_on: [],
        // 模块边界由 spec 声明（front-matter module），而不是拆解器猜。
        module,
        test_scope: module ?? 'internal/' + capability,
        definition_of_done: ['所有 acceptance 通过', '相关测试通过'],
        status: 'draft',
      });
    }
  }

  return {
    schema: 'cometflow.task-plan.v1',
    goal: goalId,
    status: 'draft',
    tasks,
  };
}
