import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServe } from '../../domains/server/serve.js';
import type { ServeHandle } from '../../domains/server/serve.js';
import { runSpecGates } from '../../domains/gates/spec-gates.js';
import { collectSpecAnchors } from '../../domains/spec/spec-anchors.js';
import { readTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { traceTaskPlan } from '../../domains/task-plan/task-plan-trace.js';

/**
 * V3 可见性批次：门禁（gate check / status）、任务追溯（plan trace）、锚点平铺（spec anchors）、
 * 表格导入（spec import 的粘贴流程）。
 *
 * 每一项都要求「界面看到的 = CLI 看到的」：门禁与 `gate check`、追溯与 `plan trace`、
 * 锚点与 `spec anchors` 共用同一份投影；导入的预览必须与实际写入的分组规则一致。
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
  error?: { code: string; message: string } | null;
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
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-gates-ws-'));
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-gates-web-'));
  projectRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-gates-proj-')), 'fixture');
  await fs.cp(FIXTURE, projectRoot, { recursive: true });

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

describe('V3：门禁可见性', () => {
  it('GET /gate 的判定与 gate check 同源，且同时给出安装状态', async () => {
    const { status, body } = await get<{
      check: { ok: boolean; steps: Array<{ name: string; ok: boolean; detail: string | null }> };
      install: { isRepository: boolean; installed: boolean; drifted: boolean; host: string } | { isRepository: boolean };
    }>('/gate');
    expect(status).toBe(200);

    const direct = await runSpecGates(projectRoot);
    expect(body.data.check.ok).toBe(direct.ok);
    expect(body.data.check.steps).toEqual(direct.steps);
    expect(body.data.check.steps.length).toBeGreaterThan(0);
    for (const step of body.data.check.steps) {
      expect(typeof step.name).toBe('string');
      expect(typeof step.ok).toBe('boolean');
    }

    // 夹具是 git 仓库（回归脚本在它上面跑提交门禁），所以这里应当给出真实的 hook 状态。
    expect(typeof body.data.install.isRepository).toBe('boolean');
  });
});

describe('V3：锚点平铺', () => {
  it('GET /spec/anchors 与 collectSpecAnchors 逐条相等，且覆盖所有锚点（不只带验收的）', async () => {
    const { status, body } = await get<{
      entries: Array<{
        path: string;
        kind: string;
        anchor: string;
        acceptance: number;
        checked: number;
        bound_tasks: string[];
      }>;
      totals: {
        anchors: number;
        bound: number;
        unbound: number;
        acceptance: number;
        checked: number;
        structural: number;
      };
    }>('/spec/anchors');
    expect(status).toBe(200);

    const direct = await collectSpecAnchors(projectRoot);
    expect(body.data.entries).toEqual(direct.entries);
    expect(body.data.totals).toEqual(direct.totals);

    expect(body.data.entries.length).toBe(body.data.totals.anchors);
    expect(body.data.totals.bound + body.data.totals.unbound).toBe(body.data.totals.anchors);
    for (const entry of body.data.entries) {
      expect(entry.path.startsWith('specs/')).toBe(true);
      expect(entry.anchor).not.toBe('');
      // 可执行验收数不会超过有效验收数。
      expect(entry.checked).toBeLessThanOrEqual(entry.acceptance);
      /**
       * 只有 capability spec 的契约标题是"可绑定锚点"（任务用 `spec_anchor` 指向它），
       * 与 `anchor_coverage_rate` 同口径。其它 kind 的标题是文档结构——flow 的三段式骨架、
       * models 的实体清单、constraints 的各条约束……它们不参与绑定，不该出现在这张表里
       * （曾经的事故：flow 的 `前置条件 / 步骤 / 后置条件` 被当成锚点，"验收覆盖"里一堆噪音）。
       */
      expect(entry.kind).toBe('capability');
      expect(entry.path.startsWith('specs/flows/')).toBe(false);
    }
    // 夹具里有冻结任务绑定 anchor（覆盖率 0.75），所以必然存在「被绑定」的锚点。
    expect(body.data.totals.bound).toBeGreaterThan(0);
    expect(body.data.entries.some((entry) => entry.bound_tasks.length > 0)).toBe(true);
    /**
     * 不参与绑定的结构标题数量也要给出来：只列可绑定锚点时，用户看「未绑定」无法判断
     * 是"该绑没绑"还是"本来就不用绑"——这个数字就是那句"另有 N 个结构标题不参与绑定"。
     */
    expect(body.data.totals.structural).toBeGreaterThan(0);
    expect(Number.isInteger(body.data.totals.structural)).toBe(true);
  });
});

describe('V3：任务追溯', () => {
  it('GET /plans/<goal>/trace 与 plan trace 同源，并给出结构化任务行', async () => {
    const { status, body } = await get<{
      goal: string;
      status: string;
      lines: string[];
      tasks: Array<{
        id: string;
        title: string;
        capability: string;
        spec_ref: string | null;
        spec_anchor: string | null;
        acceptance_ids: string[];
        status: string;
      }>;
    }>('/plans/G1/trace');
    expect(status).toBe(200);

    const plan = await readTaskPlan(projectRoot, 'G1');
    expect(body.data.goal).toBe('G1');
    expect(body.data.status).toBe(plan.status);
    expect(body.data.lines).toEqual(traceTaskPlan(plan));
    expect(body.data.tasks.length).toBe(plan.tasks.length);
    for (const [index, task] of body.data.tasks.entries()) {
      expect(task.id).toBe(plan.tasks[index].id);
      expect(task.acceptance_ids).toEqual(plan.tasks[index].acceptance_ids);
    }
  });

  it('未知 goal → 404', async () => {
    const missing = await get<unknown>('/plans/G-no-such/trace');
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe('unknown-plan');
  });
});

describe('V3：表格导入（粘贴 → 预览 → 导入）', () => {
  const TABLE = [
    '| 能力 | 方法 | 路径 | 说明 |',
    '|---|---|---|---|',
    '| webimport | POST | /web-import | 由 Web 粘贴导入 |',
    '| auth | GET | /auth/ping | 与已有 capability 同名 |',
  ].join('\n');

  it('预览不落盘，且能区分「会新写」与「已存在会跳过」', async () => {
    const { status, body } = await post<{
      preview: {
        rows: number;
        writable: string[];
        existing: string[];
        invalid: string[];
        issues: Array<{ line: number; reason: string }>;
      };
    }>('/spec/import', { content: TABLE, source: 'test-table.md' });
    expect(status).toBe(200);
    expect(body.data.preview.rows).toBe(2);
    expect(body.data.preview.writable).toEqual(['webimport']);
    expect(body.data.preview.existing).toEqual(['auth']);
    expect(body.data.preview.invalid).toEqual([]);

    // 预览是只读的：不能因为点了一次预览就多出文件。
    await expect(fs.access(path.join(projectRoot, 'specs', 'webimport', 'spec.md'))).rejects.toThrow();
  });

  it('确认导入后按预览写盘，同名 capability 不带 force 时被跳过', async () => {
    const { status, body } = await post<{
      result: { capabilities: string[]; written: string[]; skipped: string[]; issues: unknown[] };
    }>('/spec/import', { content: TABLE, source: 'test-table.md', dryRun: false });
    expect(status).toBe(200);
    expect(body.data.result.written).toEqual(['specs/webimport/spec.md']);
    expect(body.data.result.skipped).toEqual(['specs/auth/spec.md']);
    const written = await fs.readFile(path.join(projectRoot, 'specs', 'webimport', 'spec.md'), 'utf8');
    expect(written).toContain('POST /web-import');
  });

  it('内容为空 → 400（不给默认值，避免写出一份空 spec）', async () => {
    const empty = await post<unknown>('/spec/import', { content: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error?.code).toBe('empty-content');
  });
});
