import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSpecEntries } from '../../domains/spec/spec-index.js';
import { buildSpecIndex, writeSpecIndex } from '../../domains/spec/spec-project.js';

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
  '| 数据库 | SQLite |',
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

describe('spec index projection', () => {
  it('lists spec entries with kinds', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-proj-'));
    await writeProject(tmp, {
      'specs/models.md': '# 数据模型\n\n## 实体：User\n',
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n## Acceptance\n\n- A1：ok\n',
      'specs/flows/login.md': '# 场景：登录\n\n## 前置条件\n- 无\n\n## 步骤\n\n### 步骤1\n调用 POST /login\n\n## 后置条件\n- 成功\n',
    });
    const entries = await listSpecEntries(tmp);
    const kinds = Object.fromEntries(entries.map((entry) => [entry.path, entry.kind]));
    expect(kinds['specs/models.md']).toBe('models');
    expect(kinds['specs/auth/spec.md']).toBe('capability');
    expect(kinds['specs/flows/login.md']).toBe('flow');
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('builds and writes the spec index projection', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-proj-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/models.md': '# 数据模型\n\n## 实体：User\n\n| 字段 | 类型 |\n|------|------|\n| id | string |\n',
      'specs/auth/spec.md': '# auth\n\n## POST /api/auth/login\n\n## Acceptance\n\n- A1：ok\n',
      'specs/flows/login.md': '# 场景：登录\n\n## 前置条件\n- 无\n\n## 步骤\n\n### 步骤1：调用登录\n调用 POST /api/auth/login\n\n## 后置条件\n- 成功\n',
      'specs/errors.md': '# 错误码目录\n\n## 错误码\n\n| code | 语义 |\n|------|------|\n| INVALID_CODE | 无效 |\n',
      'specs/config.md': '# 运行时配置\n\n## 配置项\n\n| 键 | 类型 |\n|----|------|\n| platform.url | string |\n',
    });
    const projection = await buildSpecIndex(tmp);
    expect(projection.models?.entities).toHaveLength(1);
    expect(projection.apis).toHaveLength(1);
    expect(projection.apis[0]).toMatchObject({ method: 'POST', path: '/api/auth/login', acceptanceIds: ['A1'] });
    expect(projection.flows).toHaveLength(1);
    expect(projection.errors).toEqual(['INVALID_CODE']);
    expect(projection.config).toEqual(['platform.url']);

    const { files } = await writeSpecIndex(tmp);
    expect(files).toHaveLength(5);
    await expect(fs.access(path.join(tmp, '.cometflow', 'spec-index', 'apis.yaml'))).resolves.toBeUndefined();
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
