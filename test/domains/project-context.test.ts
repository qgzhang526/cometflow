import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProjectContext, syncProjectContext, validateProjectContext } from '../../domains/project/context.js';
import { validateSpecs } from '../../domains/spec/spec-validate.js';
import { validateTaskPlan } from '../../domains/task-plan/task-plan-validate.js';
import type { TaskPlan } from '../../domains/task-plan/types.js';

const markdown = [
  '# 项目使命',
  '',
  'demo',
  '',
  '## 技术栈',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 前端 | 无 |',
  '| 后端 | Golang |',
  '| 数据库 | SQLite |',
  '| 缓存 | 无 |',
  '| 测试框架 | Go 内置 testing + testify |',
  '| 构建工具 | go build |',
  '',
  '## 运行环境',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 操作系统 | Linux |',
  '| 部署方式 | 内网服务器 |',
  '| 语言版本 | Go 1.22+ |',
].join('\n');

describe('project context', () => {
  it('parses and validates tech stack and runtime', () => {
    const context = parseProjectContext(markdown);
    expect(context.tech_stack.backend).toBe('Golang');
    expect(context.runtime.language_version).toBe('Go 1.22+');
    expect(validateProjectContext(context)).toHaveLength(0);
  });

  it('syncs project-context.yaml', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-context-'));
    await fs.writeFile(path.join(tmp, 'COMETFLOW.md'), markdown);
    const result = await syncProjectContext(tmp);
    expect(result.errors).toHaveLength(0);
    await fs.access(path.join(tmp, '.cometflow', 'project-context.yaml'));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('rejects incomplete context', () => {
    const context = parseProjectContext('# 项目使命\n\n## 技术栈\n\n| 维度 | 值 |\n| 后端 | 待定 |\n');
    expect(validateProjectContext(context).length).toBeGreaterThan(0);
  });
});

describe('context-aware validation', () => {
  it('spec validate accepts fixture context', async () => {
    // 用相对本文件的解析：绝对路径只在开发机上存在，CI 上会直接读不到 fixture。
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'fixtures',
      'spec-kernel-project',
    );
    const result = await validateSpecs(fixture);
    expect(result.valid).toBe(true);
  });

  it('plan validate rejects go commands in a node project', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-stack-mismatch-'));
    await fs.writeFile(path.join(tmp, 'COMETFLOW.md'), markdown.replace('| 后端 | Golang |', '| 后端 | Node.js |'));
    await fs.mkdir(path.join(tmp, 'specs', 'auth'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'specs', 'auth', 'spec.md'), [
      '---',
      'capability: auth',
      '---',
      '',
      '# auth',
      '',
      '## POST /login',
      '',
      '## Acceptance',
      '',
      '- A1：ok',
    ].join('\n'));
    const plan: TaskPlan = {
      schema: 'cometflow.task-plan.v1',
      goal: 'G1',
      status: 'draft',
      tasks: [
        { id: 'T1', title: 'bad task', kind: 'implementation', capability: 'auth', spec_ref: 'specs/auth/spec.md', spec_anchor: 'POST /login', acceptance_ids: ['A1'], spec_version: 1, spec_hash: null, depends_on: [], test_scope: 'internal/auth', definition_of_done: ['go test ./...'], status: 'draft' },
      ],
    };
    const result = await validateTaskPlan(tmp, plan);
    expect(result.findings.some((finding) => finding.code === 'stack-command-mismatch')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
