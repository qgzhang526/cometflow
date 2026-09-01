import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import type { ChangeState } from '../../domains/workflow/change-types.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "spec-kernel-project");

function baseState(): ChangeState {
  return {
    schema: 'cometflow.change.v1',
    name: 'auth-login',
    goal: 'G1',
    task: 'T1',
    phase: 'shape',
    status: 'active',
    spec_ref: 'specs/auth/spec.md',
    spec_anchor: 'POST /api/auth/email-login',
    acceptance_ids: ['A1', 'A2'],
    spec_version: 1,
    spec_hash: 'abc',
    created_at: new Date().toISOString(),
    archived: false,
  };
}

describe('change transitions', () => {
  it('advances shape → build → verify → archive → done', () => {
    let state = applyChangeTransition(baseState(), "confirm-acceptance");
    expect(state.phase).toBe('build');
    state = applyChangeTransition(state, "submit-candidate");
    expect(state.phase).toBe('verify');
    state = applyChangeTransition(state, "verify-pass");
    expect(state.phase).toBe('archive');
    state = applyChangeTransition(state, "archive-complete");
    expect(state.archived).toBe(true);
    expect(state.status).toBe('done');
  });

  it('rejects confirm-acceptance without acceptance', () => {
    expect(() => applyChangeTransition({ ...baseState(), acceptance_ids: [] }, 'confirm-acceptance')).toThrow();
  });
});

describe('change creation from frozen task', () => {
  it('creates a change directory and state', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cometflow-change-"));
    await fs.cp(fixture, tmp, { recursive: true });
    const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, "G1"));
    await writeTaskPlan(tmp, plan);
    const state = await createChangeFromTask({
      projectRoot: tmp,
      goalId: 'G1',
      taskId: 'T1',
      changeName: 'auth-email-login',
    });
    expect(state.phase).toBe('shape');
    expect(state.spec_anchor).toBe('POST /api/auth/email-login');
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
