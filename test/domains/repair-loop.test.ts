import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentRunner } from '../../platform/agents/types.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import {
  runChange,
  unblockChange,
  verifyChange,
  verdictFingerprint,
} from '../../domains/workflow/change-execution.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { resumeChange } from '../../domains/workflow/change-resume.js';
import { readChangeJournal } from '../../domains/workflow/change-journal.js';

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

/** 两条验收命令的退出码由环境变量控制，便于在同一项目里制造「同结论」与「换结论」。 */
const spec = [
  '# auth capability',
  '',
  '## POST /api/auth/email-login',
  '',
  '使用邮箱验证码登录。',
  '',
  '## Acceptance',
  '',
  '- A1：验证码正确时可以登录',
  '  - check: node -e "process.exit(Number(process.env.CHECK_A1 || 0))"',
  '- A2：验证码错误返回 401',
  '  - check: node -e "process.exit(Number(process.env.CHECK_A2 || 0))"',
  '',
].join('\n');

const changeName = 'email-login';
let tmp: string;

function runner(exitCode = 0): AgentRunner {
  return {
    id: 'fake-builder',
    name: 'fake-builder',
    buildCommand(input) {
      return { command: 'fake', args: [input.prompt], cwd: input.cwd };
    },
    async run() {
      return { exitCode, stdout: '', stderr: '', timedOut: false };
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

async function toVerifyPhase(): Promise<void> {
  let state = await readChangeState(tmp, changeName);
  state = applyChangeTransition(state, 'submit-candidate');
  await writeChangeState(tmp, state);
}

async function toBuildPhase(): Promise<void> {
  let state = await readChangeState(tmp, changeName);
  state = applyChangeTransition(state, 'confirm-acceptance');
  await writeChangeState(tmp, state);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-repair-'));
  await fs.mkdir(path.join(tmp, 'specs', 'auth'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'COMETFLOW.md'), mission);
  await fs.writeFile(path.join(tmp, 'specs', 'auth', 'spec.md'), spec);
  const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
  await writeTaskPlan(tmp, plan);
  await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: plan.tasks[0].id, changeName });
  process.env.CHECK_A1 = '0';
  process.env.CHECK_A2 = '0';
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('verdict fingerprint', () => {
  it('ignores reasons and evidence source, keeps conclusions and violations', () => {
    const base = [
      { id: 'A1', result: 'failed' as const, reason: 'first wording', source: 'check' as const },
      { id: 'A2', result: 'passed' as const, reason: 'ok', source: 'check' as const },
    ];
    const reworded = [
      { id: 'A1', result: 'failed' as const, reason: 'completely different text', source: 'agent' as const },
      { id: 'A2', result: 'passed' as const, reason: 'ok', source: 'check' as const },
    ];
    expect(verdictFingerprint(base, [])).toBe(verdictFingerprint(reworded, []));
    expect(verdictFingerprint(base, ['a'])).not.toBe(verdictFingerprint(base, ['b']));
    expect(verdictFingerprint(base, [])).not.toBe(
      verdictFingerprint([{ ...base[0], result: 'blocked' }], []),
    );
  });
});

describe('bounded repair loop', () => {
  it('blocks after the same failing verdict repeats up to the limit', async () => {
    process.env.CHECK_A1 = '1';
    await toBuildPhase();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await toVerifyPhase();
      const outcome = await verifyChange(tmp, changeName);
      expect(outcome.reportPassed).toBe(false);
      expect(outcome.state.repair_attempts).toBe(attempt);
      expect(outcome.state.phase).toBe('build');
      expect(outcome.state.status).toBe(attempt >= 3 ? 'blocked' : 'active');
    }
  });

  it('keeps going while the failing verdict changes', async () => {
    process.env.CHECK_A1 = '1';
    await toBuildPhase();

    await toVerifyPhase();
    const first = await verifyChange(tmp, changeName);
    expect(first.state.repair_attempts).toBe(1);

    // 换了失败结论（A1 修好，A2 坏了）→ 说明有进展，计数归 1 而不是累加。
    process.env.CHECK_A1 = '0';
    process.env.CHECK_A2 = '1';
    await toVerifyPhase();
    const second = await verifyChange(tmp, changeName);
    expect(second.state.repair_attempts).toBe(1);
    expect(second.state.status).toBe('active');
  });

  it('resets the counter and clears the fingerprint on success', async () => {
    process.env.CHECK_A1 = '1';
    await toBuildPhase();
    await toVerifyPhase();
    const failed = await verifyChange(tmp, changeName);
    expect(failed.state.last_verdict_hash).toMatch(/^[a-f0-9]{64}$/u);

    process.env.CHECK_A1 = '0';
    await toVerifyPhase();
    const passed = await verifyChange(tmp, changeName);
    expect(passed.reportPassed).toBe(true);
    expect(passed.state.repair_attempts).toBe(0);
    expect(passed.state.last_verdict_hash).toBeNull();
  });

  it('honours verification.max_repair_attempts from project config', async () => {
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, '.cometflow', 'config.yaml'),
      ['schema: cometflow.project.v1', 'verification:', '  max_repair_attempts: 2'].join('\n'),
    );
    process.env.CHECK_A1 = '1';
    await toBuildPhase();

    await toVerifyPhase();
    expect((await verifyChange(tmp, changeName)).state.status).toBe('active');
    await toVerifyPhase();
    const second = await verifyChange(tmp, changeName);
    expect(second.state.status).toBe('blocked');
    expect(second.state.repair_attempts).toBe(2);
  });

  it('refuses to run a blocked change and tells the operator what to do', async () => {
    process.env.CHECK_A1 = '1';
    await toBuildPhase();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await toVerifyPhase();
      await verifyChange(tmp, changeName);
    }

    await expect(runChange(tmp, changeName, runner())).rejects.toThrow(/is blocked/u);
    const resume = resumeChange(await readChangeState(tmp, changeName));
    expect(resume.blocked).toBe(true);
    expect(resume.nextEvent).toBeNull();
    expect(resume.message).toContain('change unblock');
  });

  it('can be unblocked explicitly and records the decision in the journal', async () => {
    process.env.CHECK_A1 = '1';
    await toBuildPhase();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await toVerifyPhase();
      await verifyChange(tmp, changeName);
    }

    const outcome = await unblockChange(tmp, changeName, { note: 'spec 已澄清，重试' });
    expect(outcome.state.status).toBe('active');
    expect(outcome.state.repair_attempts).toBe(0);
    expect(outcome.state.last_verdict_hash).toBeNull();
    expect(outcome.previousAttempts).toBe(3);

    const events = await readChangeJournal(tmp, changeName);
    expect(events.some((event) => event.event === 'unblocked')).toBe(true);

    // 解封后可以再次运行。
    await expect(runChange(tmp, changeName, runner())).resolves.toBeDefined();
  });

  it('rejects unblocking a change that is not blocked', async () => {
    await expect(unblockChange(tmp, changeName)).rejects.toThrow(/is not blocked/u);
  });
});
