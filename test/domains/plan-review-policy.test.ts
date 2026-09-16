import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPlanReviewPolicy, normalizePlanReviewPolicy } from '../../domains/task-plan/plan-review-policy.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { readTaskPlan, writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import type { TaskPlan } from '../../domains/task-plan/types.js';

/**
 * 拆解审核策略（ADR 0003）：`plan_review` 配置必须真的决定「生成之后停在哪一步」。
 * 在此之前这个键只有声明与默认值，没有任何消费点。
 */

let root: string;

/** 一个能通过 `plan validate` 的最小项目：goal scope = [a]，specs/a 有 anchor 与验收。 */
async function makeProject(policy: string | null): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-plan-review-'));
  const config = ['schema: cometflow.project.v1', 'default_workflow: native'];
  if (policy !== null) config.push('plan_review: ' + policy);
  await fs.mkdir(path.join(dir, '.cometflow'), { recursive: true });
  await fs.writeFile(path.join(dir, '.cometflow', 'config.yaml'), config.join('\n') + '\n');
  await fs.writeFile(
    path.join(dir, 'COMETFLOW.md'),
    ['# 项目使命', '', '测试用。', '', '## 任务目标', '', '### G1：核心', '- 目标：把 a 做出来', '- 范围：a', ''].join('\n'),
  );
  await fs.mkdir(path.join(dir, 'specs', 'a'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'specs', 'a', 'spec.md'),
    ['# a capability', '', '## H1 核心', '', '需求。', '', '## 验收', '', '- A001：第一条', ''].join('\n'),
  );
  return dir;
}

beforeEach(async () => {
  root = await makeProject('auto');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('plan review policy', () => {
  it('auto 且校验通过：草稿被自动 review + approve', async () => {
    const outcome = await applyPlanReviewPolicy(root, await generateTaskPlan(root, 'G1'));
    expect(outcome.policy).toBe('auto');
    expect(outcome.applied).toBe(true);
    expect(outcome.plan.status).toBe('approved');
    expect(outcome.note).toContain('已自动 review + approve');
  });

  it('auto 但校验有 error：停在 draft，不放行', async () => {
    // 删掉验收小节 → validate 报 no-acceptance（error），auto 不能替人把这个擦掉。
    await fs.writeFile(path.join(root, 'specs', 'a', 'spec.md'), '# a capability\n\n## H1 核心\n\n需求。\n');
    const outcome = await applyPlanReviewPolicy(root, await generateTaskPlan(root, 'G1'));
    expect(outcome.policy).toBe('auto');
    expect(outcome.applied).toBe(false);
    expect(outcome.plan.status).toBe('draft');
    expect(outcome.note).toContain('error');
  });

  it('human：停在 draft', async () => {
    await fs.writeFile(path.join(root, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\nplan_review: human\n');
    const outcome = await applyPlanReviewPolicy(root, await generateTaskPlan(root, 'G1'));
    expect(outcome.policy).toBe('human');
    expect(outcome.applied).toBe(false);
    expect(outcome.plan.status).toBe('draft');
    expect(outcome.note).toContain('等评审');
  });

  it('high-risk 与未知值都按 human 兜底，并说明原因', async () => {
    await fs.writeFile(path.join(root, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\nplan_review: high-risk\n');
    const highRisk = await applyPlanReviewPolicy(root, await generateTaskPlan(root, 'G1'));
    expect(highRisk.policy).toBe('high-risk');
    expect(highRisk.plan.status).toBe('draft');
    expect(highRisk.note).toContain('尚未实现');

    await fs.writeFile(path.join(root, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\nplan_review: whatever\n');
    const unknown = await applyPlanReviewPolicy(root, await generateTaskPlan(root, 'G1'));
    expect(unknown.policy).toBe('human');
    expect(unknown.declared).toBe('whatever');
    expect(unknown.note).toContain('未知的 plan_review 值');

    // 未配置同样按 human：缺省不能悄悄变成 auto。
    expect(normalizePlanReviewPolicy(undefined)).toBe('human');
  });

  it('非草稿计划不被策略改动', async () => {
    const frozen = { ...(await generateTaskPlan(root, 'G1')), status: 'approved' } as TaskPlan;
    const outcome = await applyPlanReviewPolicy(root, frozen);
    expect(outcome.applied).toBe(false);
    expect(outcome.plan.status).toBe('approved');
    expect(outcome.note).toContain('策略不介入');
  });

  it('走命令路径时，auto 的策略结论会落进计划文件', async () => {
    // 直接验「写盘的那份」是 approved：策略必须在写文件之前生效，否则界面刷新看到的还是 draft。
    const review = await applyPlanReviewPolicy(root, await generateTaskPlan(root, 'G1'));
    await writeTaskPlan(root, review.plan);
    expect((await readTaskPlan(root, 'G1')).status).toBe('approved');
  });
});
