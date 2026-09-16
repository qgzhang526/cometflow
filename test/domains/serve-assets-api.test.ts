import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServe } from '../../domains/server/serve.js';
import type { ServeHandle } from '../../domains/server/serve.js';

/**
 * W5：把 8 面板之外的资产纳入界面——调度队列、Skill/Bundle、写入门禁预览、Classic。
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

function auth(): Record<string, string> {
  return { Authorization: 'Bearer ' + server.token };
}

async function get<T>(suffix: string): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const res = await fetch(server.url + base + suffix, { headers: auth() });
  return { status: res.status, body: (await res.json()) as ApiEnvelope<T> };
}

async function post<T>(suffix: string, payload: unknown): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const res = await fetch(server.url + base + suffix, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as ApiEnvelope<T> };
}

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-assets-ws-'));
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-assets-web-'));
  projectRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-assets-proj-')), 'fixture');
  await fs.cp(FIXTURE, projectRoot, { recursive: true });
  // fixture 的 skill 源在 skills/，已安装位置是 .cometflow/skills——安装一份才能测列表与详情。
  await fs.mkdir(path.join(projectRoot, '.cometflow', 'skills'), { recursive: true });
  await fs.cp(path.join(projectRoot, 'skills', 'safe-skill'), path.join(projectRoot, '.cometflow', 'skills', 'safe-skill'), {
    recursive: true,
  });

  server = await startServe({ workspaceRoot: workspace, webDir, port: 0, host: '127.0.0.1' });
  const imported = await fetch(server.url + '/api/projects/import', {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: projectRoot }),
  });
  const payload = (await imported.json()) as ApiEnvelope<{ project: { id: string } }>;
  base = '/api/projects/' + payload.data.project.id;
});

afterAll(async () => {
  await server.close();
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.rm(webDir, { recursive: true, force: true });
  await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
});

describe('scheduler / assets / guard API', () => {
  it('shows the scheduler queue, falling back to a derived view when no daemon has run', async () => {
    const { status, body } = await get<{
      queue: unknown | null;
      derived: { tasks: Array<{ goal: string; task: string; status: string }> };
      next: { goal: string; task: string } | null;
      scheduler: { mode?: string } | null;
    }>('/scheduler/queue');

    expect(status).toBe(200);
    // fixture 没跑过 daemon：队列文件不存在，但推导视图必须给出待办（G1/G2 各一个冻结任务）。
    expect(body.data.queue).toBeNull();
    expect(body.data.derived.tasks.length).toBeGreaterThanOrEqual(2);
    expect(body.data.next?.goal).toBe('G1');
    expect(body.data.derived.tasks.every((task) => task.status === 'queued')).toBe(true);
  });

  it('lists installed skills and reads one skill definition', async () => {
    const list = await get<{ skills: Array<{ name: string; files: string[] }> }>('/skills');
    expect(list.status).toBe(200);
    expect(list.body.data.skills.map((skill) => skill.name)).toEqual(['safe-skill']);

    const detail = await get<{ definition: { name: string }; files: string[]; content: string | null }>(
      '/skills/safe-skill',
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.definition.name).toBe('safe-skill');
    expect(detail.body.data.content).toContain('safe-skill');

    const missing = await get('/skills/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe('unknown-skill');

    const traversal = await get('/skills/..%2F..%2Fsafe-skill');
    expect(traversal.status).toBe(400);
    expect(traversal.body.error?.code).toBe('invalid-skill-name');
  });

  it('shows the bundle manifest and what it would compile to', async () => {
    const { status, body } = await get<{
      manifest: { name: string; skills: Array<{ name: string }> } | null;
      compiled: { files: string[] } | null;
      platforms: string[];
      error: string | null;
    }>('/bundles');

    expect(status).toBe(200);
    expect(body.data.manifest?.name).toBe('regression-bundle');
    expect(body.data.compiled?.files.length).toBe(2);
    expect(body.data.platforms).toContain('opencode');
    expect(body.data.error).toBeNull();
  });

  // C12：分发从「回 CLI」变成一次点击，但仍然保留预告环节。
  it('previews a bundle distribution, then writes it on confirmation', async () => {
    const preview = await post<{
      platform: string;
      skillsRoot: string;
      items: Array<{ name: string; target: string; overwritten: boolean }>;
      written: string[];
    }>('/bundles/distribute', { platform: 'opencode' });

    expect(preview.status).toBe(200);
    expect(preview.body.data.platform).toBe('opencode');
    expect(preview.body.data.skillsRoot.replace(/\\/gu, '/')).toContain('.opencode/skills');
    // 预告不落盘：这次调用不该写任何目录。
    expect(preview.body.data.written).toEqual([]);
    expect(preview.body.data.items.length).toBeGreaterThan(0);
    const firstTarget = preview.body.data.items[0].target;
    expect(await fs.access(firstTarget).then(() => true, () => false)).toBe(false);

    const done = await post<{ written: string[] }>('/bundles/distribute', { platform: 'opencode', dryRun: false });
    expect(done.status).toBe(200);
    expect(done.body.data.written.length).toBe(preview.body.data.items.length);
    // 执行后再看一次预告：这次每一项都已存在（会被替换），语义与 CLI 的 rm -rf + cp 一致。
    const again = await post<{ items: Array<{ overwritten: boolean }> }>('/bundles/distribute', { platform: 'opencode' });
    expect(again.body.data.items.every((item) => item.overwritten)).toBe(true);
  });

  it('rejects an unknown bundle platform', async () => {
    const bad = await post<unknown>('/bundles/distribute', { platform: 'not-a-platform' });
    expect(bad.status).toBe(400);
    expect(bad.body.error?.code).toBe('unknown-platform');
    expect(bad.body.error?.message).toContain('opencode');
  });

  it('previews write guard decisions without touching the working tree', async () => {
    // .cometflow 是机器状态：任何阶段都不允许写。
    const machine = await post<{ decision: { allowed: boolean; reason: string } }>('/hook/check', {
      target: '.cometflow/config.yaml',
      event: 'write',
    });
    expect(machine.status).toBe(200);
    expect(machine.body.data.decision.allowed).toBe(false);
    expect(machine.body.data.decision.reason).toBe('machine-owned-path');

    // 多个活跃 change 且没有指针时必须 fail closed，并给出修复建议。
    const ambiguous = await post<{ decision: { allowed: boolean; reason: string; hint?: string } }>('/hook/check', {
      target: 'src/core/index.ts',
      event: 'edit',
    });
    expect(ambiguous.body.data.decision.allowed).toBe(false);
    expect(ambiguous.body.data.decision.reason).toBe('multiple-active-changes');
    expect(ambiguous.body.data.decision.hint).toContain('change select');

    // 指定 current-change 之后，写入按该 change 的规则判定。
    await fs.writeFile(
      path.join(projectRoot, '.cometflow', 'current-change.json'),
      JSON.stringify({ schema: 'cometflow.current-change.v1', change: 'build-change', selected_at: new Date().toISOString(), source: 'manual' }),
    );
    const routed = await post<{ decision: { allowed: boolean; reason: string } }>('/hook/check', {
      target: 'src/core/index.ts',
      event: 'edit',
    });
    expect(routed.body.data.decision.allowed).toBe(true);
    expect(routed.body.data.decision.reason).toContain('build');
  });

  it('lists classic changes read-only', async () => {
    const { status, body } = await get<{ changes: Array<{ name: string; phase: string; profile: string }> }>('/classic');
    expect(status).toBe(200);
    expect(body.data.changes.map((change) => change.name)).toEqual(['classic-open']);
    expect(body.data.changes[0].phase).toBe('open');
  });
});
