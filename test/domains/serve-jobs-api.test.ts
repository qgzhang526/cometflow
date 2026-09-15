import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServe } from '../../domains/server/serve.js';
import type { ServeHandle } from '../../domains/server/serve.js';

/**
 * W4：任务中心的两件事——刷新后仍能看到任务、已结束的任务可以清理。
 */

const FIXTURE = path.join(process.cwd(), 'experiments', 'regression-fixture');

let server: ServeHandle;
let workspace: string;
let webDir: string;
let projectRoot: string;
let base: string;

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
}

/**
 * 轮询任务到终态。
 *
 * 原来两个用例各自写死「80 × 150ms = 12s」：在负载高的 CI runner 上任务还没跑完，
 * 断言就拿到了 `undefined`，报出来是「expected undefined to be true」——看起来像功能坏了，
 * 其实是预算太短（Windows runner 上就是这么红的）。这里把预算放宽到 ~45s，
 * 并在超时后抛出**说得清**的错误；用例本身另有 60s 上限兜底。
 */
async function waitForJob(jobId: string): Promise<{ status: string }> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const polled = await call<{ job: { status: string } }>('GET', '/api/jobs/' + jobId);
    if (polled.data.job.status === 'succeeded' || polled.data.job.status === 'failed') {
      return polled.data.job;
    }
  }
  throw new Error('任务在 45s 预算内没有进入终态：' + jobId);
}

async function call<T>(
  method: 'GET' | 'POST' | 'DELETE',
  suffix: string,
  payload?: unknown,
): Promise<ApiEnvelope<T>> {
  const res = await fetch(server.url + suffix, {
    method,
    headers:
      payload === undefined
        ? { Authorization: 'Bearer ' + server.token }
        : { Authorization: 'Bearer ' + server.token, 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return (await res.json()) as ApiEnvelope<T>;
}

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-jobs-api-ws-'));
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-jobs-api-web-'));
  projectRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-jobs-api-proj-')), 'fixture');
  await fs.cp(FIXTURE, projectRoot, { recursive: true });

  server = await startServe({ workspaceRoot: workspace, webDir, port: 0, host: '127.0.0.1' });
  const imported = await call<{ project: { id: string } }>('POST', '/api/projects/import', { path: projectRoot });
  base = '/api/projects/' + imported.data.project.id;
});

afterAll(async () => {
  await server.close();
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.rm(webDir, { recursive: true, force: true });
  await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
});

describe('jobs API', () => {
  it('keeps jobs and their results across a serve restart', async () => {
    const started = await call<{ jobId: string }>('POST', base + '/eval/run', {});
    const jobId = started.data.jobId;
    await waitForJob(jobId);

    // 重启：新进程、新的内存态，任务与结果应当从 .cometflow/runtime/jobs/ 读回来。
    await server.close();
    server = await startServe({ workspaceRoot: workspace, webDir, port: 0, host: '127.0.0.1' });

    const reopened = await call<{ job: { id: string; result?: { report?: { passed: boolean } }; logTail: string[] } }>(
      'GET',
      '/api/jobs/' + jobId,
    );
    expect(reopened.data.job.id).toBe(jobId);
    expect(reopened.data.job.result?.report?.passed).toBe(true);
    expect(reopened.data.job.logTail.length).toBeGreaterThan(0);
  }, 60000);

  it('keeps job results available after the fact and clears finished jobs on demand', async () => {
    const started = await call<{ jobId: string }>('POST', base + '/eval/run', {});
    const jobId = started.data.jobId;

    let job: { status: string; result?: { report?: { passed: boolean } } } | null = null;
    await waitForJob(jobId);
    const settled = await call<{ job: { status: string; result?: { report?: { passed: boolean } } } }>(
      'GET',
      '/api/jobs/' + jobId,
    );
    job = settled.data.job;

    expect(job?.status).toBe('succeeded');
    // 结果随任务留存：刷新页面（重新 GET /api/jobs）之后仍拿得到 eval 报告。
    expect(job?.result?.report?.passed).toBe(true);

    const before = await call<{ jobs: Array<{ id: string; status: string }> }>('GET', '/api/jobs');
    expect(before.data.jobs.some((entry) => entry.id === jobId)).toBe(true);

    const cleared = await call<{ removed: number }>('DELETE', '/api/jobs');
    expect(cleared.data.removed).toBeGreaterThanOrEqual(1);

    const after = await call<{ jobs: Array<{ id: string; status: string }> }>('GET', '/api/jobs');
    expect(after.data.jobs.some((entry) => entry.id === jobId)).toBe(false);
    expect(after.data.jobs.every((entry) => entry.status === 'queued' || entry.status === 'running')).toBe(true);
  }, 60000);
});
