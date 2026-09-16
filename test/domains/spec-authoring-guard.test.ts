import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { buildChangePrompt, verifyChange } from '../../domains/workflow/change-execution.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { commitTransition } from '../../domains/workflow/change-store.js';
import { syncGoals } from '../../domains/goal/goal-sync.js';

/**
 * `kind: spec-authoring` 任务（G4）。
 *
 * 这类任务在 `plan validate` 里被整条跳过，冻结是它唯一能被拦住的地方；
 * 它的提示词过去是空段落，agent 只拿到 brief.md 的一行标题。两条都在这里钉住。
 */

let root: string;

async function makeProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-spec-authoring-'));
  await fs.mkdir(path.join(dir, '.cometflow'), { recursive: true });
  await fs.writeFile(path.join(dir, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\nplan_review: auto\n');
  await fs.writeFile(
    path.join(dir, 'COMETFLOW.md'),
    [
      '# 项目使命',
      '',
      '## 任务目标',
      '',
      '### G1：order 能力',
      '- 目标：把下单流程做成可验收的契约',
      '- 范围：order',
      '- 成功标准：',
      '  - 下单接口有可判定的验收项',
      '  - 库存不足时返回 DUP_ORDER 之外的明确错误码',
      '- 非目标：',
      '  - 不做支付',
      '',
    ].join('\n'),
  );
  // 只建 specs/ 目录：capability spec 故意缺席，让 plan generate 产出起草任务。
  await fs.mkdir(path.join(dir, 'specs'), { recursive: true });
  return dir;
}

const AUTHORED_SPEC = [
  '---',
  'capability: order',
  'module: internal/order',
  'status: draft',
  '---',
  '',
  '# order capability',
  '',
  '## POST /api/orders',
  '',
  '下单。',
  '',
  '## 验收',
  '',
  '- A001：创建订单返回 orderId',
  '',
].join('\n');

beforeEach(async () => {
  root = await makeProject();
  await syncGoals(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('spec-authoring 任务的护栏', () => {
  it('没有 acceptance 也不会被卡在 shape：起草类 change 可以进 build', async () => {
    const plan = await generateTaskPlan(root, 'G1');
    expect(plan.tasks[0].kind).toBe('spec-authoring');
    await writeTaskPlan(root, await freezeTaskPlan(root, plan));
    const created = await createChangeFromTask({
      projectRoot: root,
      goalId: 'G1',
      taskId: 'T1',
      changeName: 'author-order',
    });
    expect(created.acceptance_ids).toEqual([]);
    // 实现类 change 缺 acceptance 仍然要被拦（那是别处的老规矩），起草类例外。
    expect(() => applyChangeTransition({ ...created, task_kind: 'implementation' }, 'confirm-acceptance')).toThrow(
      /Acceptance must be frozen/,
    );
    const building = applyChangeTransition(created, 'confirm-acceptance');
    expect(building.phase).toBe('build');
  });

  it('验收时产物还不存在 / 过不了 spec validate，都要被拒', async () => {
    // 先在没有 spec 时生成计划：这样拿到的才是 spec-authoring 任务。
    const plan = await generateTaskPlan(root, 'G1');
    expect(plan.tasks[0].kind).toBe('spec-authoring');
    await writeTaskPlan(root, await freezeTaskPlan(root, plan));
    const created = await createChangeFromTask({
      projectRoot: root,
      goalId: 'G1',
      taskId: 'T1',
      changeName: 'author-order',
    });
    // 走到 verify 阶段：shape → build → verify
    const build = applyChangeTransition(created, 'confirm-acceptance');
    await commitTransition(root, 'confirm-acceptance', created, build);
    const verify = applyChangeTransition(build, 'submit-candidate');
    await commitTransition(root, 'submit-candidate', build, verify);

    await expect(verifyChange(root, 'author-order')).rejects.toThrow(/产物还不存在/);

    await fs.mkdir(path.join(root, 'specs', 'order'), { recursive: true });
    // 有 anchor 但没有验收小节 → no-acceptance（error）。
    await fs.writeFile(
      path.join(root, 'specs', 'order', 'spec.md'),
      '---\ncapability: order\nstatus: draft\n---\n\n# order capability\n\n## POST /api/orders\n\n下单。\n',
    );
    await expect(verifyChange(root, 'author-order')).rejects.toThrow(/未通过 spec validate/);
    await expect(verifyChange(root, 'author-order')).rejects.toThrow(/no-acceptance/);
  });

  it('起草提示词交底 goal 的成功标准，并要求产物带 status: draft', async () => {
    const plan = await generateTaskPlan(root, 'G1');
    await fs.mkdir(path.join(root, 'specs', 'order'), { recursive: true });
    await fs.writeFile(path.join(root, 'specs', 'order', 'spec.md'), AUTHORED_SPEC);
    await writeTaskPlan(root, await freezeTaskPlan(root, plan));
    await createChangeFromTask({ projectRoot: root, goalId: 'G1', taskId: 'T1', changeName: 'author-order' });

    const prompt = await buildChangePrompt(root, 'author-order');
    expect(prompt).toContain('## Spec authoring');
    expect(prompt).toContain('specs/order/spec.md');
    expect(prompt).toContain('status: draft');
    // goal 的成功标准与非目标都要在提示词里，否则等于让 agent 凭空写契约。
    expect(prompt).toContain('下单接口有可判定的验收项');
    expect(prompt).toContain('不做支付');
  });
});
