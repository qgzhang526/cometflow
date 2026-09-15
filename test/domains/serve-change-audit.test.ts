import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServe } from '../../domains/server/serve.js';
import type { ServeHandle } from '../../domains/server/serve.js';
import { hashSpecText } from '../../domains/spec/spec-hash.js';
import { acquireLock } from '../../platform/fs/file-lock.js';

/**
 * W3：change 的「为什么」在 Web 端可回答——
 * 实现范围有归属解释、流水含全部事件、证据可读，冲突时给出两条恢复路径。
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
  error?: { code: string; message: string; details?: unknown };
}

function auth(): Record<string, string> {
  return { Authorization: 'Bearer ' + server.token };
}

async function get<T>(suffix: string): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const res = await fetch(server.url + base + suffix, { headers: auth() });
  return { status: res.status, body: (await res.json()) as ApiEnvelope<T> };
}

async function post<T>(suffix: string, payload: unknown = {}): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const res = await fetch(server.url + base + suffix, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as ApiEnvelope<T> };
}

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-change-audit-ws-'));
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-change-audit-web-'));
  projectRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-change-audit-proj-')), 'fixture');
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

describe('change audit API', () => {
  it('explains implementation scope, including "cannot decide" for changes without a baseline', async () => {
    const { status, body } = await get<{
      change: string;
      module: string | null;
      baseline_captured_at: string | null;
      changes: unknown[];
      unattributed: string[];
      omitted: unknown[];
      complete: boolean;
    }>('/changes/build-change/scope');

    expect(status).toBe(200);
    expect(body.data.change).toBe('build-change');
    // fixture 里的 change 早于实现范围基线机制：必须明确报告「无法判定」，而不是把全仓文件算成越界。
    expect(body.data.baseline_captured_at).toBeNull();
    expect(body.data.changes).toHaveLength(0);
    expect(body.data.unattributed).toHaveLength(0);
  });

  it('records a full audit trail and supports limiting it', async () => {
    const created = await post<{ change: { name: string; phase: string } }>('/changes', {
      name: 'audit-journal',
      goal: 'G1',
      task: 'T1',
    });
    expect(created.status).toBe(200);

    await post('/changes/audit-journal/transition', { event: 'confirm-acceptance' });

    const { status, body } = await get<{ events: Array<{ event: string; phase?: string; at: string }> }>(
      '/changes/audit-journal/journal',
    );
    expect(status).toBe(200);
    const kinds = body.data.events.map((event) => event.event);
    expect(kinds).toContain('change-created');
    expect(kinds).toContain('spec-baseline-captured');
    expect(kinds).toContain('transition');
    // 时间顺序必须是「旧 → 新」，界面靠它渲染时间线。
    const timestamps = body.data.events.map((event) => new Date(event.at).getTime());
    expect([...timestamps].sort((left, right) => left - right)).toEqual(timestamps);

    const limited = await get<{ events: unknown[] }>('/changes/audit-journal/journal?limit=1');
    expect(limited.body.data.events).toHaveLength(1);
  });

  it('reads change evidence artifacts', async () => {
    const { status, body } = await get<{
      artifacts: Array<{ name: string; bytes: number; content: string }>;
      proposedSpecs: string[];
      incompleteTransactions: unknown[];
    }>('/changes/verify-change/evidence');

    expect(status).toBe(200);
    // fixture 的 verify-change 只有遗留的 verification.yaml。
    expect(body.data.artifacts.map((artifact) => artifact.name)).toContain('verification.yaml');
    expect(body.data.artifacts.every((artifact) => artifact.bytes > 0)).toBe(true);
    expect(body.data.proposedSpecs).toHaveLength(0);
    expect(body.data.incompleteTransactions).toHaveLength(0);
  });

  it('rebases a change onto the current spec version', async () => {
    const { status, body } = await post<{
      state: { phase: string; spec_version: number; acceptance_ids: string[] };
      specVersion: number;
      acceptanceIds: string[];
    }>('/changes/shape-change/rebase');

    expect(status).toBe(200);
    expect(body.data.acceptanceIds).toEqual(['A1']);
    expect(body.data.state.spec_version).toBeGreaterThanOrEqual(1);
    // shape 阶段的 change 不该因为 rebase 被推进阶段。
    expect(body.data.state.phase).toBe('shape');

    const detail = await get<{ spec_version: number; acceptance_ids: string[] }>('/changes/shape-change');
    expect(detail.body.data.spec_version).toBe(body.data.state.spec_version);
  });

  it('refuses to rebase an archived change with an actionable code', async () => {
    const { status, body } = await post('/changes/archived-change/rebase');
    expect(status).toBe(409);
    expect(body.error?.code).toBe('change-not-rebasable');
  });

  it('unblocks a stalled change and rejects unblocking an active one', async () => {
    // 先按 H3-1 的停机形态改写状态：blocked + 累计失败轮次。
    const statePath = path.join(projectRoot, 'changes', 'build-change', 'comet-state.yaml');
    const original = await fs.readFile(statePath, 'utf8');
    await fs.writeFile(statePath, original.replace('status: active', 'status: blocked') + 'repair_attempts: 3\n');

    const notBlocked = await post('/changes/shape-change/unblock');
    expect(notBlocked.status).toBe(409);
    expect(notBlocked.body.error?.code).toBe('change-not-blocked');

    const unblocked = await post<{ state: { status: string }; previousAttempts: number }>('/changes/build-change/unblock', {
      note: '方向已澄清',
    });
    expect(unblocked.status).toBe(200);
    expect(unblocked.body.data.state.status).toBe('active');
    expect(unblocked.body.data.previousAttempts).toBe(3);

    await fs.writeFile(statePath, original);
  });

  it('reports a spec baseline conflict as 409 with both recovery paths visible', async () => {
    const specPath = path.join(projectRoot, 'specs', 'report', 'spec.md');
    const specContent = await fs.readFile(specPath, 'utf8');
    const baseHash = hashSpecText(specContent);

    // archive-change 已处于 archive 阶段；给它补一个「创建时的 spec 基线」，再改动 canonical spec。
    const statePath = path.join(projectRoot, 'changes', 'archive-change', 'comet-state.yaml');
    const state = await fs.readFile(statePath, 'utf8');
    await fs.writeFile(statePath, state.trimEnd() + '\nspec_base_hash: ' + baseHash + '\n');
    await fs.writeFile(specPath, specContent + '\n<!-- 归档前被别的会话改过 -->\n');

    const { status, body } = await post<unknown>('/changes/archive-change/archive');
    expect(status).toBe(409);
    expect(body.error?.code).toBe('spec-base-conflict');
    const details = body.error?.details as { conflicts?: Array<{ path: string; kind: string }> } | undefined;
    expect(details?.conflicts?.[0].path).toBe('specs/report/spec.md');
    expect(details?.conflicts?.[0].kind).toBe('modified');

    // 恢复现场，避免影响后续断言与重复运行。
    await fs.writeFile(specPath, specContent);
    await fs.writeFile(statePath, state);
  });

  it('rejects change names that could escape the project directory', async () => {
    const res = await fetch(server.url + base + '/changes/..%2F..%2Fetc/journal', { headers: auth() });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiEnvelope<unknown>;
    expect(body.error?.code).toBe('invalid-change-name');
  });

  it('refuses an archive while another process holds the transaction lock', async () => {
    // 另一个进程正在归档：这里立刻 409 并说明持有者，而不是排队等待（ADR 0021）。
    const lock = await acquireLock(projectRoot, 'change archive other');
    try {
      const blocked = await post('/changes/archive-change/archive');
      expect(blocked.status).toBe(409);
      expect(blocked.body.error?.code).toBe('lock-held');
      const details = blocked.body.error?.details as { lock?: { action: string } } | undefined;
      expect(details?.lock?.action).toBe('change archive other');
    } finally {
      await lock.release();
    }
  });
});
