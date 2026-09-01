import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { validateTaskPlan } from '../../domains/task-plan/task-plan-validate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

describe('task plan', () => {
  it('generates implementation tasks bound to spec anchors', async () => {
    const plan = await generateTaskPlan(fixture, 'G1');
    expect(plan.tasks.length).toBe(2);
    expect(plan.tasks[0].spec_ref).toBe('specs/auth/spec.md');
    expect(plan.tasks[0].spec_anchor).toBe('POST /api/auth/email-login');
  });

  it('validates and freezes the generated plan', async () => {
    const plan = await generateTaskPlan(fixture, 'G1');
    const validation = await validateTaskPlan(fixture, plan);
    expect(validation.valid).toBe(true);

    const frozen = await freezeTaskPlan(fixture, plan);
    expect(frozen.status).toBe('frozen');
    expect(frozen.tasks[0].acceptance_ids).toEqual(['A1', 'A2']);
    expect(frozen.tasks[0].spec_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
