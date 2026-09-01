import { describe, expect, it } from 'vitest';
import { idleGovernorAllows } from '../../domains/scheduler/idle-governor.js';
import { Budget } from '../../domains/scheduler/budget.js';

describe('idle governor', () => {
  it('always allows in always mode', () => {
    expect(idleGovernorAllows('always', { loadavg1: 99, idleCpuThreshold: 1 }).allowed).toBe(true);
  });

  it('blocks idle mode when cpu is busy', () => {
    expect(idleGovernorAllows('idle', { loadavg1: 5, idleCpuThreshold: 1 }).allowed).toBe(false);
  });

  it('allows idle mode when cpu is free', () => {
    expect(idleGovernorAllows('idle', { loadavg1: 0.2, idleCpuThreshold: 1 }).allowed).toBe(true);
  });
});

describe('budget', () => {
  it('tracks elapsed time', () => {
    const budget = new Budget({ budgetMs: 100, startedAt: 1000 });
    expect(budget.elapsedMs(1100)).toBe(100);
    expect(budget.isExhausted(1099)).toBe(false);
    expect(budget.isExhausted(1100)).toBe(true);
  });
});
