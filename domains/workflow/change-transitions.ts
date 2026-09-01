import type { ChangeEvent, ChangeState } from './change-types.js';

export function applyChangeTransition(state: ChangeState, event: ChangeEvent): ChangeState {
  if (state.archived) throw new Error('Change is already archived');

  if (event === 'confirm-acceptance') {
    if (state.phase !== 'shape') throw new Error('confirm-acceptance requires shape phase');
    if (state.acceptance_ids.length === 0) throw new Error('Acceptance must be frozen before build');
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

  if (event === 'archive-complete') {
    if (state.phase !== 'archive') throw new Error('archive-complete requires archive phase');
    return { ...state, status: 'done' as const, archived: true };
  }

  throw new Error('Unknown change event: ' + event);
}
