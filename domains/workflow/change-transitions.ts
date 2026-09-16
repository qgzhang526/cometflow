import type { ChangeEvent, ChangeState } from './change-types.js';

export function applyChangeTransition(state: ChangeState, event: ChangeEvent): ChangeState {
  if (state.archived) throw new Error('Change is already archived');

  if (event === 'confirm-acceptance') {
    if (state.phase !== 'shape') throw new Error('confirm-acceptance requires shape phase');
    // 起草类 change（task_kind: spec-authoring）没有 acceptance 可确认：它的产物就是那份 spec，
    // 验收条件写在该任务的 DoD 里，由验收/归档时的 `spec validate` 把关（G4）。
    // 不放开这一条，起草任务会被永久卡在 shape 阶段——「先起草 spec」这条路根本走不通。
    const authoring = state.task_kind === 'spec-authoring';
    if (!authoring && state.acceptance_ids.length === 0) throw new Error('Acceptance must be frozen before build');
    return { ...state, phase: 'build' };
  }

  if (event === 'submit-candidate') {
    if (state.phase !== 'build') throw new Error('submit-candidate requires build phase');
    return { ...state, phase: 'verify' };
  }

  if (event === 'verify-pass') {
    if (state.phase !== 'verify') throw new Error('verify-pass requires verify phase');
    return { ...state, phase: 'archive' };
  }

  if (event === 'verify-fail') {
    if (state.phase !== 'verify') throw new Error('verify-fail requires verify phase');
    return { ...state, phase: 'build' };
  }

  if (event === 'archive-complete') {
    if (state.phase !== 'archive') throw new Error('archive-complete requires archive phase');
    return { ...state, status: 'done' as const, archived: true };
  }

  throw new Error('Unknown change event: ' + event);
}
