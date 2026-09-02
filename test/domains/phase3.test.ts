import { describe, expect, it } from 'vitest';
import { buildRollbackGuidance } from '../../domains/scheduler/git-safety.js';
import { idleGovernorAllows } from '../../domains/scheduler/idle-governor.js';
import { markQueueTask, nextQueuedTask, queueFromPlan } from '../../domains/scheduler/queue.js';
import { parseScheduleWindow } from '../../domains/scheduler/schedule.js';
import type { TaskPlan } from '../../domains/task-plan/types.js';

function frozenPlan(): TaskPlan {
  return {
    schema: 'cometflow.task-plan.v1',
    goal: 'G1',
    status: 'frozen',
    tasks: [
      { id: "T1", title: "task one", kind: "implementation", capability: "auth", spec_ref: null, spec_anchor: null, acceptance_ids: [], spec_version: null, spec_hash: null, depends_on: [], test_scope: "", definition_of_done: [], status: "frozen" },
      { id: "T2", title: "task two", kind: "implementation", capability: "auth", spec_ref: null, spec_anchor: null, acceptance_ids: [], spec_version: null, spec_hash: null, depends_on: [], test_scope: "", definition_of_done: [], status: "frozen" },
    ],
  };
}

describe('scheduler queue', () => {
  it('builds, advances, and marks queue tasks', () => {
    const queue = { schema: "cometflow.queue.v1" as const, tasks: queueFromPlan(frozenPlan()) };
    const first = nextQueuedTask(queue);
    expect(first?.id).toBe('G1:T1');
    const running = markQueueTask(queue, "G1:T1", "running");
    expect(running.tasks[0].attempts).toBe(1);
    const done = markQueueTask(running, "G1:T1", "done");
    expect(nextQueuedTask(done)?.id).toBe('G1:T2');
  });
});

describe('schedule window', () => {
  it('parses HH:MM', () => {
    expect(parseScheduleWindow('22:00', '06:00')).toEqual({ startMinutes: 1320, endMinutes: 360 });
  });

  it('supports cross-midnight windows', () => {
    expect(idleGovernorAllows('schedule', { loadavg1: 0, idleCpuThreshold: 1, scheduleStartMinutes: 1320, scheduleEndMinutes: 360, nowMinutes: 0 }).allowed).toBe(true);
    expect(idleGovernorAllows('schedule', { loadavg1: 0, idleCpuThreshold: 1, scheduleStartMinutes: 1320, scheduleEndMinutes: 360, nowMinutes: 720 }).allowed).toBe(false);
  });
});

describe('git safety guidance', () => {
  it('builds rollback guidance from a snapshot', () => {
    const lines = buildRollbackGuidance({
      schema: 'cometflow.git-safety.v1',
      head: 'abc123',
      dirtyFiles: ['src/a.ts'],
      bundlePath: null,
      created_at: new Date().toISOString(),
    });
    expect(lines.join('\n')).toContain('abc123');
    expect(lines.join('\n')).toContain('src/a.ts');
    expect(lines.join('\n')).toContain('git reset --hard');
  });
});
