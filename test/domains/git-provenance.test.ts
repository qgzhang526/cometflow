import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunner } from '../../platform/agents/types.js';
import { runCommand } from '../../platform/process/spawn-command.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { runChange } from '../../domains/workflow/change-execution.js';
import { checkGitDrift } from '../../domains/workflow/git-provenance.js';
import { readChangeState, writeChangeState } from '../../domains/workflow/change-store.js';
import { readChangeJournal } from '../../domains/workflow/change-journal.js';
import { runDoctor } from '../../domains/dashboard/doctor.js';

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
  '',
].join('\n');

const changeName = 'email-login';
let tmp: string;

// 每个用例都要起若干 git 子进程；并行跑整个套件时 5s 默认超时不够用。
vi.setConfig({ testTimeout: 30_000 });

async function git(args: string[], cwd = tmp): Promise<string> {
  const result = await runCommand('git', args, { cwd, timeoutMs: 20_000 });
  if (result.exitCode !== 0) {
    throw new Error('git ' + args.join(' ') + ' failed: ' + result.stderr);
  }
  return result.stdout.trim();
}

const IDENTITY = ['-c', 'user.email=codex@example.com', '-c', 'user.name=codex'];

function runner(): AgentRunner {
  return {
    id: 'fake',
    name: 'fake',
    buildCommand(input) {
      return { command: 'fake', args: [input.prompt], cwd: input.cwd };
    },
    async run() {
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
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

async function initProject(options: { git: boolean }): Promise<void> {
  await fs.mkdir(path.join(tmp, 'specs', 'auth'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'COMETFLOW.md'), mission);
  await fs.writeFile(path.join(tmp, 'specs', 'auth', 'spec.md'), spec);
  if (options.git) {
    await git(['init']);
    await git([...IDENTITY, 'add', '-A']);
    await git([...IDENTITY, 'commit', '-m', 'init']);
  }
  const plan = await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1'));
  await writeTaskPlan(tmp, plan);
  await createChangeFromTask({ projectRoot: tmp, goalId: 'G1', taskId: plan.tasks[0].id, changeName });
}

async function toBuild(): Promise<void> {
  const state = await readChangeState(tmp, changeName);
  await writeChangeState(tmp, { ...state, phase: 'build' });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-git-'));
});

afterEach(async () => {
  await removeWithRetry(tmp);
});

/**
 * Windows 上删除刚跑过 git 的临时目录会被系统句柄短暂占用（EBUSY/EPERM），
 * 重试几次即可；仍失败时留下临时目录也不影响测试结论。
 */
async function removeWithRetry(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY', 'EMFILE'].includes(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

describe('git provenance capture', () => {
  it('binds the change to the commit it started from', async () => {
    await initProject({ git: true });
    const state = await readChangeState(tmp, changeName);
    const head = await git(['rev-parse', 'HEAD']);

    expect(state.base_commit).toBe(head);
    expect(state.base_branch).toBeTruthy();
    expect((await checkGitDrift(tmp, state)).status).toBe('ok');
  });

  it('accepts commits made after the change was created', async () => {
    await initProject({ git: true });
    await fs.writeFile(path.join(tmp, 'work.ts'), 'export const work = 1;\n');
    // 只提交工作文件：change 状态与 .cometflow 属于运行时产物，不进入提交。
    await git([...IDENTITY, 'add', 'work.ts']);
    await git([...IDENTITY, 'commit', '-m', 'progress']);

    const report = await checkGitDrift(tmp, await readChangeState(tmp, changeName));
    expect(report.status).toBe('ok');
    expect(report.blocking).toBe(false);
    expect(report.detail).toContain('推进');
  });

  it('detects a rewound history', async () => {
    await initProject({ git: true });
    const base = (await readChangeState(tmp, changeName)).base_commit!;
    await fs.writeFile(path.join(tmp, 'work.ts'), 'export const work = 1;\n');
    await git([...IDENTITY, 'add', 'work.ts']);
    await git([...IDENTITY, 'commit', '-m', 'later']);

    // 把 change 重新绑到更晚的提交上，再把 HEAD 退回到更早的提交。
    await writeChangeState(tmp, { ...(await readChangeState(tmp, changeName)), base_commit: await git(['rev-parse', 'HEAD']) });
    await git(['reset', '--hard', base]);

    const report = await checkGitDrift(tmp, await readChangeState(tmp, changeName));
    expect(report.status).toBe('head-rewound');
    expect(report.blocking).toBe(true);
  });

  it('detects a diverged history', async () => {
    await initProject({ git: true });
    await git([...IDENTITY, 'checkout', '--orphan', 'other']);
    await git([...IDENTITY, 'commit', '--allow-empty', '-m', 'unrelated']);

    const report = await checkGitDrift(tmp, await readChangeState(tmp, changeName));
    expect(report.status).toBe('diverged');
    expect(report.blocking).toBe(true);
    expect(report.detail).toContain('没有演进关系');
  });

  it('degrades to a warning outside a git repository', async () => {
    await initProject({ git: false });
    const state = await readChangeState(tmp, changeName);
    expect(state.base_commit).toBeNull();

    const report = await checkGitDrift(tmp, state);
    expect(report.status).toBe('not-a-repo');
    expect(report.blocking).toBe(false);

    await toBuild();
    await expect(runChange(tmp, changeName, runner())).resolves.toBeDefined();
  });

  it('treats a change without a recorded base as unbound', async () => {
    await initProject({ git: true });
    const state = await readChangeState(tmp, changeName);
    await writeChangeState(tmp, { ...state, base_commit: null });

    const report = await checkGitDrift(tmp, await readChangeState(tmp, changeName));
    expect(report.status).toBe('unbound');
    expect(report.blocking).toBe(false);
  });
});

describe('git provenance enforcement', () => {
  it('blocks run on drift and reports the recovery path', async () => {
    await initProject({ git: true });
    await git([...IDENTITY, 'checkout', '--orphan', 'other']);
    await git([...IDENTITY, 'commit', '--allow-empty', '-m', 'unrelated']);
    await toBuild();

    await expect(runChange(tmp, changeName, runner())).rejects.toThrow(/git provenance drift/u);
    await expect(runChange(tmp, changeName, runner())).rejects.toThrow(/--allow-drift/u);
  });

  it('allows an explicit override and records it in the journal', async () => {
    await initProject({ git: true });
    await git([...IDENTITY, 'checkout', '--orphan', 'other']);
    await git([...IDENTITY, 'commit', '--allow-empty', '-m', 'unrelated']);
    await toBuild();

    await expect(
      runChange(tmp, changeName, runner(), { allowDrift: true }),
    ).resolves.toBeDefined();
    const events = await readChangeJournal(tmp, changeName);
    const override = events.find((event) => event.event === 'git-drift-overridden');
    expect(override?.data?.override).toBe('flag');
    expect(override?.data?.status).toBe('diverged');
  });

  it('allows drift when the project config opts in', async () => {
    await initProject({ git: true });
    await fs.mkdir(path.join(tmp, '.cometflow'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, '.cometflow', 'config.yaml'),
      ['schema: cometflow.project.v1', 'git:', '  allow_drift: true'].join('\n'),
    );
    await git([...IDENTITY, 'checkout', '--orphan', 'other']);
    await git([...IDENTITY, 'commit', '--allow-empty', '-m', 'unrelated']);
    await toBuild();

    await expect(runChange(tmp, changeName, runner())).resolves.toBeDefined();
    const events = await readChangeJournal(tmp, changeName);
    expect(events.find((event) => event.event === 'git-drift-overridden')?.data?.override).toBe('config');
  });

  it('surfaces drift through doctor', async () => {
    await initProject({ git: true });
    await git([...IDENTITY, 'checkout', '--orphan', 'other']);
    await git([...IDENTITY, 'commit', '--allow-empty', '-m', 'unrelated']);

    const report = await runDoctor(tmp);
    expect(report.findings.map((finding) => finding.code)).toContain('git-provenance-drift');
    expect(report.healthy).toBe(false);
  });
});
