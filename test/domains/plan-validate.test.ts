import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateTaskPlan } from '../../domains/task-plan/task-plan-validate.js';
import type { TaskPlan, TaskRecord } from '../../domains/task-plan/types.js';

async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-plan-validate-'));
  const specA = `# a capability

## H1

第一个需求。

## 验收

- A1：第一条验收

## H2

第二个需求。

## 验收

- A2：第二条验收
`;
  const specB = `# b capability

## H3

第三个需求。

## 验收

- A3：第三条验收
`;
  const specNoAcc = `# noacc capability

## H4

没有验收小节的 spec。
`;
  await fs.mkdir(path.join(root, 'specs', 'a'), { recursive: true });
  await fs.mkdir(path.join(root, 'specs', 'b'), { recursive: true });
  await fs.mkdir(path.join(root, 'specs', 'noacc'), { recursive: true });
  await fs.writeFile(path.join(root, 'specs', 'a', 'spec.md'), specA);
  await fs.writeFile(path.join(root, 'specs', 'b', 'spec.md'), specB);
  await fs.writeFile(path.join(root, 'specs', 'noacc', 'spec.md'), specNoAcc);
  return root;
}

function task(partial: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'T1',
    title: 't',
    kind: 'implementation',
    capability: 'a',
    spec_ref: 'specs/a/spec.md',
    spec_anchor: 'H1',
    acceptance_ids: [],
    spec_version: null,
    spec_hash: null,
    depends_on: [],
    test_scope: 'internal/a',
    definition_of_done: [],
    status: 'draft',
    ...partial,
  };
}

function plan(tasks: TaskRecord[]): TaskPlan {
  return { schema: 'cometflow.task-plan.v1', goal: 'G1', status: 'draft', tasks };
}

async function codes(root: string, p: TaskPlan): Promise<string[]> {
  const result = await validateTaskPlan(root, p);
  return result.findings.map((f) => f.code);
}

describe('plan validate (H2 增强)', () => {
  let root: string;
  beforeEach(async () => {
    root = await makeProject();
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('正例：完整覆盖且无环的计划通过', async () => {
    const p = plan([
      task({ id: 'T1', spec_anchor: 'H1' }),
      task({ id: 'T2', spec_anchor: 'H2' }),
      task({ id: 'T3', spec_ref: 'specs/b/spec.md', spec_anchor: 'H3', depends_on: ['T1'] }),
    ]);
    const result = await validateTaskPlan(root, p);
    expect(result.valid).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('负例：拆解遗漏（missing-coverage）被拦截', async () => {
    const p = plan([task({ id: 'T1', spec_anchor: 'H1' })]); // H2 无任务
    expect(await codes(root, p)).toContain('missing-coverage');
  });

  it('负例：未知 anchor 被拦截', async () => {
    const p = plan([task({ id: 'T1', spec_anchor: 'H99' })]);
    expect(await codes(root, p)).toContain('unknown-anchor');
  });

  it('负例：未知 spec 被拦截', async () => {
    const p = plan([task({ id: 'T1', spec_ref: 'specs/nope/spec.md' })]);
    expect(await codes(root, p)).toContain('unknown-spec');
  });

  it('负例：spec 无 acceptance 被拦截', async () => {
    const p = plan([task({ id: 'T1', spec_ref: 'specs/noacc/spec.md', spec_anchor: 'H4' })]);
    expect(await codes(root, p)).toContain('no-acceptance');
  });

  it('负例：依赖不存在被拦截', async () => {
    const p = plan([task({ id: 'T1', depends_on: ['T99'] })]);
    expect(await codes(root, p)).toContain('unknown-dependency');
  });

  it('负例：依赖成环被拦截', async () => {
    const p = plan([
      task({ id: 'T1', depends_on: ['T2'] }),
      task({ id: 'T2', spec_anchor: 'H2', depends_on: ['T1'] }),
    ]);
    expect(await codes(root, p)).toContain('dependency-cycle');
  });
});
