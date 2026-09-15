import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServe } from '../../domains/server/serve.js';
import type { ServeHandle } from '../../domains/server/serve.js';

let server: ServeHandle;
let workspace: string;
let webDir: string;

interface ApiResponse {
  ok: boolean;
  data: any;
  error?: { code: string; message: string };
}

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-serve-ws-'));
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-serve-web-'));
  server = await startServe({ workspaceRoot: workspace, webDir, port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await server.close();
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.rm(webDir, { recursive: true, force: true });
});

function url(pathname: string): string {
  return server.url + pathname;
}

function auth(): Record<string, string> {
  return { Authorization: 'Bearer ' + server.token };
}

async function json(res: Response): Promise<ApiResponse> {
  return (await res.json()) as ApiResponse;
}

async function post(pathname: string, body: unknown): Promise<ApiResponse> {
  const res = await fetch(url(pathname), {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return json(res);
}

describe('serve API', () => {
  it('rejects requests without token', async () => {
    const res = await fetch(url('/api/workspace'));
    expect(res.status).toBe(401);
  });

  it('exchanges an authorized request for a single-use SSE ticket', async () => {
    const issued = await fetch(url('/api/session/ticket'), { method: 'POST', headers: auth() });
    const payload = (await issued.json()) as ApiResponse & { data: { ticket: string } };
    expect(issued.status).toBe(200);
    const ticket = payload.data.ticket;
    expect(ticket.length).toBeGreaterThan(10);

    // 票据能换到事件流；同一张票据不能再换第二次（也不接受普通请求使用票据）。
    const first = await fetch(url('/api/events?ticket=' + ticket), { headers: { Accept: 'text/event-stream' } });
    expect(first.status).toBe(200);
    await first.body?.cancel();
    const second = await fetch(url('/api/events?ticket=' + ticket), { headers: { Accept: 'text/event-stream' } });
    expect(second.status).toBe(401);
    await second.body?.cancel();
  });

  it('creates a project with init + 12-kind scaffold', async () => {
    const projectPath = path.join(workspace, 'demo-project');
    const payload = await post('/api/projects', {
      name: 'demo',
      path: projectPath,
      frontend: '无',
      backend: 'Go',
      database: 'SQLite',
      answers: { network: true, runtimeConfig: true, auth: 'machine', manyErrors: false },
    });
    expect(payload.ok).toBe(true);

    const projectId = payload.data.project.id as string;
    expect(projectId).toBeTruthy();

    await fs.access(path.join(projectPath, 'COMETFLOW.md'));
    await fs.access(path.join(projectPath, '.cometflow', 'init-manifest.yaml'));
    await fs.access(path.join(projectPath, 'specs', 'models.md'));

    const workspaceRes = await fetch(url('/api/workspace'), { headers: auth() });
    const workspacePayload = await json(workspaceRes);
    expect(workspacePayload.data.projects.length).toBe(1);

    const manifestRes = await fetch(url('/api/projects/' + projectId + '/init-manifest'), { headers: auth() });
    const manifestPayload = await json(manifestRes);
    expect(manifestPayload.data.kinds.models.status).toBe('present');
    expect(manifestPayload.data.kinds.pages.status).toBe('absent');
    expect(manifestPayload.data.kinds.protocol.status).toBe('present');

    const specsRes = await fetch(url('/api/projects/' + projectId + '/specs'), { headers: auth() });
    const specsPayload = await json(specsRes);
    expect(specsPayload.data.entries.some((entry: { path: string }) => entry.path === 'specs/models.md')).toBe(true);
  });

  it('reads and writes mission, syncs goals, reads/writes config', async () => {
    const projectPath = path.join(workspace, 'second');
    const created = await post('/api/projects', { name: 'second', path: projectPath });
    const id = created.data.project.id as string;
    const base = '/api/projects/' + id;

    const mission = await json(await fetch(url(base + '/mission.md'), { headers: auth() }));
    expect(mission.data.content).toContain('项目使命');

    await fetch(url(base + '/mission.md'), {
      method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# 项目使命\n\ndemo mission\n' }),
    });
    const updated = await json(await fetch(url(base + '/mission.md'), { headers: auth() }));
    expect(updated.data.content).toContain('demo mission');

    const goals = await json(await fetch(url(base + '/goals'), { headers: auth() }));
    expect(Array.isArray(goals.data.goals)).toBe(true);

    const config = await json(await fetch(url(base + '/config'), { headers: auth() }));
    expect(config.data.config.schema).toBe('cometflow.project.v1');

    const putConfig = await fetch(url(base + '/config'), {
      method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'claude-code', model: 'claude-sonnet-4-5' }),
    });
    expect(putConfig.status).toBe(200);
    const configAfter = await json(await fetch(url(base + '/config'), { headers: auth() }));
    expect(configAfter.data.config.agent).toBe('claude-code');
  });

  it('merges a partial config write instead of replacing the project config', async () => {
    const projectPath = path.join(workspace, 'config-merge');
    const created = await post('/api/projects', { name: 'config-merge', path: projectPath });
    const id = created.data.project.id as string;
    const base = '/api/projects/' + id;

    const first = await fetch(url(base + '/config'), {
      method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'claude-code',
        model: 'claude-sonnet-4-5',
        verification: { mode: 'checks+agent', agent: 'mock' },
        scope: { allow: ['package.json'] },
        scheduler: { mode: 'idle', intervalMs: 60000 },
      }),
    });
    expect(first.status).toBe(200);

    // 界面这次只渲染并提交了 agent 一个字段，其余配置必须原样保留。
    const second = await fetch(url(base + '/config'), {
      method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'opencode' }),
    });
    expect(second.status).toBe(200);
    const secondPayload = await json(second);
    expect(secondPayload.data.writtenKeys).toEqual(['agent']);

    const loaded = await json(await fetch(url(base + '/config'), { headers: auth() }));
    expect(loaded.data.config.agent).toBe('opencode');
    expect(loaded.data.config.verification.mode).toBe('checks+agent');
    expect(loaded.data.config.verification.agent).toBe('mock');
    expect(loaded.data.config.scope.allow).toEqual(['package.json']);
    expect(loaded.data.config.scheduler).toEqual({ mode: 'idle', intervalMs: 60000 });

    // 项目覆盖集合只包含项目文件真正写过的键；全局默认不算覆盖。
    const override = await json(await fetch(url(base + '/config/project'), { headers: auth() }));
    expect(override.data.override.agent).toBe('opencode');
    expect(override.data.override.verification.mode).toBe('checks+agent');

    const invalid = await fetch(url(base + '/config'), {
      method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'nope' }),
    });
    expect(invalid.status).toBe(400);
    const invalidPayload = await json(invalid);
    expect(invalidPayload.error?.code).toBe('invalid-config');
  });

  it('generates and validates a task plan', async () => {
    const projectPath = path.join(workspace, 'third');
    const created = await post('/api/projects', { name: 'third', path: projectPath });
    const id = created.data.project.id as string;
    const base = '/api/projects/' + id;

    const gen = await post(base + '/plans/generate', { goal: 'G1' });
    expect(gen.data.plan.goal).toBe('G1');

    const validate = await post(base + '/plans/G1/validate', {});
    expect(typeof validate.data.valid).toBe('boolean');
  });

  it('serves static web assets with token', async () => {
    await fs.writeFile(path.join(webDir, 'index.html'), '<html>cometflow-ui</html>');
    const res = await fetch(url('/'), { headers: auth() });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('cometflow-ui');
    // 入口必须每次回源，否则重建后浏览器会拿旧入口去请求已删除的 chunk。
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('caches hashed build assets immutably', async () => {
    await fs.mkdir(path.join(webDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)');
    const res = await fetch(url('/assets/index-abc123.js'), { headers: auth() });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('falls back to dist/ when the web dir itself has no index.html', async () => {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-web-src-'));
    await fs.mkdir(path.join(sourceDir, 'dist'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'dist', 'index.html'), '<html>built-ui</html>');
    const handle = await startServe({ workspaceRoot: workspace, webDir: sourceDir, port: 0, host: '127.0.0.1' });
    try {
      const res = await fetch(handle.url + '/', { headers: { Authorization: 'Bearer ' + handle.token } });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('built-ui');
    } finally {
      await handle.close();
      await fs.rm(sourceDir, { recursive: true, force: true });
    }
  });

  it('prefers dist/ over the vite source entry when both exist', async () => {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-web-both-'));
    await fs.mkdir(path.join(sourceDir, 'dist'), { recursive: true });
    // Vite 项目根与构建产物同名 index.html：源码入口是 `<script src="/src/main.ts">`，
    // 直接托管它只会得到空白页，因此 dist/ 必须优先。
    await fs.writeFile(path.join(sourceDir, 'index.html'), '<html><script src="/src/main.ts"></script></html>');
    await fs.writeFile(path.join(sourceDir, 'dist', 'index.html'), '<html>built-ui</html>');
    const handle = await startServe({ workspaceRoot: workspace, webDir: sourceDir, port: 0, host: '127.0.0.1' });
    try {
      const res = await fetch(handle.url + '/', { headers: { Authorization: 'Bearer ' + handle.token } });
      expect(await res.text()).toContain('built-ui');
      // 解析结果应当落在构建产物上，并在启动信息里标成 built。
      expect(handle.ui.dir.endsWith('dist')).toBe(true);
      expect(handle.ui.state).toBe('built');
    } finally {
      await handle.close();
      await fs.rm(sourceDir, { recursive: true, force: true });
    }
  });

  it('reports whether the served directory is a build or a vite source entry', async () => {
    const unbuiltDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-web-unbuilt-'));
    await fs.writeFile(
      path.join(unbuiltDir, 'index.html'),
      '<html><script type="module" src="/src/main.ts"></script></html>',
    );
    const unbuilt = await startServe({ workspaceRoot: workspace, webDir: unbuiltDir, port: 0, host: '127.0.0.1' });
    try {
      // 源码入口会让浏览器拿到加载失败的模块（白页），启动时必须能识别出来并提示。
      expect(unbuilt.ui.state).toBe('unbuilt');
    } finally {
      await unbuilt.close();
      await fs.rm(unbuiltDir, { recursive: true, force: true });
    }

    const missingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-web-missing-'));
    const missing = await startServe({ workspaceRoot: workspace, webDir: missingDir, port: 0, host: '127.0.0.1' });
    try {
      expect(missing.ui.state).toBe('missing');
    } finally {
      await missing.close();
      await fs.rm(missingDir, { recursive: true, force: true });
    }
  });

  it('validates specs and exposes spec index', async () => {
    const projectPath = path.join(workspace, 'fourth');
    const created = await post('/api/projects', { name: 'fourth', path: projectPath });
    const id = created.data.project.id as string;
    const base = '/api/projects/' + id;

    const validate = await post(base + '/spec/validate', {});
    expect(typeof validate.data.valid).toBe('boolean');

    const index = await json(await fetch(url(base + '/spec-index'), { headers: auth() }));
    expect(Array.isArray(index.data.apis)).toBe(true);
  });

  it('creates a new spec file via POST /api/specs', async () => {
    const projectPath = path.join(workspace, 'fifth');
    const created = await post('/api/projects', { name: 'fifth', path: projectPath });
    const id = created.data.project.id as string;
    const base = '/api/projects/' + id;

    const payload = await post(base + '/specs', {
      path: 'specs/engine/spec.md',
      content: '# engine capability\n\n## GET /state\n\n## 验收\n\n- A001：返回状态\n',
    });
    expect(payload.ok).toBe(true);
    await fs.access(path.join(projectPath, 'specs', 'engine', 'spec.md'));

    const specsPayload = await json(await fetch(url(base + '/specs'), { headers: auth() }));
    expect(specsPayload.data.entries.some((e: { path: string }) => e.path === 'specs/engine/spec.md')).toBe(true);

    const outside = await post(base + '/specs', { path: '../evil.md', content: 'x' });
    expect(outside.ok).toBe(false);

    const noMd = await post(base + '/specs', { path: 'specs/notes', content: 'x' });
    expect(noMd.ok).toBe(false);
  });
});
