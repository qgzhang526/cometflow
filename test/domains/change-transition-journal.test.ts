import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { commitTransition, readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { appendChangeEvent, readChangeJournal } from '../../domains/workflow/change-journal.js';
import {
  PENDING_TRANSITION_SCHEMA,
  listPendingTransitions,
  pendingTransitionPath,
  readPendingTransition,
  settlePendingTransition,
} from '../../domains/workflow/change-transition-journal.js';
import { runDoctor } from '../../domains/dashboard/doctor.js';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'spec-kernel-project',
);

const changeName = 'auth-email-login';
let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-transition-'));
  await fs.cp(fixture, tmp, { recursive: true });
  const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
  await writeTaskPlan(tmp, plan);
  await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: 'T1', changeName });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function pendingExists(): Promise<boolean> {
  try {
    await fs.access(pendingTransitionPath(tmp, changeName));
    return true;
  } catch {
    return false;
  }
}

describe('two-phase change transition', () => {
  it('commits the transition atomically and leaves no pending record', async () => {
    const state = await readChangeState(tmp, changeName);
    const next = applyChangeTransition(state, 'confirm-acceptance');

    await commitTransition(tmp, 'confirm-acceptance', state, next);

    expect((await readChangeState(tmp, changeName)).phase).toBe('build');
    expect(await pendingExists()).toBe(false);
    const events = (await readChangeJournal(tmp, changeName)).map((event) => event.event);
    expect(events).toContain('transition');
  });

  it('re-applies the transition when a crash happened before the state write', async () => {
    const state = await readChangeState(tmp, changeName);
    const next = applyChangeTransition(state, 'confirm-acceptance');
    // 模拟 prepare 之后崩溃：只留下待提交记录，状态仍是 shape。
    await commitTransition(tmp, 'confirm-acceptance', state, next);
    await writeChangeState(tmp, state);
    await fs.mkdir(path.dirname(pendingTransitionPath(tmp, changeName)), { recursive: true });
    await fs.writeFile(
      pendingTransitionPath(tmp, changeName),
      JSON.stringify({
        schema: PENDING_TRANSITION_SCHEMA,
        change: changeName,
        event: 'confirm-acceptance',
        from_phase: 'shape',
        to_phase: 'build',
        prepared_at: new Date().toISOString(),
        next_state: next,
      }),
    );

    const recovered = await readChangeState(tmp, changeName);
    expect(recovered.phase).toBe('build');
    expect(await pendingExists()).toBe(false);
    const settled = (await readChangeJournal(tmp, changeName)).filter(
      (event) => event.event === 'transition-settled',
    );
    expect(settled.some((event) => event.data?.result === 'recovered')).toBe(true);
  });

  it('only clears the record when the state already reached the target phase', async () => {
    const state = await readChangeState(tmp, changeName);
    const next = applyChangeTransition(state, 'confirm-acceptance');
    await fs.mkdir(path.dirname(pendingTransitionPath(tmp, changeName)), { recursive: true });
    await fs.writeFile(
      pendingTransitionPath(tmp, changeName),
      JSON.stringify({
        schema: PENDING_TRANSITION_SCHEMA,
        change: changeName,
        event: 'confirm-acceptance',
        from_phase: 'shape',
        to_phase: 'build',
        prepared_at: new Date().toISOString(),
        next_state: next,
      }),
    );
    // 状态已经是 build：说明状态写成功了，只是没来得及清账。
    await writeChangeState(tmp, next);

    expect(await settlePendingTransition(tmp, changeName)).toBe('completed');
    expect(await pendingExists()).toBe(false);
  });

  it('keeps the record and reports a conflict when the phases do not line up', async () => {
    const state = await readChangeState(tmp, changeName);
    const next = applyChangeTransition(state, 'confirm-acceptance');
    await appendChangeEvent(tmp, changeName, 'transition', { event: 'confirm-acceptance' });
    await fs.mkdir(path.dirname(pendingTransitionPath(tmp, changeName)), { recursive: true });
    await fs.writeFile(
      pendingTransitionPath(tmp, changeName),
      JSON.stringify({
        schema: PENDING_TRANSITION_SCHEMA,
        change: changeName,
        event: 'verify-pass',
        from_phase: 'verify',
        to_phase: 'archive',
        prepared_at: new Date().toISOString(),
        next_state: { ...next, phase: 'archive' },
      }),
    );

    // 当前仍是 shape，既不等于 from(verify) 也不等于 to(archive) → 冲突。
    expect(await settlePendingTransition(tmp, changeName)).toBe('conflict');
    expect(await pendingExists()).toBe(true);
    const pending = await readPendingTransition(tmp, changeName);
    expect(pending?.event).toBe('verify-pass');

    const summaries = await listPendingTransitions(tmp);
    expect(summaries.map((entry) => entry.change)).toEqual([changeName]);

    const report = await runDoctor(tmp);
    expect(report.findings.map((finding) => finding.code)).toContain('pending-change-transition');
    expect(report.healthy).toBe(false);
  });

  it('is idempotent: settling twice changes nothing the second time', async () => {
    const state = await readChangeState(tmp, changeName);
    const next = applyChangeTransition(state, 'confirm-acceptance');
    await commitTransition(tmp, 'confirm-acceptance', state, next);
    await writeChangeState(tmp, state);

    expect(await settlePendingTransition(tmp, changeName)).toBe('none');
    expect(await settlePendingTransition(tmp, changeName)).toBe('none');
    expect(await fs.readFile(path.join(tmp, 'changes', changeName, 'comet-state.yaml'), 'utf8'))
      .toContain('phase: shape');
  });
});
