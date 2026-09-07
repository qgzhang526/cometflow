import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { verifyChange } from '../../domains/workflow/change-execution.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

async function makeVerifyProject(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-verification-'));
  await fs.cp(fixture, tmp, { recursive: true });
  const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
  await writeTaskPlan(tmp, plan);
  await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: 'T1', changeName: 'auth-email-login' });
  let state = await readChangeState(tmp, 'auth-email-login');
  state = applyChangeTransition(state, 'confirm-acceptance');
  state = applyChangeTransition(state, 'submit-candidate');
  await writeChangeState(tmp, state);
  return tmp;
}

describe('verification document', () => {
  it('passes when acceptance coverage is complete and all passed', async () => {
    const tmp = await makeVerifyProject();
    await fs.writeFile(path.join(tmp, 'changes', 'auth-email-login', 'verification.yaml'), [
      'schema: cometflow.verification.v1',
      'change: auth-email-login',
      'acceptance:',
      '  - id: A1',
      '    result: passed',
      '    reason: ok',
      '  - id: A2',
      '    result: passed',
      '    reason: ok',
    ].join('\n'));
    const outcome = await verifyChange(tmp, 'auth-email-login');
    expect(outcome.state.phase).toBe('archive');
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('rejects incomplete acceptance coverage', async () => {
    const tmp = await makeVerifyProject();
    await fs.writeFile(path.join(tmp, 'changes', 'auth-email-login', 'verification.yaml'), [
      'schema: cometflow.verification.v1',
      'change: auth-email-login',
      'acceptance:',
      '  - id: A1',
      '    result: passed',
      '    reason: ok',
    ].join('\n'));
    await expect(verifyChange(tmp, 'auth-email-login')).rejects.toThrow('coverage mismatch');
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
