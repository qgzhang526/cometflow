import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunner, AgentRunInput, AgentRunResult } from '../../platform/agents/types.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { verifyChange } from '../../domains/workflow/change-execution.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { readChangeJournal } from '../../domains/workflow/change-journal.js';
import { collectMetrics } from '../../domains/metrics/metrics-service.js';

vi.setConfig({ testTimeout: 30_000 });

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

/** 不给 check：验收项只能由独立 Verifier 判定，用来测「必须有人判」的分支。 */
const specWithoutCheck = [
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

/** 带 check：判定完全由命令决定，用来测「Verifier 缺失不阻断」的分支。 */
const specWithCheck = [
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
  '',
].join('\n');

const changeName = 'email-login';
let tmp: string;
let runnerCalls = 0;

function verifierYaml(entries: { id: string; result: string; reason: string }[]): string {
  return [
    '```yaml',
    'schema: cometflow.verification.v1',
    'change: ' + changeName,
    'acceptance:',
    ...entries.flatMap((entry) => [
      '  - id: ' + entry.id,
      '    result: ' + entry.result,
      '    reason: ' + entry.reason,
    ]),
    '```',
  ].join('\n');
}

function runner(out: (input: AgentRunInput) => AgentRunResult, id = 'fake-verifier'): AgentRunner {
  return {
    id,
    name: id,
    buildCommand(input) {
      return { command: id, args: [input.prompt], cwd: input.cwd };
    },
    async run(input) {
      runnerCalls += 1;
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

async function setup(configLines: string[] = [], specContent = specWithoutCheck): Promise<void> {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-verifier-'));
  await fs.mkdir(path.join(tmp, 'specs', 'auth'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'COMETFLOW.md'), mission);
  await fs.writeFile(path.join(tmp, 'specs', 'auth', 'spec.md'), specContent);
  if (configLines.length > 0) {
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await fs.writeFile(path.join(tmp, '.cometflow', 'config.yaml'), configLines.join('\n'));
  }
  const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
  await writeTaskPlan(tmp, plan);
  await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: plan.tasks[0].id, changeName });
  const state = await readChangeState(tmp, changeName);
  await writeChangeState(tmp, applyChangeTransition(state, 'confirm-acceptance'));
  await writeChangeState(
    tmp,
    applyChangeTransition(await readChangeState(tmp, changeName), 'submit-candidate'),
  );
  runnerCalls = 0;
}

beforeEach(async () => {
  tmp = '';
});

afterEach(async () => {
  if (tmp !== '') await fs.rm(tmp, { recursive: true, force: true });
});

describe('verifier policy', () => {
  it('records a warning but keeps failing the unjudged item (default policy)', async () => {
    await setup();
    const outcome = await verifyChange(tmp, changeName, { mode: 'checks+agent' });

    // warn 只改变「Verifier 缺失」这一条的处理方式；验收项本身无法判定仍必须失败（ADR 0013）。
    expect(outcome.verifierAgent).toBeNull();
    expect(outcome.reportPassed).toBe(false);
    expect(outcome.verdicts[0].source).toBe('uncovered');
    const report = await fs.readFile(path.join(tmp, 'changes', changeName, 'verification.md'), 'utf8');
    expect(report).toContain('verifier_policy: warn');
    expect(report).toContain('no independent verification this round');
    // 没有把「Verifier 缺失」升级成 violation —— 那是 fail 策略的行为。
    expect(report).not.toContain('verification.verifier_policy=fail');
  });

  it('warn does not block a change whose acceptance is fully decided by checks', async () => {
    await setup([], specWithCheck);
    const outcome = await verifyChange(tmp, changeName, { mode: 'checks+agent' });

    expect(outcome.verifierAgent).toBeNull();
    expect(outcome.reportPassed).toBe(true);
    expect(outcome.verdicts[0].source).toBe('check');
    const report = await fs.readFile(path.join(tmp, 'changes', changeName, 'verification.md'), 'utf8');
    expect(report).toContain('no independent verification this round');
  });

  it('fails when policy is fail and no verifier is available', async () => {
    await setup(['schema: cometflow.project.v1', 'verification:', '  verifier_policy: fail']);
    const outcome = await verifyChange(tmp, changeName, { mode: 'checks+agent' });

    expect(outcome.reportPassed).toBe(false);
    expect(
      outcome.verdicts.every((verdict) => verdict.result !== 'passed'),
    ).toBe(true);
    const report = await fs.readFile(path.join(tmp, 'changes', changeName, 'verification.md'), 'utf8');
    expect(report).toContain('verifier_policy=fail');
  });

  it('stays silent when policy is skip', async () => {
    await setup(['schema: cometflow.project.v1', 'verification:', '  verifier_policy: skip']);
    await verifyChange(tmp, changeName, { mode: 'checks+agent' });
    const report = await fs.readFile(path.join(tmp, 'changes', changeName, 'verification.md'), 'utf8');
    expect(report).not.toContain('no independent verification this round');
  });

  it('uses the verifier verdict when an agent is available, and records the cost', async () => {
    await setup();
    const outcome = await verifyChange(tmp, changeName, {
      mode: 'checks+agent',
      runner: runner(() => ({
        exitCode: 0,
        stdout: verifierYaml([{ id: 'A1', result: 'passed', reason: '读了实现，确认走通' }]),
        stderr: '',
        timedOut: false,
      })),
      verifierAgentId: 'fake-verifier',
    });

    expect(runnerCalls).toBe(1);
    expect(outcome.reportPassed).toBe(true);
    expect(outcome.verdicts[0].source).toBe('agent');
    expect(outcome.verifierAgent).toBe('fake-verifier');

    const events = await readChangeJournal(tmp, changeName);
    const result = events.find((event) => event.event === 'verify-result');
    expect(typeof result?.data?.verifier_ms).toBe('number');
    expect(result?.data?.verifier_agent_id).toBe('fake-verifier');

    const metrics = await collectMetrics(tmp, { now: new Date('2026-09-14T12:00:00.000Z') });
    expect(metrics.rebuild.verifier.runs).toBe(1);
    expect(metrics.rebuild.verdict_sources.agent).toBe(1);
  });

  it('never calls the verifier when mode is checks (default)', async () => {
    await setup();
    await verifyChange(tmp, changeName, {
      runner: runner(() => ({
        exitCode: 0,
        stdout: verifierYaml([{ id: 'A1', result: 'passed', reason: 'ok' }]),
        stderr: '',
        timedOut: false,
      })),
    });
    expect(runnerCalls).toBe(0);
  });

  it('treats an unavailable agent as missing under agent-required', async () => {
    await setup();
    const outcome = await verifyChange(tmp, changeName, {
      mode: 'agent-required',
      verifierAgentId: 'opencode',
      verifierUnavailableReason: 'verifier agent "opencode" is not installed or not on PATH',
    });
    expect(outcome.reportPassed).toBe(false);
    expect(outcome.verdicts[0].source).toBe('uncovered');
    expect(outcome.verdicts[0].reason).toContain('not installed');
  });
});
