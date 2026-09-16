import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServe } from '../../domains/server/serve.js';
import type { ServeHandle } from '../../domains/server/serve.js';
import { refreshSpecBaseline } from '../../domains/spec/spec-version.js';

/**
 * Spec 内核在 Web 端的投影：验收覆盖 / 一致性门禁 / 版本回放 / 影响分析。
 *
 * 用 regression fixture 作为被测项目，因为它同时具备 spec 版本仓、spec-lock、
 * 冻结任务与多个 change——这些正是这些端点要回答的问题所依赖的事实。
 */

const FIXTURE = path.join(process.cwd(), 'experiments', 'regression-fixture');

/** fixture 里 specs/** 下的 spec 文件；断言跟着 fixture 增长，不写死份数。 */
async function listSpecFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, 'specs'), { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

let server: ServeHandle;
let workspace: string;
let projectRoot: string;
let webDir: string;
let base: string;
let specFileCount: number;

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
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-spec-api-ws-'));
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-spec-api-web-'));
  projectRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-spec-api-proj-')), 'fixture');
  await fs.cp(FIXTURE, projectRoot, { recursive: true });

  server = await startServe({ workspaceRoot: workspace, webDir, port: 0, host: '127.0.0.1' });
  const imported = await fetch(server.url + '/api/projects/import', {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: projectRoot }),
  });
  const payload = (await imported.json()) as ApiEnvelope<{ project: { id: string } }>;
  base = '/api/projects/' + payload.data.project.id;
  specFileCount = (await listSpecFiles(projectRoot)).length;
});

afterAll(async () => {
  await server.close();
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.rm(webDir, { recursive: true, force: true });
  await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
});

describe('spec kernel API', () => {
  it('exposes acceptance coverage with executable checks', async () => {
    const { status, body } = await get<{
      anchors: Array<{ path: string; anchor: string; acceptance: Array<{ id: string; check: string | null }> }>;
      total: number;
      checked: number;
      unchecked: number;
    }>('/spec/checks');

    expect(status).toBe(200);
    expect(body.data.total).toBe(body.data.checked + body.data.unchecked);
    expect(body.data.checked).toBeGreaterThan(0);

    const auth = body.data.anchors.find((entry) => entry.path === 'specs/auth/spec.md');
    expect(auth?.anchor).toBe('POST /login');
    expect(auth?.acceptance[0].check).toContain('src/auth/index.ts');
  });

  it('exposes the integrity gate', async () => {
    const { status, body } = await get<{ valid: boolean; findings: Array<{ code: string; severity: string }> }>(
      '/spec/verify',
    );
    expect(status).toBe(200);
    expect(typeof body.data.valid).toBe('boolean');
    expect(Array.isArray(body.data.findings)).toBe(true);
  });

  it('diffs the current specs against the lock', async () => {
    const { status, body } = await get<{ added: unknown[]; modified: unknown[]; removed: unknown[]; unchanged: unknown[] }>(
      '/spec/diff',
    );
    expect(status).toBe(200);
    expect(body.data.unchanged.length).toBe(specFileCount);
    expect(body.data.modified).toHaveLength(0);

    // 改一份 spec：diff 必须能看见，并且影响分析要指出受影响的冻结任务。
    const corePath = path.join(projectRoot, 'specs', 'core', 'spec.md');
    const original = await fs.readFile(corePath, 'utf8');
    await fs.writeFile(corePath, original.replace('核心加法能力。', '核心加法能力（语义已变更）。'));

    const after = await get<{ modified: Array<{ path: string }>; unchanged: unknown[] }>('/spec/diff');
    expect(after.body.data.modified.map((entry) => entry.path)).toEqual(['specs/core/spec.md']);
    expect(after.body.data.unchanged.length).toBe(specFileCount - 1);

    const drift = await get<{ drift: Array<{ goal: string; task: string; kind: string; severity: string }> }>('/spec/drift');
    expect(drift.status).toBe(200);
    expect(drift.body.data.drift.some((entry) => entry.goal === 'G1' && entry.task === 'T1')).toBe(true);

    await fs.writeFile(corePath, original);
  });

  it('previews the impact of a change before archiving it', async () => {
    // 没有提案 spec 时，影响分析只看当前工作区。
    const plain = await get<{ summary: { files_changed: number }; untracked_changes: string[] }>('/spec/impact');
    expect(plain.status).toBe(200);
    expect(plain.body.data.summary.files_changed).toBe(0);

    // 给 build-change 放一份提案 spec（change 归档后才会应用），影响分析应当预演它的后果。
    const proposedDir = path.join(projectRoot, 'changes', 'build-change', 'specs', 'core');
    await fs.mkdir(proposedDir, { recursive: true });
    await fs.writeFile(
      path.join(proposedDir, 'spec.md'),
      [
        '---',
        'capability: core',
        'module: src/core',
        '---',
        '',
        '# core capability',
        '',
        '## CORE-001 add',
        '',
        '核心加法能力（提案改成返回两数之积）。',
        '',
        '## Acceptance',
        '',
        '- A1：add(1,2) 返回 2',
        '  - check: node -e "process.exit(0)"',
        '',
      ].join('\n'),
    );

    const overlayed = await get<{
      summary: { files_changed: number; anchors_changed: number; tasks_affected: number; highest_severity: string };
      affected_tasks: Array<{ goal: string; task: string; severity: string }>;
    }>('/spec/impact?change=build-change');

    expect(overlayed.status).toBe(200);
    expect(overlayed.body.data.summary.files_changed).toBe(1);
    expect(overlayed.body.data.summary.tasks_affected).toBeGreaterThan(0);
    expect(overlayed.body.data.affected_tasks.some((entry) => entry.goal === 'G1' && entry.task === 'T1')).toBe(true);
    expect(['low', 'medium', 'high']).toContain(overlayed.body.data.summary.highest_severity);
  });

  it('lists spec versions and replays a recorded version', async () => {
    const all = await get<{ specs: Record<string, Array<{ spec_version: number; hash: string }>> }>('/spec/versions');
    expect(all.status).toBe(200);
    expect(all.body.data.specs['specs/auth/spec.md'][0].spec_version).toBe(1);

    const filtered = await get<{ specs: Record<string, unknown> }>('/spec/versions?path=specs/auth/spec.md');
    expect(Object.keys(filtered.body.data.specs)).toEqual(['specs/auth/spec.md']);

    const version = await get<{ path: string; record: { spec_version: number }; content: string }>(
      '/spec/version?ref=' + encodeURIComponent('specs/auth/spec.md@1'),
    );
    expect(version.status).toBe(200);
    expect(version.body.data.path).toBe('specs/auth/spec.md');
    expect(version.body.data.record.spec_version).toBe(1);
    expect(version.body.data.content).toContain('# auth capability');

    const missing = await get('/spec/version?ref=' + encodeURIComponent('specs/auth/spec.md@99'));
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe('unknown-spec-version');
  });

  it('restores a recorded version without losing the current content', async () => {
    const versionRef = 'specs/auth/spec.md@1';
    const version = await get<{ content: string }>('/spec/version?ref=' + encodeURIComponent(versionRef));
    const specPath = path.join(projectRoot, 'specs', 'auth', 'spec.md');

    // 模拟一次「未登记的手工改动」：restore 之前必须先把它记进版本仓。
    await fs.writeFile(specPath, (await fs.readFile(specPath, 'utf8')) + '\n<!-- 手工改动 -->\n');

    const restored = await post<{ path: string; restoredFrom: number; spec_version: number }>('/spec/restore', {
      ref: versionRef,
    });

    expect(restored.status).toBe(200);
    expect(restored.body.data.path).toBe('specs/auth/spec.md');
    expect(restored.body.data.restoredFrom).toBe(1);
    expect(await fs.readFile(specPath, 'utf8')).toBe(version.body.data.content);

    const history = await get<{ specs: Record<string, Array<{ spec_version: number; hash: string; note: string | null }>> }>(
      '/spec/versions?path=specs/auth/spec.md',
    );
    const versions = history.body.data.specs['specs/auth/spec.md'];
    // v2 = restore 前的手工改动快照，v3 = 恢复后的内容（回到 v1 的 hash）。
    expect(versions.map((entry) => entry.spec_version)).toEqual([1, 2, 3]);
    expect(versions[1].note).toBe('pre-restore snapshot');
    expect(versions[2].hash).toBe(versions[0].hash);
  });

  it('records the current spec set as a baseline', async () => {
    const locked = await post<{ recorded: Array<{ path: string; spec_version: number }> }>('/spec/lock', {});
    expect(locked.status).toBe(200);
    expect(locked.body.data.recorded.length).toBe(specFileCount);

    const diff = await get<{ modified: unknown[]; added: unknown[]; removed: unknown[] }>('/spec/diff');
    expect(diff.body.data.modified).toHaveLength(0);
    expect(diff.body.data.added).toHaveLength(0);
    expect(diff.body.data.removed).toHaveLength(0);
  });

  it('accepts a spec proposal only for an existing change in shape phase', async () => {
    const proposed = await post<{ change: string; path: string; written: string }>('/spec/proposal', {
      change: 'shape-change',
      path: 'specs/core/spec.md',
      content: '# core（提案版）\n\n## CORE-001 add\n\n改动提案。\n',
    });
    expect(proposed.status).toBe(200);
    expect(proposed.body.data.written).toContain(path.join('changes', 'shape-change', 'specs', 'core', 'spec.md'));

    // 提案只有一种存放形态：change 目录下的 specs/ 副本，且能被反查。
    const listed = await get<{ proposals: Array<{ change: string; path: string }> }>('/spec/proposals?path=specs/core/spec.md');
    // 带 path 查询时会一并返回正文，所以按「change|path」比较而不是深比较整个对象。
    expect(listed.body.data.proposals.map((entry) => entry.change + '|' + entry.path)).toContain(
      'shape-change|specs/core/spec.md',
    );

    // 归档前影响分析能看到这份提案（复用 readProposedSpecs）。
    const impact = await get<{ summary: { files_changed: number } }>('/spec/impact?change=shape-change');
    expect(impact.body.data.summary.files_changed).toBe(1);

    // build 阶段的 change 不能再提契约提案；未知 change 直接 404。
    const wrongPhase = await post('/spec/proposal', { change: 'build-change', path: 'specs/core/spec.md', content: 'x' });
    expect(wrongPhase.status).toBe(409);
    expect(wrongPhase.body.error?.code).toBe('change-not-in-shape');
    const unknown = await post('/spec/proposal', { change: 'nope', path: 'specs/core/spec.md', content: 'x' });
    expect(unknown.status).toBe(404);
    const outside = await post('/spec/proposal', { change: 'shape-change', path: '../evil.md', content: 'x' });
    expect(outside.status).toBe(400);
  });

  it('scaffolds capability stubs from an explicit name list, idempotently', async () => {
    // capability 不由项目类型推导：只能点名（goal 的 scope 或外部标准）。
    // 探针用完即删——新增 spec 文件会让后续用例的 spec-lock 基线（specFileCount）失真。
    const probeDir = path.join(projectRoot, 'specs', 'api-probe');
    const probe = path.join(probeDir, 'spec.md');
    const created = await post<{ capabilities: { created: string[]; skipped: string[]; invalid: string[] } }>(
      '/spec/scaffold',
      { capabilities: ['api-probe'] },
    );
    expect(created.status).toBe(200);
    expect(created.body.data.capabilities.created).toEqual(['specs/api-probe/spec.md']);
    const stub = await fs.readFile(probe, 'utf8');
    expect(stub).toContain('module: internal/api-probe');
    expect(stub).toContain('## Acceptance');

    // 幂等：第二次不新建、也不覆盖已存在的内容。
    const second = await post<{ capabilities: { created: string[]; skipped: string[] } }>('/spec/scaffold', {
      capabilities: ['api-probe'],
    });
    expect(second.body.data.capabilities.created).toEqual([]);
    expect(second.body.data.capabilities.skipped).toEqual(['specs/api-probe/spec.md']);
    expect(await fs.readFile(probe, 'utf8')).toBe(stub);

    // 非法名字只报不写：既不落盘，也不影响同一请求里的合法项。
    const mixed = await post<{ capabilities: { created: string[]; invalid: string[] } }>('/spec/scaffold', {
      capabilities: ['../escape', '.hidden', 'api-probe-2'],
    });
    expect(mixed.status).toBe(200);
    expect(mixed.body.data.capabilities.invalid).toEqual(['../escape', '.hidden']);
    expect(mixed.body.data.capabilities.created).toEqual(['specs/api-probe-2/spec.md']);
    expect(await fs.access(path.join(projectRoot, 'escape')).then(() => true, () => false)).toBe(false);

    await fs.rm(probeDir, { recursive: true, force: true });
    await fs.rm(path.join(projectRoot, 'specs', 'api-probe-2'), { recursive: true, force: true });
    expect(await fs.access(probe).then(() => true, () => false)).toBe(false);
  });

  it('derives root kinds from the project context when the caller omits stack hints', async () => {
    // 缺 stack 时退回项目上下文（与 CLI 同源）：否则空串会被判成 absent，
    // 点一次「生成 / 补全」就把 models 写成「本项目不需要」。
    const contextPath = path.join(projectRoot, '.cometflow', 'project-context.yaml');
    const manifestPath = path.join(projectRoot, '.cometflow', 'init-manifest.yaml');
    const contextBefore = await fs.readFile(contextPath, 'utf8');
    const manifestBefore = await fs.readFile(manifestPath, 'utf8');
    await fs.writeFile(
      contextPath,
      'schema: cometflow.project-context.v1\ntech_stack:\n  frontend: 无\n  backend: TypeScript\n  database: PostgreSQL\nruntime: {}\nshared_paths: []\n',
    );
    try {
      const asked = await post<{ kinds: Record<string, { status: string }> }>('/spec/scaffold', {});
      expect(asked.status).toBe(200);
      // database != none → models present；frontend == none → pages absent。
      expect(asked.body.data.kinds.models.status).toBe('present');
      expect(asked.body.data.kinds.pages.status).toBe('absent');
    } finally {
      await fs.writeFile(contextPath, contextBefore);
      await fs.writeFile(manifestPath, manifestBefore);
    }
  });

  it('approves a draft spec, and refuses paths outside specs/', async () => {
    const probeDir = path.join(projectRoot, 'specs', 'api-draft-probe');
    const probe = path.join(probeDir, 'spec.md');
    await fs.mkdir(probeDir, { recursive: true });
    await fs.writeFile(
      probe,
      '---\ncapability: api-draft-probe\nstatus: draft\n---\n\n# api-draft-probe\n\n## H1\n\n需求。\n\n## 验收\n\n- A001：第一条\n',
    );

    // 列表带状态：界面据此显示「草案 / 已定稿」与「批准定稿」按钮。
    const listed = await get<{ entries: Array<{ path: string; status: string }> }>('/specs');
    expect(listed.body.data.entries.find((entry) => entry.path === 'specs/api-draft-probe/spec.md')?.status).toBe('draft');

    const approved = await post<{ changed: boolean; previous: string; status: string }>('/spec/approve', {
      path: 'specs/api-draft-probe/spec.md',
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data.changed).toBe(true);
    expect(approved.body.data.previous).toBe('draft');
    expect(await fs.readFile(probe, 'utf8')).toContain('status: approved');

    // 已经是 approved：不重写文件，也不记新版本。
    const again = await post<{ changed: boolean }>('/spec/approve', { path: 'specs/api-draft-probe/spec.md' });
    expect(again.body.data.changed).toBe(false);

    const outside = await post('/spec/approve', { path: '../evil.md' });
    expect(outside.status).toBe(400);
    expect(outside.body.error?.code).toBe('invalid-spec-path');
    const missing = await post('/spec/approve', {});
    expect(missing.status).toBe(400);

    // 探针删掉并把基线刷回去，避免给后续用例留下 stale-spec-lock。
    await fs.rm(probeDir, { recursive: true, force: true });
    await refreshSpecBaseline(projectRoot, { note: 'test cleanup' });
  });
});
