import { describe, expect, it } from 'vitest';
import { markTaskPlanApproved, markTaskPlanReviewed } from '../../domains/task-plan/task-plan-store.js';
import type { TaskPlan } from '../../domains/task-plan/types.js';

function draftPlan(): TaskPlan {
  return {
    schema: 'cometflow.task-plan.v1',
    goal: 'G1',
    status: 'draft',
    tasks: [],
  };
}

describe('task plan review/approve', () => {
  it('moves draft → validated → approved', () => {
    const reviewed = markTaskPlanReviewed(draftPlan());
    expect(reviewed.status).toBe('validated');
    const approved = markTaskPlanApproved(reviewed);
    expect(approved.status).toBe('approved');
  });

  it('rejects reviewing a frozen plan', () => {
    expect(() => markTaskPlanReviewed({ ...draftPlan(), status: 'frozen' })).toThrow();
  });
});
