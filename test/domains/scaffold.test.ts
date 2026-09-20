import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INIT_MANIFEST_SCHEMA,
  capabilitySpecPath,
  detectKindEvidence,
  detectKindNeeds,
  readInitManifest,
  reconcileInitManifest,
  scaffoldCapabilities,
  scaffoldKinds,
  scaffoldProject,
  writeInitManifest,
} from '../../domains/project/scaffold.js';
import { parseSpecMeta } from '../../domains/spec/spec-meta.js';

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

  it('keeps constraints for projects without a backend', () => {
    const frontendOnly = detectKindNeeds({ frontend: 'Vue', backend: '无', database: '无' });
    expect(frontendOnly.pages.status).toBe('present');
    expect(frontendOnly.models.status).toBe('absent');
    expect(frontendOnly.constraints.status).toBe('present');

    const noStackAtAll = detectKindNeeds({});
    expect(noStackAtAll.constraints.status).toBe('deferred');
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

  it('marks scaffolded root kinds as drafts, same as capability stubs', async () => {
    const tmp = await tmpdir('cometflow-scaffold-');
    const answers = { network: true, auth: 'machine' as const };
    const kinds = detectKindNeeds({ database: 'PostgreSQL', backend: 'TypeScript', frontend: '无' }, answers);
    await scaffoldKinds(tmp, kinds, answers);

    // 机器产的占位内容（`<Name>` / `EXAMPLE`）在人工确认前不是契约：root kind 骨架与 capability
    // 骨架必须同一口径，否则「人还没填」的文件会以已定稿身份进入引用校验与问题清单。
    for (const relativePath of ['specs/models.md', 'specs/constraints.md', 'specs/protocol.md', 'specs/permissions.md']) {
      const source = await fs.readFile(path.join(tmp, relativePath), 'utf8');
      expect(parseSpecMeta(source).status, relativePath).toBe('draft');
    }
    const models = await fs.readFile(path.join(tmp, 'specs', 'models.md'), 'utf8');
    expect(models.startsWith('---\nstatus: draft\n---\n\n')).toBe(true);
    // 正文照旧逐字保留：加 front-matter 不能把模板本体搅动一遍。
    expect(models).toContain('## 实体：<Name>');

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

  it('scaffolds capability stubs idempotently and rejects unsafe names', async () => {
    const tmp = await tmpdir('cometflow-scaffold-');
    const first = await scaffoldCapabilities(tmp, ['auth', '../escape']);
    expect(first.created).toEqual(['specs/auth/spec.md']);
    expect(first.invalid).toEqual(['../escape']);

    const stub = await fs.readFile(path.join(tmp, 'specs', 'auth', 'spec.md'), 'utf8');
    expect(stub).toContain('# auth');
    expect(stub).toContain('## Acceptance');

    const second = await scaffoldCapabilities(tmp, ['auth']);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toEqual(['specs/auth/spec.md']);

    expect(capabilitySpecPath('a/b')).toBeNull();
    expect(capabilitySpecPath('.hidden')).toBeNull();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('reads kind presence from the files on disk', async () => {
    const tmp = await tmpdir('cometflow-scaffold-');
    await fs.mkdir(path.join(tmp, 'specs', 'flows'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'COMETFLOW.md'), '# 项目使命\n');
    await fs.writeFile(path.join(tmp, 'specs', 'models.md'), '# 数据模型\n');
    await fs.writeFile(path.join(tmp, 'specs', 'flows', 'login.md'), '# 场景：登录\n');

    const evidence = await detectKindEvidence(tmp);
    expect(evidence.project).toBe(true);
    expect(evidence.models).toBe(true);
    expect(evidence.flow).toBe(true);
    // 没有文件就是没有：这里不下「本项目不需要」的结论，那是 init 的问答与人工裁量。
    expect(evidence.capability).toBe(false);
    expect(evidence.errors).toBe(false);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('reconciles capability from disk facts and leaves the other kinds alone', async () => {
    const tmp = await tmpdir('cometflow-scaffold-');
    await fs.mkdir(path.join(tmp, 'specs', 'auth'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'specs', 'auth', 'spec.md'), '# auth\n');
    await fs.writeFile(path.join(tmp, 'COMETFLOW.md'), '# 项目使命\n');
    const kinds = detectKindNeeds({ frontend: '无', backend: 'TypeScript', database: 'PostgreSQL' });
    // 技术栈推不出 capability，它恒为 absent——这正是 12-kind 页会撒谎的根源。
    expect(kinds.capability.status).toBe('absent');
    await writeInitManifest(tmp, kinds);

    const first = await reconcileInitManifest(tmp);
    expect(first.changed).toEqual(['capability']);
    const manifest = await readInitManifest(tmp);
    expect(manifest?.kinds.capability.status).toBe('present');
    expect(manifest?.kinds.capability.reason).toContain('磁盘');
    // 其它 kind 原样：absent 是「本项目不需要」的显式决定，present 也照旧交给 spec validate 去报缺文件。
    expect(manifest?.kinds.pages).toEqual({ status: 'absent', reason: 'frontend == none' });
    expect(manifest?.kinds.models.status).toBe('present');

    const manifestPath = path.join(tmp, '.cometflow', 'init-manifest.yaml');
    const before = await fs.readFile(manifestPath, 'utf8');
    const second = await reconcileInitManifest(tmp);
    expect(second.changed).toEqual([]);
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(before);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('does not invent an init-manifest when there is none', async () => {
    const tmp = await tmpdir('cometflow-scaffold-');
    await fs.mkdir(path.join(tmp, 'specs', 'auth'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'specs', 'auth', 'spec.md'), '# auth\n');

    const result = await reconcileInitManifest(tmp);
    expect(result.kinds).toBeNull();
    expect(result.changed).toEqual([]);
    await expect(fs.access(path.join(tmp, '.cometflow', 'init-manifest.yaml'))).rejects.toThrow();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('scaffoldProject merges disk facts into an existing manifest instead of overwriting it', async () => {
    const tmp = await tmpdir('cometflow-scaffold-');
    await fs.mkdir(path.join(tmp, 'specs', 'auth'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'specs', 'auth', 'spec.md'), '# auth\n');
    await fs.writeFile(path.join(tmp, 'specs', 'rules.md'), '# 领域规则\n');

    const stack = { frontend: '无', backend: 'TypeScript', database: '无' };
    const previous = detectKindNeeds(stack);
    // 人把 rules 明确标成 present 并写了原因；技术栈与问答已经答不出这一条了。
    previous.rules = { status: 'present', reason: '人工确认过需要领域规则' };
    await writeInitManifest(tmp, previous);

    const result = await scaffoldProject(tmp, stack);
    // 磁盘上有 rules.md：旧判定（含 reason）优先，不被「没答 domainDsl」冲成 deferred。
    expect(result.kinds.rules).toEqual({ status: 'present', reason: '人工确认过需要领域规则' });
    expect(result.kinds.capability.status).toBe('present');
    expect(result.kinds.pages.status).toBe('absent');
    expect((await readInitManifest(tmp))?.kinds.rules.reason).toBe('人工确认过需要领域规则');
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
