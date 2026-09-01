import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectProjectStatus } from '../../domains/dashboard/collector.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "spec-kernel-project");

describe('dashboard collector', () => {
  it('collects goals, plans, and changes', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cometflow-dashboard-"));
    await fs.cp(fixture, tmp, { recursive: true });

    const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, "G1"));
    await writeTaskPlan(tmp, plan);
    await createChangeFromTask({
      projectRoot: tmp,
      goalId: 'G1',
      taskId: 'T1',
      changeName: 'auth-email-login',
    });

    const status = await collectProjectStatus(tmp);
    expect(status.plans.length).toBe(1);
    expect(status.changes.length).toBe(1);
    expect(status.changes[0].phase).toBe('shape');

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
