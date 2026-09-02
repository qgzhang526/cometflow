import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listChangeStates } from '../../domains/workflow/change-list.js';
import { resumeChange } from '../../domains/workflow/change-resume.js';
import { collectSpecDrift } from '../../domains/spec/spec-drift.js';
import { regenerateTaskPlan } from '../../domains/task-plan/task-plan-regenerate.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { readTaskPlan, writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

async function makeTempProject(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-phase1-'));
  await fs.cp(fixture, tmp, { recursive: true });
  return tmp;
}

describe('phase 1: change list and resume', () => {
  it('lists active changes and resumes the next action', async () => {
    const tmp = await makeTempProject();
    const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
    await writeTaskPlan(tmp, plan);
    await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: 'T1', changeName: 'auth-email-login' });

    const active = await listChangeStates(tmp);
    expect(active).toHaveLength(1);
    expect(active[0].archived).toBe(false);

    const resume = resumeChange(active[0]);
    expect(resume.nextEvent).toBe('confirm-acceptance');

    let state = readChangeState(tmp, 'auth-email-login').then((s) => s);
    state = await state;
    const archived = await applyChangeTransition(
      await applyChangeTransition(
        await applyChangeTransition(
          await applyChangeTransition(state, 'confirm-acceptance'),
          'submit-candidate',
        ),
        'verify-pass',
      ),
      'archive-complete',
    );
    await writeChangeState(tmp, archived);
    expect((await listChangeStates(tmp)).filter((entry) => entry.archived)).toHaveLength(1);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe('phase 1: spec drift', () => {
  it('detects a frozen task whose spec changed', async () => {
    const tmp = await makeTempProject();
    const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
    await writeTaskPlan(tmp, plan);

    expect((await collectSpecDrift(tmp)).drift).toHaveLength(0);

    await fs.appendFile(path.join(tmp, 'specs/auth/spec.md'), '\n## Changed\n');
    const report = await collectSpecDrift(tmp);
    expect(report.drift).toHaveLength(2);
    expect(report.drift.map((entry) => entry.task).sort()).toEqual(['T1', 'T2']);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe('phase 1: plan regenerate', () => {
  it('preserves approved tasks when spec is unchanged', async () => {
    const tmp = await makeTempProject();
    const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
    const approved = { ...plan, status: 'approved' as const, tasks: plan.tasks.map((task) => ({ ...task, status: 'approved' as const })) };
    await writeTaskPlan(tmp, approved);

    const previous = await readTaskPlan(tmp, 'G1');
    const regenerated = await regenerateTaskPlan(tmp, 'G1', previous, { preserveApproved: true });
    expect(regenerated.tasks.every((task) => task.status === 'approved')).toBe(true);

    await fs.appendFile(path.join(tmp, 'specs/auth/spec.md'), '\n## Changed\n');
    const drifted = await regenerateTaskPlan(tmp, 'G1', regenerated, { preserveApproved: true });
    expect(drifted.tasks.some((task) => task.status === 'draft')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
