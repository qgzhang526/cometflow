import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateHook } from '../../domains/guard/hook-guard.js';
import {
  clearCurrentChange,
  currentChangePath,
  readCurrentChange,
  selectCurrentChange,
} from '../../domains/workflow/current-change.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { archiveChange } from '../../domains/workflow/change-execution.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { runDoctor } from '../../domains/dashboard/doctor.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

let tmp: string;

async function writeChange(
  root: string,
  name: string,
  phase: string,
  options: { archived?: boolean; module?: string | null } = {},
): Promise<void> {
  const dir = path.join(root, 'changes', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'comet-state.yaml'),
    [
      'schema: cometflow.change.v1',
      'name: ' + name,
      'goal: G1',
      'task: T1',
      'phase: ' + phase,
      'status: active',
      'spec_ref: null',
      'spec_anchor: null',
      'acceptance_ids: []',
      'spec_version: null',
      'spec_hash: null',
      'module: ' + (options.module ?? 'null'),
      'created_at: "2026-01-01T00:00:00.000Z"',
      'archived: ' + (options.archived === true),
    ].join('\n'),
  );
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-current-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('current change pointer', () => {
  it('round-trips through the pointer file', async () => {
    expect(await readCurrentChange(tmp)).toBeNull();

    const pointer = await selectCurrentChange(tmp, 'alpha', { source: 'manual' });
    expect(pointer.change).toBe('alpha');
    expect((await readCurrentChange(tmp))?.source).toBe('manual');

    expect(await clearCurrentChange(tmp, 'alpha')).toBe(true);
    expect(await readCurrentChange(tmp)).toBeNull();
  });

  it('does not clear a pointer that belongs to another change', async () => {
    await selectCurrentChange(tmp, 'alpha', { source: 'auto' });
    expect(await clearCurrentChange(tmp, 'beta')).toBe(false);
    expect((await readCurrentChange(tmp))?.change).toBe('alpha');
  });

  it('treats a corrupted pointer as absent instead of throwing', async () => {
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await fs.writeFile(currentChangePath(tmp), '{ not json');
    expect(await readCurrentChange(tmp)).toBeNull();
  });
});

describe('hook routing with several active changes', () => {
  it('按 module 归属：写进某个活跃 change 的模块就归它，不需要指针', async () => {
    await writeChange(tmp, 'alpha', 'build', { module: 'src/alpha' });
    await writeChange(tmp, 'beta', 'build', { module: 'src/beta' });
    await selectCurrentChange(tmp, 'alpha', { source: 'manual' });

    const insideAlpha = await evaluateHook(tmp, 'write', path.join(tmp, 'src', 'alpha', 'x.ts'));
    expect(insideAlpha.allowed).toBe(true);

    // 写进 beta 的模块 → 归 beta（这正是并发能开的前提：各写各的模块，归属无歧义）。
    const insideBeta = await evaluateHook(tmp, 'write', path.join(tmp, 'src', 'beta', 'x.ts'));
    expect(insideBeta.allowed).toBe(true);

    // 谁都不认领的路径：回落到指针（alpha），再按 alpha 的模块边界拒绝。
    const outside = await evaluateHook(tmp, 'write', path.join(tmp, 'docs', 'note.md'));
    expect(outside.allowed).toBe(false);
    expect(outside.reason).toBe('outside-module-scope');
  });

  it('多个 change 且没有指针、路径不在任何 module 里：仍然 fail closed', async () => {
    await writeChange(tmp, 'alpha', 'build', { module: 'src/alpha' });
    await writeChange(tmp, 'beta', 'build', { module: 'src/beta' });

    const decision = await evaluateHook(tmp, 'write', path.join(tmp, 'docs', 'note.md'));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('multiple-active-changes');
    expect(decision.hint).toContain('change select');
  });

  it('指针指向已归档的 change、路径也不在 module 里：fail closed', async () => {
    await writeChange(tmp, 'alpha', 'build', { module: 'src/alpha' });
    await writeChange(tmp, 'beta', 'build', { module: 'src/beta' });
    await writeChange(tmp, 'gone', 'build', { archived: true, module: 'src/gone' });
    await selectCurrentChange(tmp, 'gone', { source: 'manual' });

    const decision = await evaluateHook(tmp, 'write', path.join(tmp, 'docs', 'note.md'));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('stale-current-change');
    expect(decision.hint).toContain('alpha');
  });

  it('still uses the only active change when a stale pointer exists', async () => {
    await writeChange(tmp, 'alpha', 'build', { module: 'src/alpha' });
    await selectCurrentChange(tmp, 'gone', { source: 'manual' });

    const decision = await evaluateHook(tmp, 'write', path.join(tmp, 'src', 'alpha', 'x.ts'));
    expect(decision.allowed).toBe(true);
  });
});

describe('pointer lifecycle', () => {
  it('is set on change creation and cleared on archive', async () => {
    await fs.cp(fixture, tmp, { recursive: true });
    const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
    await writeTaskPlan(tmp, plan);
    await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: 'T1', changeName: 'auth-login' });

    expect((await readCurrentChange(tmp))?.change).toBe('auth-login');
    expect((await readCurrentChange(tmp))?.source).toBe('auto');

    let state = await readChangeState(tmp, 'auth-login');
    state = applyChangeTransition(state, 'confirm-acceptance');
    state = applyChangeTransition(state, 'submit-candidate');
    state = applyChangeTransition(state, 'verify-pass');
    await writeChangeState(tmp, state);
    await archiveChange(tmp, 'auth-login');

    expect(await readCurrentChange(tmp)).toBeNull();
  });

  it('reports routing state through doctor', async () => {
    await writeChange(tmp, 'alpha', 'build', { module: 'src/alpha' });
    await writeChange(tmp, 'beta', 'build', { module: 'src/beta' });

    const withoutPointer = await runDoctor(tmp);
    const warning = withoutPointer.findings.find((finding) => finding.code === 'multiple-active-changes');
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain('change select');

    await selectCurrentChange(tmp, 'alpha', { source: 'manual' });
    const withPointer = await runDoctor(tmp);
    const info = withPointer.findings.find((finding) => finding.code === 'multiple-active-changes');
    expect(info?.severity).toBe('info');
    expect(info?.message).toContain('alpha');
  });
});
