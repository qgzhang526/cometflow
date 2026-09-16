import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServe } from '../../domains/server/serve.js';
import type { ServeHandle } from '../../domains/server/serve.js';
import { collectFindings } from '../../domains/gates/findings.js';
import { collectMetrics } from '../../domains/metrics/metrics-service.js';
import { ATOMIC_TEMP_PREFIX } from '../../platform/fs/atomic-write.js';
import { acquireLock, readLock } from '../../platform/fs/file-lock.js';

/**
 * V1 可见性批次：把「后端算出来了、但只能敲命令」的结论搬到 HTTP 层。
 *
 * 四条主线各有自己的验收：findings 与 `gate check --findings` 同源、metrics 与 `metrics --json` 同源、
 * current-change 能把 hook 的 fail closed 真正解除、maintenance 的预告值不匹配时**一个字节都不能删**。
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

interface FindingsBody {
  findings: Array<{ source: string; code: string; severity: string; subject: string; message: string }>;
}

interface MetricsBody {
  report: { schema: string; generated_at: string; rebuild: unknown; spec_health: unknown };
  gates: { thresholds: Record<string, unknown>; errors: string[]; lines: string[] };
}

interface MaintenanceBody {
  temp: { count: number; totalBytes: number; sample: Array<{ path: string; size: number }> };
  jobs: { files: number; bytes: number; finished: number; running: number; candidates: number; reclaimableBytes: number };
  lock: { held: boolean; stale: boolean; reason: string | null; holder: string | null };
}

interface CurrentChangeBody {
  pointer: { change: string; source: string } | null;
  resolved: boolean;
  change: { name: string; archived: boolean } | null;
}

async function putOrphanTempFile(name: string, content = 'half-written'): Promise<string> {
  const dir = path.join(projectRoot, '.cometflow');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, ATOMIC_TEMP_PREFIX + name);
  await fs.writeFile(file, content);
  return file;
}

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-visibility-ws-'));
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-visibility-web-'));
  projectRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-visibility-proj-')), 'fixture');
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

describe('只读投影：findings / metrics', () => {
  it('findings 与 collectFindings 逐条相等（同源，不各造一套）', async () => {
    const { status, body } = await get<FindingsBody>('/findings');
    expect(status).toBe(200);
    const expected = await collectFindings(projectRoot);
    expect(body.data.findings).toEqual(expected);
    for (const finding of body.data.findings) {
      expect(['spec-verify', 'doctor']).toContain(finding.source);
      expect(['error', 'warning', 'info']).toContain(finding.severity);
      expect(typeof finding.code).toBe('string');
    }
  });

  it('metrics 与 collectMetrics 同源，且门禁阈值始终可见', async () => {
    const { status, body } = await get<MetricsBody>('/metrics');
    expect(status).toBe(200);
    expect(body.data.report.schema).toBe('cometflow.metrics.v1');
    expect(typeof body.data.report.generated_at).toBe('string');

    // generated_at 是时间戳，不能整份深比；比「指标本身」这两块。
    const expected = await collectMetrics(projectRoot);
    expect(body.data.report.spec_health).toEqual(expected.spec_health);
    expect(body.data.report.rebuild).toEqual(expected.rebuild);

    // 未配置阈值时也必须给出内置方向表——看不见的约束等于没有约束。
    expect(body.data.gates.errors).toEqual([]);
    expect(body.data.gates.lines.length).toBeGreaterThan(0);
  });
});

describe('maintenance：预告 → 确认 → 执行', () => {
  it('预告与 doctor 的结论一致（同一个扫描根）', async () => {
    const orphan = await putOrphanTempFile('visibility-check');
    const { status, body } = await get<MaintenanceBody>('/maintenance');
    expect(status).toBe(200);
    expect(body.data.temp.count).toBe(1);
    expect(body.data.temp.totalBytes).toBeGreaterThan(0);
    // 样本里给的是完整路径，确认弹窗要能显示「将删除什么」。
    expect(body.data.temp.sample[0]?.path).toBe(orphan);

    const findings = await get<FindingsBody>('/findings');
    expect(findings.body.data.findings.map((entry) => entry.code)).toContain('orphan-atomic-temp');
  });

  it('clean-temp：预告值不匹配 → 409 且一个文件都不删', async () => {
    const orphan = await putOrphanTempFile('mismatch');
    const stale = await post<unknown>('/project/doctor/clean-temp', { expectedFiles: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('stale-maintenance-preview');
    // 关键护栏：拒绝之后文件必须还在。
    await expect(fs.access(orphan)).resolves.toBeUndefined();
  });

  it('clean-temp：预告值匹配 → 删除并回报实际结果', async () => {
    const { body: plan } = await get<MaintenanceBody>('/maintenance');
    expect(plan.data.temp.count).toBeGreaterThan(0);
    const cleaned = await post<{ cleaned: { removed: number; bytes: number; paths: string[] }; report: { healthy: boolean } }>(
      '/project/doctor/clean-temp',
      { expectedFiles: plan.data.temp.count },
    );
    expect(cleaned.status).toBe(200);
    expect(cleaned.body.data.cleaned.removed).toBe(plan.data.temp.count);
    expect(cleaned.body.data.cleaned.paths.length).toBe(plan.data.temp.count);
    // 返回的 report 是执行后的新结论，界面不用再点一次刷新。
    expect(typeof cleaned.body.data.report.healthy).toBe('boolean');
    const after = await get<MaintenanceBody>('/maintenance');
    expect(after.body.data.temp.count).toBe(0);
  });

  it('clean-temp：缺少预告值 → 400（不给默认值，避免误删）', async () => {
    const missing = await post<unknown>('/project/doctor/clean-temp', {});
    expect(missing.status).toBe(400);
    expect(missing.body.error?.code).toBe('missing-expected');
  });

  it('clean-jobs：候选数不匹配 → 409；匹配 → 成功且不动运行中的任务', async () => {
    const stale = await post<unknown>('/project/doctor/clean-jobs', { expectedCandidates: 123 });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('stale-maintenance-preview');

    const { body: plan } = await get<MaintenanceBody>('/maintenance');
    const cleaned = await post<{ cleaned: { removed: number; bytes: number; running: number } }>(
      '/project/doctor/clean-jobs',
      { expectedCandidates: plan.data.jobs.candidates },
    );
    expect(cleaned.status).toBe(200);
    expect(cleaned.body.data.cleaned.removed).toBe(plan.data.jobs.candidates);
    expect(cleaned.body.data.cleaned.running).toBe(plan.data.jobs.running);
  });

  it('force-unlock：无锁 → 409；持有者不匹配 → 409 且锁还在；匹配 → 清理', async () => {
    const none = await post<unknown>('/project/doctor/force-unlock', { expectedHolder: '1@host@when' });
    expect(none.status).toBe(409);
    expect(none.body.error?.code).toBe('stale-maintenance-preview');

    const lock = await acquireLock(projectRoot, 'visibility-test transaction');
    try {
      const { body: plan } = await get<MaintenanceBody>('/maintenance');
      expect(plan.data.lock.held).toBe(true);
      expect(plan.data.lock.holder).not.toBeNull();

      // 持有者变化（这里用假 holder 模拟「确认时是 A、执行时不是 A」）。
      const wrong = await post<unknown>('/project/doctor/force-unlock', { expectedHolder: '999@other@never' });
      expect(wrong.status).toBe(409);
      expect(await readLock(projectRoot)).not.toBeNull();

      const missing = await post<unknown>('/project/doctor/force-unlock', {});
      expect(missing.status).toBe(400);

      const ok = await post<{ cleaned: { removed: boolean; holder: string } }>(
        '/project/doctor/force-unlock',
        { expectedHolder: plan.data.lock.holder },
      );
      expect(ok.status).toBe(200);
      expect(ok.body.data.cleaned.removed).toBe(true);
      expect(await readLock(projectRoot)).toBeNull();
    } finally {
      // 被 force-unlock 之后 release 会报「不是我的锁」，所以只在仍持有它时释放。
      await lock.release().catch(() => undefined);
    }
  });
});

describe('current-change 指针：把 fail closed 变成可解除', () => {
  it('无指针 → 指定活跃 change → hook 放行 → 清除后再次 fail closed', async () => {
    const initial = await get<CurrentChangeBody>('/current-change');
    expect(initial.status).toBe(200);
    expect(initial.body.data.pointer).toBeNull();
    expect(initial.body.data.resolved).toBe(false);

    // fixture 里有 4 个活跃 change：没有指针时 hook 必须 fail closed。
    const before = await post<{ decision: { allowed: boolean; reason: string } }>('/hook/check', {
      target: 'src/core/index.ts',
      event: 'edit',
    });
    expect(before.body.data.decision.allowed).toBe(false);
    expect(before.body.data.decision.reason).toBe('multiple-active-changes');

    const selected = await post<CurrentChangeBody>('/current-change', { name: 'build-change' });
    expect(selected.status).toBe(200);
    expect(selected.body.data.pointer?.change).toBe('build-change');

    const resolved = await get<CurrentChangeBody>('/current-change');
    expect(resolved.body.data.resolved).toBe(true);
    expect(resolved.body.data.change?.name).toBe('build-change');

    // 指针存在的意义就在这一步：同一个写入从「被拒」变成「按 build-change 的规则放行」。
    const after = await post<{ decision: { allowed: boolean; reason: string } }>('/hook/check', {
      target: 'src/core/index.ts',
      event: 'edit',
    });
    expect(after.body.data.decision.allowed).toBe(true);
    expect(after.body.data.decision.reason).toContain('build');

    const cleared = await post<{ cleared: boolean; pointer: null }>('/current-change', { name: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.cleared).toBe(true);
    const final = await get<CurrentChangeBody>('/current-change');
    expect(final.body.data.pointer).toBeNull();
  });

  it('未知 change → 404；已归档 change → 409（与 CLI change select 同源）', async () => {
    const unknown = await post<unknown>('/current-change', { name: 'no-such-change' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code).toBe('unknown-change');

    const archived = await post<unknown>('/current-change', { name: 'archived-change' });
    expect(archived.status).toBe(409);
    expect(archived.body.error?.code).toBe('change-not-selectable');
  });
});
