import type { ClassicEvent, ClassicState } from './types.js';

export function applyClassicTransition(state: ClassicState, event: ClassicEvent): ClassicState {
  if (state.archived) throw new Error('Classic change is already archived');

  if (event === 'open-complete') {
    if (state.phase !== 'open') throw new Error('open-complete requires open phase');
    return { ...state, phase: state.profile === 'full' ? 'design' : 'build' };
  }
  if (event === 'design-complete') {
    if (state.phase !== 'design') throw new Error('design-complete requires design phase');
    return { ...state, phase: 'build' };
  }
  if (event === 'build-complete') {
    if (state.phase !== 'build') throw new Error('build-complete requires build phase');
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
    return { ...state, archived: true };
  }
  throw new Error('Unknown Classic event: ' + event);
}
