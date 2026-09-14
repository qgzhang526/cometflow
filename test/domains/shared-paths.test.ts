import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseProjectContext } from '../../domains/project/context.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { collectImplementationScope, resolveScopeAllow } from '../../domains/workflow/implementation-scope.js';
import { evaluateHook } from '../../domains/guard/hook-guard.js';

const mission = [
  '# 项目使命',
  '',
  '内部平台。',
  '',
  '## 技术栈',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 后端 | Node.js |',
  '| 数据库 | 无 |',
  '| 测试框架 | vitest |',
  '| 构建工具 | tsc |',
  '',
  '## 运行环境',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 操作系统 | Linux |',
  '| 语言版本 | Node.js 22 |',
  '',
  '## 模块归属',
  '',
  '| 共享路径 | 说明 |',
  '|----------|------|',
  '| bin | CLI 入口，跨 capability 共享 |',
  '| package.json | 依赖清单 |',
  '',
  '## 任务目标',
  '',
  '### G1：认证',
  '- 目标：支持邮箱验证码登录',
  '- 范围：auth',
  '- 成功标准：',
  '  - 验证码错误返回 401',
  '',
].join('\n');

const authSpec = [
  '---',
  'capability: auth',
  'module: src/auth',
  '---',
  '',
  '# auth capability',
  '',
  '## POST /api/auth/email-login',
  '',
  '使用邮箱验证码登录。',
  '',
  '## Acceptance',
  '',
  '- A1：验证码正确时可以登录',
  '',
].join('\n');

let tmp: string;
let previousHome: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-shared-'));
  // 隔离全局配置，避免开发机上的 ~/.cometflow/config.yaml 影响断言。
  previousHome = process.env.COMETFLOW_HOME;
  process.env.COMETFLOW_HOME = path.join(tmp, 'home');
  await fs.mkdir(path.join(tmp, 'specs', 'auth'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'COMETFLOW.md'), mission);
  await fs.writeFile(path.join(tmp, 'specs', 'auth', 'spec.md'), authSpec);
  const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
  await writeTaskPlan(tmp, plan);
  await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: plan.tasks[0].id, changeName: 'login' });
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.COMETFLOW_HOME;
  else process.env.COMETFLOW_HOME = previousHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('project-declared shared paths', () => {
  it('parses shared paths from the 模块归属 table', () => {
    const context = parseProjectContext(mission);
    expect(context.shared_paths).toEqual(['bin', 'package.json']);
  });

  it('accepts a bullet list and normalizes path spellings', () => {
    const context = parseProjectContext([
      '## 模块归属',
      '',
      '- ./bin/',
      '- src\\shared',
      '- /absolute',
      '- ..',
      '',
    ].join('\n'));
    expect(context.shared_paths).toEqual(['absolute', 'bin', 'src/shared']);
  });

  it('merges COMETFLOW.md declarations with the local config override', async () => {
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, '.cometflow', 'config.yaml'),
      ['schema: cometflow.project.v1', 'scope:', '  allow:', '    - scripts'].join('\n'),
    );
    expect(await resolveScopeAllow(tmp)).toEqual(['bin', 'package.json', 'scripts']);
  });

  it('attributes a spec-declared shared path as allowed instead of a violation', async () => {
    await fs.mkdir(path.join(tmp, 'bin'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'bin', 'cli.mjs'), '#!/usr/bin/env node\n');
    await fs.writeFile(path.join(tmp, 'package.json'), '{"name":"demo","private":true}\n');
    await fs.writeFile(path.join(tmp, 'stray.ts'), 'export const stray = 1;\n');

    const scope = await collectImplementationScope(tmp, 'login', {
      module: 'src/auth',
      allow: await resolveScopeAllow(tmp),
    });
    expect(scope.attributed).toContain('bin/cli.mjs');
    expect(scope.attributed).toContain('package.json');
    expect(scope.unattributed).toEqual(['stray.ts']);
  });

  it('lets the hook guard write to a declared shared path but not to a random one', async () => {
    const state = await readChangeState(tmp, 'login');
    await writeChangeState(tmp, { ...state, phase: 'build' });

    const shared = await evaluateHook(tmp, 'write', path.join(tmp, 'bin', 'cli.mjs'));
    expect(shared.allowed).toBe(true);

    const outside = await evaluateHook(tmp, 'write', path.join(tmp, 'stray.ts'));
    expect(outside.allowed).toBe(false);
    expect(outside.reason).toBe('outside-module-scope');
  });
});
