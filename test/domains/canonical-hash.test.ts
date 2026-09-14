import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHANGE_STATE_HASH_TAG,
  PLAN_HASH_TAG,
  canonicalHash,
  canonicalJson,
  hashChangeState,
  hashTaskPlan,
  verifyPlanHash,
} from '../../domains/state/canonical-hash.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { readTaskPlan, writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { verifySpecIntegrity } from '../../domains/spec/spec-verify.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');
let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-canonical-'));
  await fs.cp(fixture, tmp, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function freeze(): Promise<void> {
  const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
  await writeTaskPlan(tmp, plan);
}

describe('canonical json', () => {
  it('is insensitive to key order but sensitive to array order', () => {
    expect(canonicalJson({ b: 1, a: [1, 2] })).toBe(canonicalJson({ a: [1, 2], b: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });

  it('normalizes negative zero and drops undefined object fields', () => {
    expect(canonicalJson({ a: -0 })).toBe(canonicalJson({ a: 0 }));
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('separates domains by tag', () => {
    const value = { a: 1 };
    expect(canonicalHash(PLAN_HASH_TAG, value)).not.toBe(canonicalHash(CHANGE_STATE_HASH_TAG, value));
  });

  it('rejects values that cannot be expressed as canonical json', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/finite/u);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(/function/u);
    expect(() => canonicalJson({ a: [undefined] })).toThrow(/undefined/u);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/u);
  });

  it('ignores the stamp field when hashing', () => {
    const plan = { schema: 'cometflow.task-plan.v1', goal: 'G1', tasks: [] };
    expect(hashTaskPlan({ ...plan, plan_hash: 'stale' })).toBe(hashTaskPlan(plan));
    const state = { schema: 'cometflow.change.v1', name: 'c' };
    expect(hashChangeState({ ...state, state_hash: 'stale' })).toBe(hashChangeState(state));
  });
});

describe('plan and change state integrity', () => {
  it('stamps plan_hash on write and detects a hand-edited plan', async () => {
    await freeze();
    const plan = await readTaskPlan(tmp, 'G1');
    expect(plan.plan_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifyPlanHash(plan as unknown as Record<string, unknown>)).toBeNull();

    const planFile = path.join(tmp, '.cometflow', 'plans', 'G1.task-plan.yaml');
    const source = await fs.readFile(planFile, 'utf8');
    await fs.writeFile(planFile, source.replace('title: 实现 auth', 'title: 偷偷改掉的标题 - 实现 auth'));

    const tampered = await readTaskPlan(tmp, 'G1');
    expect(verifyPlanHash(tampered as unknown as Record<string, unknown>)).toMatch(/plan content changed/u);

    const result = await verifySpecIntegrity(tmp);
    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('plan-integrity');
  });

  it('stamps state_hash on write and detects a hand-edited change state', async () => {
    await freeze();
    await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: 'T1', changeName: 'login' });

    const state = await readChangeState(tmp, 'login');
    expect(state.state_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect((await verifySpecIntegrity(tmp)).findings.map((finding) => finding.code)).not.toContain(
      'change-state-integrity',
    );

    const stateFile = path.join(tmp, 'changes', 'login', 'comet-state.yaml');
    const source = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(stateFile, source.replace('phase: shape', 'phase: build'));

    const result = await verifySpecIntegrity(tmp);
    expect(result.findings.map((finding) => finding.code)).toContain('change-state-integrity');
  });

  it('re-stamps the state on the next write so content changes stay legal', async () => {
    await freeze();
    await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: 'T1', changeName: 'login' });
    const state = await readChangeState(tmp, 'login');

    await writeChangeState(tmp, { ...state, acceptance_ids: ['A1'] });

    const result = await verifySpecIntegrity(tmp);
    expect(result.findings.map((finding) => finding.code)).not.toContain('change-state-integrity');
  });

  it('leaves legacy plans without a stamp untouched instead of failing them', async () => {
    await freeze();
    const planFile = path.join(tmp, '.cometflow', 'plans', 'G1.task-plan.yaml');
    const source = await fs.readFile(planFile, 'utf8');
    // 老计划没有 plan_hash 字段：校验必须降级，而不是把历史数据判死。
    await fs.writeFile(
      planFile,
      source
        .split(/\r?\n/u)
        .filter((line) => !line.startsWith('plan_hash:'))
        .join('\n'),
    );

    const plan = await readTaskPlan(tmp, 'G1');
    expect(plan.plan_hash).toBeUndefined();
    expect(verifyPlanHash(plan as unknown as Record<string, unknown>)).toBeNull();
    expect((await verifySpecIntegrity(tmp)).findings.map((finding) => finding.code)).not.toContain(
      'plan-integrity',
    );
  });
});
