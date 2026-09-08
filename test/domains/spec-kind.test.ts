import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { kindForSpecFile, ROOT_KIND_FILES } from '../../domains/spec/kind.js';
import {
  extractApiReferencesFromLine,
  extractEntities,
  extractFlowSteps,
  extractProcesses,
  normalizeApiHeading,
} from '../../domains/spec/spec-structure.js';
import { validateSpecs } from '../../domains/spec/spec-validate.js';

const COMETFLOW = [
  '# 项目使命',
  '',
  'demo',
  '',
  '## 技术栈',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 前端 | 无 |',
  '| 后端 | TypeScript |',
  '| 数据库 | 无 |',
  '| 缓存 | 无 |',
  '| 测试框架 | vitest |',
  '| 构建工具 | tsc |',
  '',
  '## 运行环境',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 操作系统 | Linux |',
  '| 部署方式 | 本地 |',
  '| 语言版本 | Node 22+ |',
].join('\n');

async function writeProject(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }
}

describe('spec kind model', () => {
  it('resolves kinds from canonical paths', () => {
    expect(kindForSpecFile('COMETFLOW.md')).toBe('project');
    expect(kindForSpecFile('specs/models.md')).toBe('models');
    expect(kindForSpecFile('specs/protocol.md')).toBe('protocol');
    expect(kindForSpecFile('specs/processes.md')).toBe('process');
    expect(kindForSpecFile('specs/flows/login.md')).toBe('flow');
    expect(kindForSpecFile('specs/auth/spec.md')).toBe('capability');
    expect(ROOT_KIND_FILES.models).toBe('specs/models.md');
  });

  it('extracts entities and processes', () => {
    const entities = extractEntities('# 数据模型\n\n## 实体：User\n\n## 实体：Order\n');
    expect(entities.map((entry) => entry.name)).toEqual(['User', 'Order']);
    const processes = extractProcesses('## 进程：心跳循环\n');
    expect(processes.map((entry) => entry.name)).toEqual(['心跳循环']);
  });

  it('extracts flow steps and api references', () => {
    const refs = extractApiReferencesFromLine('调用 `POST /V2/auth/login`（参考 specs/auth/spec.md）');
    expect(refs).toEqual([{ method: 'POST', path: '/V2/auth/login', refFile: 'specs/auth/spec.md' }]);
    const flow = [
      '# 场景：登录',
      '## 前置条件',
      '- 无',
      '## 步骤',
      '### 步骤1：调用登录',
      '调用 `POST /login`（参考 specs/auth/spec.md）',
      '## 后置条件',
      '- 成功',
    ].join('\n');
    const steps = extractFlowSteps(flow);
    expect(steps).toHaveLength(1);
    expect(steps[0].apiRefs[0].path).toBe('/login');
    expect(normalizeApiHeading('post /login')).toBe('POST /login');
  });

  it('accepts a models spec without acceptance items', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-kind-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/models.md': '# 数据模型\n\n## 实体：User\n\n| 字段 | 类型 |\n|------|------|\n| id | string |\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.filter((finding) => finding.severity === 'error')).toHaveLength(0);
    expect(result.valid).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('rejects a capability spec without acceptance items', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-kind-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/auth/spec.md': '# auth\n\n## POST /login\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'no-acceptance')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('flags unresolved flow api references as warnings', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-kind-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n## Acceptance\n\n- A1：ok\n',
      'specs/flows/login.md': [
        '# 场景：登录',
        '## 前置条件',
        '- 无',
        '## 步骤',
        '### 步骤1：调用登录',
        '调用 `POST /missing`（参考 specs/auth/spec.md）',
        '## 后置条件',
        '- 成功',
      ].join('\n'),
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'unresolved-api-reference')).toBe(true);

    await fs.writeFile(path.join(tmp, 'specs', 'flows', 'login.md'), [
      '# 场景：登录',
      '## 前置条件',
      '- 无',
      '## 步骤',
      '### 步骤1：调用登录',
      '调用 `POST /login`（参考 specs/auth/spec.md）',
      '## 后置条件',
      '- 成功',
    ].join('\n'));
    const resolved = await validateSpecs(tmp);
    expect(resolved.findings.some((finding) => finding.code === 'unresolved-api-reference')).toBe(false);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('flags present-but-missing kind files from init-manifest', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-kind-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      '.cometflow/init-manifest.yaml': [
        'schema: cometflow.init-manifest.v1',
        'kinds:',
        '  project: { status: present, reason: always }',
        '  models: { status: present, reason: database }',
        '  pages: { status: absent, reason: no-frontend }',
        '  constraints: { status: present, reason: backend }',
        '  capability: { status: absent, reason: from-goals }',
        '  protocol: { status: deferred, reason: interactive }',
        '  errors: { status: deferred, reason: interactive }',
        '  config: { status: deferred, reason: interactive }',
        '  flow: { status: deferred, reason: interactive }',
        '  process: { status: deferred, reason: interactive }',
        '  rules: { status: deferred, reason: interactive }',
        '  permissions: { status: deferred, reason: interactive }',
      ].join('\n'),
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'missing-kind-file')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
