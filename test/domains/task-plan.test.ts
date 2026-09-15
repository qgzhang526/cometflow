import { promises as fs } from 'node:fs';
import os from 'node:os';
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
    // `plan freeze` 会写 spec-lock 与版本仓（`.cometflow-history/`），所以只能作用在临时副本上：
    // 直接在提交在库里的夹具上跑，会让工作区冒出每次运行都不同的未跟踪产物。
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-task-plan-'));
    try {
      await fs.cp(fixture, tmp, { recursive: true });

      const plan = await generateTaskPlan(tmp, 'G1');
      const validation = await validateTaskPlan(tmp, plan);
      expect(validation.valid).toBe(true);

      const frozen = await freezeTaskPlan(tmp, plan);
      expect(frozen.status).toBe('frozen');
      expect(frozen.tasks[0].acceptance_ids).toEqual(['A1', 'A2']);
      expect(frozen.tasks[0].spec_hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
