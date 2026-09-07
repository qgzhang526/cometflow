import { describe, expect, it } from 'vitest';
import { applyClassicTransition } from '../../domains/classic/classic-transitions.js';
import type { ClassicState } from '../../domains/classic/types.js';

function state(profile: 'full' | 'hotfix' = 'full'): ClassicState {
  return {
    schema: 'cometflow.classic.v1',
    name: 'classic-1',
    goal: 'G1',
    task: 'T1',
    profile,
    phase: 'open',
    archived: false,
    created_at: new Date().toISOString(),
  };
}

describe('classic workflow', () => {
  it('full profile goes open → design → build → verify → archive', () => {
    let s = applyClassicTransition(state('full'), 'open-complete');
    expect(s.phase).toBe('design');
    s = applyClassicTransition(s, 'design-complete');
    expect(s.phase).toBe('build');
    s = applyClassicTransition(s, 'build-complete');
    expect(s.phase).toBe('verify');
    s = applyClassicTransition(s, 'verify-pass');
    expect(s.phase).toBe('archive');
    s = applyClassicTransition(s, 'archive-complete');
    expect(s.archived).toBe(true);
  });

  it('hotfix skips design phase', () => {
    const s = applyClassicTransition(state('hotfix'), 'open-complete');
    expect(s.phase).toBe('build');
  });
});
