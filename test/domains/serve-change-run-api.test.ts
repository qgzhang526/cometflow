import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServe } from '../../domains/server/serve.js';
import type { ServeHandle } from '../../domains/server/serve.js';

/**
 * Changes 面板的「运行 Builder」走的就是这条 API（`POST /changes/<name>/run`）。
 *
 * 面板上 agent 选择旁边有一个可选的模型输入框：留空即不传 `model`，由服务端回退到
 * `.cometflow/config.yaml`；填了就必须真的透传到 Builder，并出现在 job 日志里
 * （否则界面上写着模型、跑起来却是另一个，属于最难发现的那种错）。
 *
 * 用夹具的临时副本跑：`build-change` 是夹具里唯一处于 build 阶段的 change，
 * 跑完会推进到 verify，所以第二个用例前把它复原。
 */
const FIXTURE = path.join(process.cwd(), 'experiments', 'regression-fixture');
const BUILD_STATE = [
  'schema: cometflow.change.v1',
  'name: build-change',
  'goal: G1',
  'task: T1',
  'phase: build',
  'status: active',
  'spec_ref: specs/core/spec.md',
  'spec_anchor: CORE-001 add',
  'acceptance_ids: [A1]',
  'spec_version: 1',
  'spec_hash: null',
  'created_at: "2026-01-01T00:00:00.000Z"',
  'archived: false',
  '',
].join('\n');

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

interface JobView {
  status: string;
  logTail: string[];
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

async function waitForJob(jobId: string): Promise<JobView> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const polled = await call<{ job: JobView }>('GET', '/api/jobs/' + jobId);
    if (polled.data.job.status === 'succeeded' || polled.data.job.status === 'failed') {
      return polled.data.job;
    }
  }
  throw new Error('任务在 30s 预算内没有进入终态：' + jobId);
}

async function resetBuildChange(): Promise<void> {
  await fs.writeFile(path.join(projectRoot, 'changes', 'build-change', 'comet-state.yaml'), BUILD_STATE);
}

async function runBuilder(body: Record<string, unknown>): Promise<JobView> {
  const started = await call<{ jobId: string }>('POST', base + '/changes/build-change/run', body);
  expect(started.ok, started.error?.message).toBe(true);
  return waitForJob(started.data.jobId);
}

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-run-api-ws-'));
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-run-api-web-'));
  projectRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-run-api-proj-')), 'fixture');
  await fs.cp(FIXTURE, projectRoot, { recursive: true });
  await resetBuildChange();

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

describe('changes run API（面板的模型输入框）', () => {
  it('显式 model 会透传并写进 job 日志，跑完推进到 verify', async () => {
    const job = await runBuilder({ agent: 'mock', model: 'deepseek/deepseek-flash' });
    expect(job.status, job.logTail.join('\n')).toBe('succeeded');
    expect(job.logTail.join('\n')).toContain('model=deepseek/deepseek-flash');
    const state = await call<{ phase: string }>('GET', base + '/changes/build-change');
    expect(state.data.phase).toBe('verify');
  });

  it('不给 model 时不写进日志（回退项目配置；本夹具没配 → 交给 Agent 默认值）', async () => {
    await resetBuildChange();
    const job = await runBuilder({ agent: 'mock' });
    expect(job.status, job.logTail.join('\n')).toBe('succeeded');
    expect(job.logTail.join('\n')).not.toContain('model=');
  });
});
