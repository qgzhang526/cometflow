import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INIT_MANIFEST_SCHEMA,
  detectKindNeeds,
  readInitManifest,
  scaffoldKinds,
  scaffoldProject,
  writeInitManifest,
} from '../../domains/project/scaffold.js';

async function tmpdir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('spec scaffold', () => {
  it('infers first-layer kinds from stack hints', () => {
    const kinds = detectKindNeeds({ frontend: '无', backend: 'TypeScript', database: 'PostgreSQL' });
    expect(kinds.pages.status).toBe('absent');
    expect(kinds.models.status).toBe('present');
    expect(kinds.constraints.status).toBe('present');
    expect(kinds.project.status).toBe('present');
    expect(kinds.capability.status).toBe('absent');
  });

  it('defers first-layer kinds when stack is unknown', () => {
    const kinds = detectKindNeeds({});
    expect(kinds.models.status).toBe('deferred');
    expect(kinds.pages.status).toBe('deferred');
    expect(kinds.constraints.status).toBe('deferred');
  });

  it('defers placeholder stack values', () => {
    const kinds = detectKindNeeds({ frontend: '[无/框架]', backend: '[语言/框架]', database: '[数据库或“无”]' });
    expect(kinds.pages.status).toBe('deferred');
    expect(kinds.models.status).toBe('deferred');
    expect(kinds.constraints.status).toBe('deferred');
  });

  it('applies interactive answers for second-layer kinds', () => {
    const kinds = detectKindNeeds(
      {},
      {
        network: true,
        runtimeConfig: false,
        crossApiFlow: true,
        backgroundProcess: false,
        domainDsl: true,
        auth: 'machine',
        manyErrors: true,
      },
    );
    expect(kinds.protocol.status).toBe('present');
    expect(kinds.config.status).toBe('absent');
    expect(kinds.flow.status).toBe('present');
    expect(kinds.process.status).toBe('absent');
    expect(kinds.rules.status).toBe('present');
    expect(kinds.permissions.status).toBe('present');
    expect(kinds.errors.status).toBe('present');
  });

  it('defers second-layer kinds without answers', () => {
    const kinds = detectKindNeeds({});
    expect(kinds.protocol.status).toBe('deferred');
    expect(kinds.config.status).toBe('deferred');
    expect(kinds.errors.status).toBe('deferred');
  });

  it('scaffolds only present kinds and is idempotent', async () => {
    const tmp = await tmpdir('cometflow-scaffold-');
    const kinds = detectKindNeeds(
      { database: 'PostgreSQL', backend: 'TypeScript', frontend: '无' },
      { network: true, auth: 'machine' },
    );
    const first = await scaffoldKinds(tmp, kinds, { auth: 'machine' });
    expect(first.created).toContain('specs/models.md');
    expect(first.created).toContain('specs/constraints.md');
    expect(first.created).toContain('specs/protocol.md');
    expect(first.created).toContain('specs/permissions.md');
    expect(first.created).not.toContain('specs/pages.md');
    expect(first.skipped).toHaveLength(0);

    const second = await scaffoldKinds(tmp, kinds, { auth: 'machine' });
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toEqual(expect.arrayContaining(['specs/models.md']));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('creates specs/flows/ for a present flow kind', async () => {
    const tmp = await tmpdir('cometflow-scaffold-');
    const kinds = detectKindNeeds({}, { crossApiFlow: true });
    const { created } = await scaffoldKinds(tmp, kinds);
    expect(created).toContain('specs/flows/');
    await expect(fs.access(path.join(tmp, 'specs', 'flows'))).resolves.toBeUndefined();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('writes role matrix vs machine auth permission templates', async () => {
    const rolesTmp = await tmpdir('cometflow-scaffold-');
    await scaffoldKinds(rolesTmp, detectKindNeeds({}, { auth: 'roles' }), { auth: 'roles' });
    const roles = await fs.readFile(path.join(rolesTmp, 'specs', 'permissions.md'), 'utf8');
    expect(roles).toContain('角色 × API');

    const machineTmp = await tmpdir('cometflow-scaffold-');
    await scaffoldKinds(machineTmp, detectKindNeeds({}, { auth: 'machine' }), { auth: 'machine' });
    const machine = await fs.readFile(path.join(machineTmp, 'specs', 'permissions.md'), 'utf8');
    expect(machine).toContain('机机通信认证');

    await fs.rm(rolesTmp, { recursive: true, force: true });
    await fs.rm(machineTmp, { recursive: true, force: true });
  });

  it('write/read init-manifest round-trips', async () => {
    const tmp = await tmpdir('cometflow-scaffold-');
    const kinds = detectKindNeeds({}, {});
    const manifestPath = await writeInitManifest(tmp, kinds);
    const manifest = await readInitManifest(tmp);
    expect(manifest?.schema).toBe(INIT_MANIFEST_SCHEMA);
    expect(manifest?.kinds.project.status).toBe('present');
    expect(manifestPath.endsWith('init-manifest.yaml')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('scaffoldProject writes manifest and creates inferred files', async () => {
    const tmp = await tmpdir('cometflow-scaffold-');
    const result = await scaffoldProject(tmp, { database: 'PostgreSQL', backend: 'TypeScript', frontend: '无' });
    expect(result.created).toContain('specs/models.md');
    expect(result.created).toContain('specs/constraints.md');
    expect(result.manifestPath).toContain('init-manifest.yaml');
    const manifest = await readInitManifest(tmp);
    expect(manifest?.kinds.models.status).toBe('present');
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
