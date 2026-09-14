import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobManager, type JobRecord } from '../../domains/server/jobs.js';
import {
  appendJobLog,
  applyJobGc,
  collectJobUsage,
  jobDir,
  listJobRecords,
  planJobGc,
  readJobLog,
  writeJobRecord,
} from '../../domains/server/job-store.js';
import { REDACTED } from '../../platform/io/redact.js';

/**
 * N3：任务与日志落盘，重启后仍在；过期任务可回收；日志落盘前脱敏。
 */

let tmp: string;

function record(id: string, overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id,
    projectId: 'project-1',
    kind: 'eval-run',
    status: 'succeeded',
    createdAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    logTail: [],
    ...overrides,
  };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-job-store-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('job store', () => {
  it('round-trips records with their log tail', async () => {
    await writeJobRecord(tmp, record('job_a'));
    await appendJobLog(tmp, 'job_a', 'first line');
    await appendJobLog(tmp, 'job_a', 'second line');

    const records = await listJobRecords(tmp);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('job_a');
    expect(records[0].logTail).toEqual(['first line', 'second line']);
  });

  it('redacts secrets before they hit the disk', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345';
    await appendJobLog(tmp, 'job_secret', 'token=' + secret);

    const raw = await fs.readFile(path.join(jobDir(tmp), 'job_secret.log'), 'utf8');
    expect(raw).not.toContain(secret);
    expect(raw).toContain(REDACTED);
    expect(await readJobLog(tmp, 'job_secret')).toHaveLength(1);
  });

  it('rotates oversized logs and still returns the recent tail', async () => {
    // 三次大写入就跨过 1 MiB：比「追加一万行」快得多，且覆盖同一段轮转逻辑。
    // 内容要有多样性：一整行同字符会把脱敏正则推到灾难性回溯（这条断言也因此暴露过真实风险）。
    const big = 'rotation sample '.repeat(40000);
    await appendJobLog(tmp, 'job_big', 'first:' + big);
    await appendJobLog(tmp, 'job_big', 'second:' + big);
    await appendJobLog(tmp, 'job_big', 'third:' + big);

    await fs.access(path.join(jobDir(tmp), 'job_big.log.1'));
    const tail = await readJobLog(tmp, 'job_big', 2);
    expect(tail).toHaveLength(2);
    expect(tail[1]).toContain('third:');
    expect(tail[0]).toContain('second:');
  });

  it('plans GC for finished jobs outside the retention window and keeps running ones', async () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    await writeJobRecord(tmp, record('job_old', { createdAt: '2026-01-01T00:00:00.000Z' }));
    await writeJobRecord(tmp, record('job_recent', { createdAt: '2026-05-31T00:00:00.000Z' }));
    await writeJobRecord(tmp, record('job_running', { status: 'running', createdAt: '2026-01-01T00:00:00.000Z' }));

    const plan = await planJobGc(tmp, { now, retentionDays: 30, retentionCount: 0 });
    expect(plan.candidates.map((candidate) => candidate.id)).toEqual(['job_old']);
    expect(plan.running).toBe(1);

    const applied = await applyJobGc(tmp, plan);
    expect(applied.removed).toBe(1);
    expect((await listJobRecords(tmp)).map((entry) => entry.id).sort()).toEqual(['job_recent', 'job_running']);

    const usage = await collectJobUsage(tmp);
    expect(usage.finished).toBe(1);
    expect(usage.running).toBe(1);
    expect(usage.bytes).toBeGreaterThan(0);
  });

  it('persists through JobManager and clears finished job files on demand', async () => {
    const jobs = new JobManager({ resolveProjectRoot: async () => tmp });
    const running = jobs.create('project-1', 'change-run');
    jobs.start(running.id);
    jobs.log(running.id, 'hello from builder');
    const finished = jobs.create('project-1', 'eval-run');
    jobs.start(finished.id);
    jobs.log(finished.id, 'eval done');
    jobs.complete(finished.id, { report: { passed: true } });
    await jobs.flush();

    // 换个 JobManager 读回磁盘：这就是「重启 serve 后任务还在」。
    const restarted = new JobManager({ resolveProjectRoot: async () => tmp });
    await restarted.hydrate('project-1', tmp);
    expect(restarted.get(finished.id)?.result).toEqual({ report: { passed: true } });
    expect(restarted.get(finished.id)?.logTail).toContain('eval done');
    expect(restarted.get(running.id)?.status).toBe('running');

    expect(await restarted.clearFinished()).toBe(1);
    await expect(fs.access(path.join(jobDir(tmp), finished.id + '.json'))).rejects.toThrow();
    await fs.access(path.join(jobDir(tmp), running.id + '.json'));
  });
});
