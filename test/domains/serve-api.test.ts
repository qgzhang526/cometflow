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
    expect(config.data.schema).toBe('cometflow.project.v1');

    const putConfig = await fetch(url(base + '/config'), {
      method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'claude-code', model: 'claude-sonnet-4-5' }),
    });
    expect(putConfig.status).toBe(200);
    const configAfter = await json(await fetch(url(base + '/config'), { headers: auth() }));
    expect(configAfter.data.agent).toBe('claude-code');
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
