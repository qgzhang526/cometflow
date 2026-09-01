export type SchedulerMode = 'always' | 'idle' | 'schedule' | 'manual';

export interface IdleGovernorOptions {
  loadavg1: number;
  idleCpuThreshold: number;
  scheduleStartMinutes?: number;
  scheduleEndMinutes?: number;
  nowMinutes?: number;
}

export interface IdleDecision {
  allowed: boolean;
  reason: string;
}

export function idleGovernorAllows(
  mode: SchedulerMode,
  options: IdleGovernorOptions,
): IdleDecision {
  if (mode === 'always') return { allowed: true, reason: 'always' };
  if (mode === 'manual') return { allowed: false, reason: 'manual-only' };

  if (mode === 'idle') {
    if (options.loadavg1 <= options.idleCpuThreshold) {
      return { allowed: true, reason: 'idle' };
    }
    return { allowed: false, reason: 'cpu-busy' };
  }

  if (mode === 'schedule') {
    const now = options.nowMinutes ?? 0;
    const start = options.scheduleStartMinutes;
    const end = options.scheduleEndMinutes;
    if (start === undefined || end === undefined) {
      return { allowed: false, reason: 'no-schedule-window' };
    }
    const allowed = start <= end ? now >= start && now < end : now >= start || now < end;
    return { allowed, reason: allowed ? 'in-window' : 'outside-window' };
  }

  return { allowed: false, reason: 'unknown-mode' };
}
