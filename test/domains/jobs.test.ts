import { describe, expect, it } from 'vitest';
import { JobManager, MAX_RETAINED_JOBS } from '../../domains/server/jobs.js';

describe('JobManager', () => {
  it('keeps the structured result so it survives a page reload', () => {
    const jobs = new JobManager();
    const job = jobs.create('project-1', 'eval-run');
    jobs.start(job.id);
    jobs.complete(job.id, { report: { passed: true, passAtKRate: 1 } }, 0);

    const reloaded = jobs.get(job.id);
    expect(reloaded?.status).toBe('succeeded');
    expect(reloaded?.result).toEqual({ report: { passed: true, passAtKRate: 1 } });
    expect(reloaded?.exitCode).toBe(0);
  });

  it('does not overwrite an existing result with undefined', () => {
    const jobs = new JobManager();
    const job = jobs.create('project-1', 'change-run');
    jobs.complete(job.id, { state: { phase: 'verify' } });
    jobs.complete(job.id);
    expect((jobs.get(job.id)?.result as { state: unknown }).state).toEqual({ phase: 'verify' });
  });

  it('records failure details and caps the log tail', () => {
    const jobs = new JobManager();
    const job = jobs.create('project-1', 'change-run', { change: 'auth-login' });
    jobs.start(job.id);
    for (let index = 0; index < 520; index += 1) jobs.log(job.id, 'line ' + index);
    jobs.fail(job.id, 'boom', 1);

    const record = jobs.get(job.id);
    expect(record?.status).toBe('failed');
    expect(record?.error).toBe('boom');
    expect(record?.logTail.length).toBe(500);
    expect(record?.logTail[0]).toBe('line 20');
  });

  it('broadcasts events to subscribers', () => {
    const jobs = new JobManager();
    const seen: string[] = [];
    const unsubscribe = jobs.subscribe((event) => seen.push(event.type));
    const job = jobs.create('project-1', 'eval-run');
    jobs.start(job.id);
    jobs.log(job.id, 'hello');
    jobs.stateChanged('project-1', '/api/specs');
    jobs.complete(job.id, { report: {} });
    unsubscribe();
    jobs.create('project-1', 'eval-run');

    expect(seen).toEqual(['job.queued', 'job.started', 'job.log', 'state.changed', 'job.completed']);
  });

  it('caps retained jobs but never evicts queued or running work', () => {
    const jobs = new JobManager();
    const running = jobs.create('project-1', 'change-run');
    jobs.start(running.id);
    for (let index = 0; index < MAX_RETAINED_JOBS + 20; index += 1) {
      const job = jobs.create('project-1', 'eval-run');
      jobs.complete(job.id, { index });
    }

    // 超限时从最旧的「已结束」任务开始淘汰，运行中的那个必须留下。
    expect(jobs.list().length).toBeLessThanOrEqual(MAX_RETAINED_JOBS + 1);
    expect(jobs.get(running.id)?.status).toBe('running');
    expect(jobs.list().some((job) => job.status === 'running')).toBe(true);
  });

  it('clears only finished jobs', () => {
    const jobs = new JobManager();
    const running = jobs.create('project-1', 'change-run');
    jobs.start(running.id);
    const queued = jobs.create('project-1', 'eval-run');
    const done = jobs.create('project-1', 'eval-run');
    jobs.complete(done.id, { report: {} });
    const failed = jobs.create('project-1', 'eval-run');
    jobs.fail(failed.id, 'boom');

    expect(jobs.clearFinished()).toBe(2);
    expect(jobs.get(running.id)).toBeDefined();
    expect(jobs.get(queued.id)).toBeDefined();
    expect(jobs.get(done.id)).toBeUndefined();
    expect(jobs.get(failed.id)).toBeUndefined();
  });
});
