import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDaemonLoop } from '../../domains/scheduler/daemon.js';
import { mergeTodoView } from '../../domains/scheduler/daemon-todo.js';
import { readCurrentChange } from '../../domains/workflow/current-change.js';
import type { AgentRunner } from '../../platform/agents/types.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';

/**
 * goal 级调度顺序（ADR 0029）：daemon **实际领取的先后**。
 *
 * 三种形态都钉在这里：
 * 1. `## 调度顺序` 里的清单决定先后（位置即顺序）；
 * 2. 没列出的按编号升序兜底——`G10` 解析成 10，不是字典序（旧实现按 plan 文件名排序，
 *    `G10.task-plan.yaml` 会插到 `G2` 前面）；
 * 3. 已交付的 goal **不占位**：它由 change 账本判 done，不再参与领取，清单里的位置是惰性的。
 */

let root: string;

/** 每次 runner 被调用时记下"当前 change"，它由 change 名 `goal-task` 派生。 */
function orderProbe(): { runner: AgentRunner; order: () => string[] } {
  const seen: string[] = [];
  const runner: AgentRunner = {
    id: 'mock',
    name: 'mock',
    buildCommand: (input) => ({ command: 'mock', args: [input.prompt], cwd: input.cwd }),
    run: async () => {
      const pointer = await readCurrentChange(root);
      if (pointer) seen.push(pointer.change.replace(/-T\d+$/u, ''));
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    },
    check: async () => true,
    subagentTool: () => 'task',
    configTemplate: () => 'none',
  };
  return { runner, order: () => seen };
}

/** 每个 goal 一个 capability、一个 anchor → 一个任务（`T1`），验收带可执行的 check。 */
async function writeProject(
  goals: Array<{ id: string; capability: string; module: string }>,
  order?: string[],
): Promise<void> {
  await fs.mkdir(path.join(root, '.cometflow', 'plans'), { recursive: true });
  await fs.writeFile(path.join(root, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\nplan_review: auto\nagent: mock\n');
  const mission = ['# 项目使命', '', '## 任务目标', ''];
  for (const goal of goals) {
    const upper = goal.capability.toUpperCase();
    mission.push(
      '### ' + goal.id + '：' + goal.capability + ' 能力',
      '- 目标：实现 ' + goal.capability + ' 能力',
      '- 范围：' + goal.capability,
      '',
    );
    await fs.mkdir(path.join(root, 'specs', goal.capability), { recursive: true });
    await fs.writeFile(
      path.join(root, 'specs', goal.capability, 'spec.md'),
      [
        '---',
        'capability: ' + goal.capability,
        'module: ' + goal.module,
        '---',
        '',
        '# ' + goal.capability,
        '',
        '## ' + upper + '-001 需求',
        '',
        '需求描述。',
        '',
        '## Acceptance',
        '',
        '- A1：可用',
        '  - check: node -e "process.exit(0)"',
        '',
      ].join('\n'),
    );
  }
  if (order !== undefined) {
    mission.push('## 调度顺序', '', ...order.map((id) => '- ' + id), '');
  }
  await fs.writeFile(path.join(root, 'COMETFLOW.md'), mission.join('\n'));
  for (const goal of goals) {
    await writeTaskPlan(root, await freezeTaskPlan(root, await generateTaskPlan(root, goal.id)));
  }
}

/** 冒充"上一次已经交付过"：归档 change 是交付的唯一判据。 */
async function archiveChange(goal: string, task: string): Promise<void> {
  const dir = path.join(root, 'changes', goal + '-' + task);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'comet-state.yaml'),
    ['schema: cometflow.change.v1', 'name: ' + goal + '-' + task, 'goal: ' + goal, 'task: ' + task, 'phase: archive', 'status: done', 'archived: true', ''].join('\n'),
  );
}

async function claimOrder(): Promise<string[]> {
  const probe = orderProbe();
  await runDaemonLoop({
    projectRoot: root,
    agentId: 'mock',
    mode: 'always',
    runner: probe.runner,
    intervalMs: 0,
  });
  return probe.order();
}

const goal = (id: string, capability: string) => ({ id, capability, module: 'src/' + capability });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-order-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('goal 级调度顺序', () => {
  it('清单决定先后：写 G3 → G1 → G2 就按这个顺序领', async () => {
    await writeProject([goal('G1', 'alpha'), goal('G2', 'beta'), goal('G3', 'gamma')], ['G3', 'G1', 'G2']);
    expect(await claimOrder()).toEqual(['G3', 'G1', 'G2']);
  });

  it('没列出的按编号兜底排在后面（G10 在 G2 之后，不是字典序）', async () => {
    await writeProject([goal('G1', 'alpha'), goal('G2', 'beta'), goal('G10', 'gamma')], ['G2']);
    expect(await claimOrder()).toEqual(['G2', 'G1', 'G10']);
  });

  it('没有清单：整队按编号升序（旧实现会把 G10 排到 G2 前面）', async () => {
    await writeProject([goal('G1', 'alpha'), goal('G2', 'beta'), goal('G10', 'gamma')]);
    expect(await claimOrder()).toEqual(['G1', 'G2', 'G10']);
  });

  it('已交付的 goal 不占位：它在清单第一，但第一条被领的是下一名', async () => {
    await writeProject([goal('G1', 'alpha'), goal('G2', 'beta'), goal('G3', 'gamma')], ['G1', 'G3', 'G2']);
    await archiveChange('G1', 'T1');

    const view = await mergeTodoView(root);
    const delivered = view.tasks.find((task) => task.goal + ':' + task.task === 'G1:T1');
    expect(delivered?.delivered).toBe(true);
    expect(view.order.listed).toEqual(['G1', 'G3', 'G2']);

    expect(await claimOrder()).toEqual(['G3', 'G2']);
  });
});
