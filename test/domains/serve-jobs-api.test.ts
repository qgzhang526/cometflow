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
  it('keeps job results available after the fact and clears finished jobs on demand', async () => {
    const started = await call<{ jobId: string }>('POST', base + '/eval/run', {});
    const jobId = started.data.jobId;

    let job: { status: string; result?: { report?: { passed: boolean } } } | null = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const polled = await call<{ job: { status: string; result?: { report?: { passed: boolean } } } }>(
        'GET',
        '/api/jobs/' + jobId,
      );
      job = polled.data.job;
      if (job.status === 'succeeded' || job.status === 'failed') break;
    }

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
  });
});
