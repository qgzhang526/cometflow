import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentRunner, AgentRunInput, AgentRunResult } from '../../platform/agents/types.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import {
  archiveChange,
  buildChangePrompt,
  runChange,
  verifyChange,
} from '../../domains/workflow/change-execution.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { readChangeJournal } from '../../domains/workflow/change-journal.js';
import { collectImplementationScope } from '../../domains/workflow/implementation-scope.js';
import { evaluateHook } from '../../domains/guard/hook-guard.js';

const moduleSpec = [
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
  '- A1：验证码正确时可以登录',
  '  - check: node -e "process.exit(0)"',
  '- A2：验证码错误返回 401',
  '  - check: node -e "process.exit(Number(process.env.CHECK_A2 || 0))"',
  '',
].join('\n');

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
  '## 任务目标',
  '',
  '### G1：认证',
  '- 目标：支持邮箱验证码登录',
  '- 范围：auth',
  '- 成功标准：',
  '  - 验证码错误返回 401',
  '',
].join('\n');

const noCheckSpec = moduleSpec
  .split('\n')
  .filter((line) => !line.includes('- check:'))
  .join('\n');

let tmp: string;

async function setup(spec: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-pipeline-'));
  await fs.mkdir(path.join(root, 'specs', 'auth'), { recursive: true });
  await fs.writeFile(path.join(root, 'COMETFLOW.md'), mission);
  await fs.writeFile(path.join(root, 'specs', 'auth', 'spec.md'), spec);
  const plan = await freezeTaskPlan(root, await generateTaskPlan(root, 'G1'));
  await writeTaskPlan(root, plan);
  await createChangeFromTask({
    projectRoot: root,
    goalId: 'G1',
    taskId: plan.tasks[0].id,
    changeName: 'email-login',
  });
  return root;
}

function fakeRunner(out: (input: AgentRunInput) => AgentRunResult, id = 'fake-verifier'): AgentRunner {
  return {
    id,
    name: id,
    buildCommand(input) {
      return { command: id, args: [input.prompt], cwd: input.cwd };
    },
    async run(input) {
      return out(input);
    },
    async check() {
      return true;
    },
    subagentTool() {
      return 'task';
    },
    configTemplate() {
      return 'none';
    },
  };
}

function verifierYaml(entries: { id: string; result: string; reason: string }[]): string {
  return [
    '```yaml',
    'schema: cometflow.verification.v1',
    'change: email-login',
    'acceptance:',
    ...entries.flatMap((entry) => [
      '  - id: ' + entry.id,
      '    result: ' + entry.result,
      '    reason: ' + entry.reason,
    ]),
    '```',
  ].join('\n');
}

async function toVerifyPhase(): Promise<void> {
  let state = await readChangeState(tmp, 'email-login');
  state = applyChangeTransition(state, 'confirm-acceptance');
  await writeChangeState(tmp, state);
  state = applyChangeTransition(state, 'submit-candidate');
  await writeChangeState(tmp, state);
}

beforeEach(async () => {
  process.env.CHECK_A2 = '0';
  tmp = await setup(moduleSpec);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('acceptance checks drive verification', () => {
  it('passes when every declared check exits zero', async () => {
    process.env.CHECK_A2 = '0';
    await toVerifyPhase();
    const outcome = await verifyChange(tmp, 'email-login');
    expect(outcome.reportPassed).toBe(true);
    expect(outcome.verdicts.map((entry) => entry.source)).toEqual(['check', 'check']);
    expect(outcome.state.phase).toBe('archive');
  });

  it('fails when a declared check exits non-zero', async () => {
    process.env.CHECK_A2 = '1';
    await toVerifyPhase();
    const outcome = await verifyChange(tmp, 'email-login');
    expect(outcome.reportPassed).toBe(false);
    expect(outcome.verdicts.find((entry) => entry.id === 'A2')?.result).toBe('failed');
    expect(outcome.state.phase).toBe('build');
  });

  it('does not let a verification document override a failing check', async () => {
    process.env.CHECK_A2 = '1';
    await toVerifyPhase();
    await fs.writeFile(path.join(tmp, 'changes', 'email-login', 'verification.yaml'), [
      'schema: cometflow.verification.v1',
      'change: email-login',
      'acceptance:',
      '  - id: A1',
      '    result: passed',
      '    reason: looks fine',
      '  - id: A2',
      '    result: passed',
      '    reason: looks fine',
    ].join('\n'));

    const outcome = await verifyChange(tmp, 'email-login');
    expect(outcome.verdicts.find((entry) => entry.id === 'A2')).toMatchObject({
      result: 'failed',
      source: 'check',
    });
    expect(outcome.reportPassed).toBe(false);
  });
});

describe('independent verifier', () => {
  it('fills verdicts for acceptance items without a check', async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    tmp = await setup(noCheckSpec);
    await toVerifyPhase();

    const runner = fakeRunner(() => ({
      exitCode: 0,
      stdout: verifierYaml([
        { id: 'A1', result: 'passed', reason: 'check passed' },
        { id: 'A2', result: 'passed', reason: 'read the code path and confirmed 401' },
      ]),
      stderr: '',
      timedOut: false,
    }));
    const outcome = await verifyChange(tmp, 'email-login', { runner, mode: 'checks+agent' });
    expect(outcome.reportPassed).toBe(true);
    expect(outcome.verifierAgent).toBe('fake-verifier');
    expect(outcome.verdicts.find((entry) => entry.id === 'A2')?.source).toBe('agent');
  });

  it('blocks when the verifier is required but no runner is available', async () => {
    await toVerifyPhase();
    const outcome = await verifyChange(tmp, 'email-login', { mode: 'agent-required' });
    expect(outcome.reportPassed).toBe(false);
    expect(outcome.verdicts.every((entry) => entry.result !== 'failed')).toBe(true);
  });

  it('rejects a verifier report with incomplete coverage', async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    tmp = await setup(noCheckSpec);
    await toVerifyPhase();
    const runner = fakeRunner(() => ({
      exitCode: 0,
      stdout: verifierYaml([{ id: 'A1', result: 'passed', reason: 'ok' }]),
      stderr: '',
      timedOut: false,
    }));
    const outcome = await verifyChange(tmp, 'email-login', { runner, mode: 'agent-required' });
    expect(outcome.reportPassed).toBe(false);
    // 覆盖不完整时整份 Verifier 结论作废，两项都退回未覆盖。
    expect(outcome.verdicts.map((entry) => entry.source)).toEqual(['uncovered', 'uncovered']);
  });
});

describe('implementation scope is enforced', () => {
  it('reports files inside and outside the declared module', async () => {
    await fs.mkdir(path.join(tmp, 'internal', 'auth'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'internal', 'auth', 'login.ts'), 'export const login = 1;\n');
    await fs.writeFile(path.join(tmp, 'stray.ts'), 'export const stray = 1;\n');

    const scope = await collectImplementationScope(tmp, 'email-login', { module: 'internal/auth' });
    expect(scope.attributed).toContain('internal/auth/login.ts');
    expect(scope.unattributed).toContain('stray.ts');
    expect(scope.complete).toBe(false);
  });

  it('denies hook writes outside the module during build', async () => {
    const state = await readChangeState(tmp, 'email-login');
    await writeChangeState(tmp, { ...state, phase: 'build' });

    const inside = await evaluateHook(tmp, 'write', path.join(tmp, 'internal', 'auth', 'login.ts'));
    expect(inside.allowed).toBe(true);

    const outside = await evaluateHook(tmp, 'write', path.join(tmp, 'stray.ts'));
    expect(outside.allowed).toBe(false);
    expect(outside.reason).toBe('outside-module-scope');
  });

  it('fails verification when a module-declared change writes outside the module', async () => {
    process.env.CHECK_A2 = '0';
    await fs.writeFile(path.join(tmp, 'stray.ts'), 'export const stray = 1;\n');
    await toVerifyPhase();

    const outcome = await verifyChange(tmp, 'email-login');
    expect(outcome.reportPassed).toBe(false);
    expect(outcome.state.phase).toBe('build');
    const report = await fs.readFile(path.join(tmp, 'changes', 'email-login', 'verification.md'), 'utf8');
    expect(report).toContain('implementation escaped module internal/auth');
  });

  it('refuses to archive an out-of-module change even if verification was bypassed', async () => {
    await fs.writeFile(path.join(tmp, 'stray.ts'), 'export const stray = 1;\n');
    let state = await readChangeState(tmp, 'email-login');
    state = applyChangeTransition(state, 'confirm-acceptance');
    state = applyChangeTransition(state, 'submit-candidate');
    state = applyChangeTransition(state, 'verify-pass');
    await writeChangeState(tmp, state);

    await expect(archiveChange(tmp, 'email-login')).rejects.toThrow(/implementation scope violation/u);
  });
});

describe('change journal and spec apply transaction', () => {
  it('records the lifecycle as an append-only journal', async () => {
    let state = await readChangeState(tmp, 'email-login');
    state = applyChangeTransition(state, 'confirm-acceptance');
    await writeChangeState(tmp, state);
    await runChange(tmp, 'email-login', fakeRunner(() => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    }), 'fake-builder'));
    await verifyChange(tmp, 'email-login');
    await archiveChange(tmp, 'email-login');

    const events = (await readChangeJournal(tmp, 'email-login')).map((event) => event.event);
    expect(events).toContain('change-created');
    expect(events).toContain('implementation-baseline-captured');
    expect(events).toContain('run-started');
    expect(events).toContain('verify-result');
    expect(events).toContain('archive-completed');
  });

  it('rolls back already-applied specs when a later write fails', async () => {
    let state = await readChangeState(tmp, 'email-login');
    state = applyChangeTransition(state, 'confirm-acceptance');
    state = applyChangeTransition(state, 'submit-candidate');
    state = applyChangeTransition(state, 'verify-pass');
    await writeChangeState(tmp, state);

    const proposed = path.join(tmp, 'changes', 'email-login', 'specs');
    await fs.mkdir(path.join(proposed, 'auth'), { recursive: true });
    // 排序后 entries = [errors.md, zcap/spec.md]：前者会写入成功，后者因 specs/zcap
    // 被文件占位而在 commit 阶段失败，从而触发回滚。
    await fs.writeFile(path.join(proposed, 'errors.md'), '# errors\n\n## 错误码\n\n| code | 语义 |\n|------|------|\n| E1 | x |\n');
    await fs.mkdir(path.join(proposed, 'zcap'), { recursive: true });
    await fs.writeFile(path.join(proposed, 'zcap', 'spec.md'), '# zcap\n');
    await fs.writeFile(path.join(tmp, 'specs', 'zcap'), 'occupied by a file\n');

    await expect(archiveChange(tmp, 'email-login')).rejects.toThrow(/failed to apply proposed specs/u);
    // 已写入的 errors.md 必须被回滚掉。
    await expect(fs.access(path.join(tmp, 'specs', 'errors.md'))).rejects.toThrow();
    expect((await readChangeState(tmp, 'email-login')).archived).toBe(false);
  });
});
