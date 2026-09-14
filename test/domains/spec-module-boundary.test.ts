import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { validateTaskPlan } from '../../domains/task-plan/task-plan-validate.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { buildChangePrompt } from '../../domains/workflow/change-execution.js';

const cometflowMd = [
  '# 项目使命',
  '',
  '构建内部平台。',
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
  '## 任务目标',
  '',
  '### G1：认证',
  '- 目标：支持邮箱验证码登录',
  '- 范围：auth',
  '- 成功标准：',
  '  - 验证码错误返回 401',
  '',
].join('\n');

const specWithModule = [
  '---',
  'capability: auth',
  'module: internal/auth',
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
  '- A1：未注册邮箱可以获取验证码',
  '',
].join('\n');

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-module-'));
  await fs.mkdir(path.join(tmp, 'specs', 'auth'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'COMETFLOW.md'), cometflowMd);
  await fs.writeFile(path.join(tmp, 'specs', 'auth', 'spec.md'), specWithModule);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('spec declared module boundary', () => {
  it('propagates the spec module into task scope and the builder prompt', async () => {
    const plan = await generateTaskPlan(tmp, 'G1');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].module).toBe('internal/auth');
    expect(plan.tasks[0].test_scope).toBe('internal/auth');

    const validation = await validateTaskPlan(tmp, plan);
    expect(validation.valid).toBe(true);

    const frozen = await freezeTaskPlan(tmp, plan);
    await writeTaskPlan(tmp, frozen);
    await createChangeFromTask({
      projectRoot: tmp,
      goalId: 'G1',
      taskId: frozen.tasks[0].id,
      changeName: 'email-login',
    });

    const prompt = await buildChangePrompt(tmp, 'email-login');
    expect(prompt).toContain('module: internal/auth');
    expect(prompt).toContain('Keep the implementation inside `internal/auth`');
  });

  it('rejects a plan whose test_scope escapes the declared module', async () => {
    const plan = await generateTaskPlan(tmp, 'G1');
    const tampered = {
      ...plan,
      tasks: plan.tasks.map((task) => ({ ...task, test_scope: 'internal/payments' })),
    };
    const validation = await validateTaskPlan(tmp, tampered);
    expect(validation.valid).toBe(false);
    expect(validation.findings.map((finding) => finding.code)).toContain('module-scope-mismatch');
  });

  it('re-binds module and test_scope when freezing a plan that predates module support', async () => {
    const plan = await generateTaskPlan(tmp, 'G1');
    // 模拟平台升级前生成的旧计划：没有 module，test_scope 也不是 spec 声明的模块。
    const legacy = {
      ...plan,
      tasks: plan.tasks.map(({ module: _module, ...rest }) => ({ ...rest, test_scope: 'internal/legacy' })),
    };
    await writeTaskPlan(tmp, legacy);

    const frozen = await freezeTaskPlan(tmp, legacy);
    expect(frozen.tasks[0].module).toBe('internal/auth');
    expect(frozen.tasks[0].test_scope).toBe('internal/auth');
    // 重新冻结后计划必须自洽，不能再报 module-scope-mismatch。
    const validation = await validateTaskPlan(tmp, frozen);
    expect(validation.findings.map((finding) => finding.code)).not.toContain('module-scope-mismatch');
  });
});
