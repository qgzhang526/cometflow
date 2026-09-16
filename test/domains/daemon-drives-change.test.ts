import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDaemonLoop } from '../../domains/scheduler/daemon.js';
import { changeNameForTask, runTaskThroughChange } from '../../domains/scheduler/daemon-run-change.js';
import { readDaemonState } from '../../domains/scheduler/daemon-state.js';
import { readQueue } from '../../domains/scheduler/queue.js';
import { readChangeState } from '../../domains/workflow/change-store.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import type { AgentRunner } from '../../platform/agents/types.js';

/**
 * P4 / S1：daemon 走 change 交付通道。
 *
 * 在它之前，daemon 把任务丢给 `runFlowRun`（无绑定会话），按**退出码**判成败——
 * 于是队列里的 `done` 既没有 change 账本，也没有 acceptance 结论。
 * 这里钉住三件事：交付走完整生命周期、失败按尝试上限重试、spec 冲突停机交人工。
 */

let root: string;

const SPEC = [
  '---',
  'capability: core',
  'module: src/core',
  '---',
  '',
  '# core capability',
  '',
  '## CORE-001 add',
  '',
  '核心加法能力。',
  '',
  '## Acceptance',
  '',
  '- A1：add 可用',
  '  - check: node -e "process.exit(0)"',
  '',
].join('\n');

function mockRunner(exitCode = 0, onRun?: () => Promise<void>): AgentRunner {
  return {
    id: 'mock',
    name: 'mock',
    buildCommand: (input) => ({ command: 'mock', args: [input.prompt], cwd: input.cwd }),
    run: async () => {
      if (onRun) await onRun();
      return { exitCode, stdout: 'mock ok', stderr: '', timedOut: false };
    },
    check: async () => true,
    subagentTool: () => 'task',
    configTemplate: () => 'none',
  };
}

async function makeProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-daemon-change-'));
  await fs.mkdir(path.join(dir, '.cometflow', 'plans'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.cometflow', 'config.yaml'),
    'schema: cometflow.project.v1\nplan_review: auto\nagent: mock\nverification:\n  mode: checks\n',
  );
  await fs.writeFile(
    path.join(dir, 'COMETFLOW.md'),
    [
      '# 项目使命',
      '',
      '## 任务目标',
      '',
      '### G1：核心能力',
      '- 目标：实现 core',
      '- 范围：core',
      '- 成功标准：',
      '  - add 可用',
      '',
    ].join('\n'),
  );
  await fs.mkdir(path.join(dir, 'specs', 'core'), { recursive: true });
  await fs.writeFile(path.join(dir, 'specs', 'core', 'spec.md'), SPEC);
  return dir;
}

/** 冻结 G1 的计划：daemon 的队列就是从这份冻结计划推导出来的。 */
async function freezePlan(): Promise<void> {
  const plan = await generateTaskPlan(root, 'G1');
  await writeTaskPlan(root, await freezeTaskPlan(root, plan));
}

beforeEach(async () => {
  root = await makeProject();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('daemon 驱动 change（S1）', () => {
  it('把冻结任务推进到「已归档」，并把交付事实写进队列与状态投影', async () => {
    await freezePlan();

    await runDaemonLoop({ projectRoot: root, agentId: 'mock', mode: 'always', runner: mockRunner(), intervalMs: 0 });

    // 1) change 账本：存在、已归档，且有验收记录
    const state = await readChangeState(root, changeNameForTask('G1', 'T1'));
    expect(state.archived).toBe(true);
    expect(state.status).toBe('done');
    expect(state.phase).toBe('archive');
    const verification = await fs.readFile(
      path.join(root, 'changes', changeNameForTask('G1', 'T1'), 'verification.md'),
      'utf8',
    );
    expect(verification).toContain('A1');
    expect(verification).toContain('passed');

    // 2) 队列：done 的来源是「交付」，并带上 change 名与结论
    const queue = await readQueue(root);
    const task = queue?.tasks.find((entry) => entry.id === 'G1:T1');
    expect(task?.status).toBe('done');
    expect(task?.change).toBe('G1-T1');
    expect(task?.verdict).toBe('delivered');

    // 3) 状态投影：队列跑空即停，上一次任务是「已交付」
    const daemon = await readDaemonState(root);
    expect(daemon?.phase).toBe('stopped');
    expect(daemon?.stopped_reason).toBe('no-queued-task');
    expect(daemon?.last_task?.verdict).toBe('delivered');
    expect(daemon?.last_task?.change).toBe('G1-T1');
  });

  it('builder 失败按尝试上限重试，达到上限后标 failed 不再重跑', async () => {
    await freezePlan();

    await runDaemonLoop({
      projectRoot: root,
      agentId: 'mock',
      mode: 'always',
      runner: mockRunner(3),
      intervalMs: 0,
      maxAttempts: 2,
    });

    const queue = await readQueue(root);
    const task = queue?.tasks.find((entry) => entry.id === 'G1:T1');
    expect(task?.status).toBe('failed');
    expect(task?.attempts).toBe(2);
    expect(task?.verdict).toBe('agent-failed');
    // change 仍在账本里（未归档），人可以接手继续：这就是「交付通道」与旧路径的区别。
    const state = await readChangeState(root, changeNameForTask('G1', 'T1'));
    expect(state.archived).toBe(false);
    expect(state.phase).toBe('build');
  });

  it('spec 在 change 存续期间被改过 → 停机交人工，不静默归档', async () => {
    await freezePlan();
    await createChangeFromTask({ projectRoot: root, goalId: 'G1', taskId: 'T1', changeName: 'G1-T1' });

    // 模拟「另一个人改了 canonical spec」：归档前的基线校验必须拦住。
    const outcome = await runTaskThroughChange({
      projectRoot: root,
      goal: 'G1',
      task: 'T1',
      runner: mockRunner(0, async () => {
        const specPath = path.join(root, 'specs', 'core', 'spec.md');
        await fs.writeFile(specPath, (await fs.readFile(specPath, 'utf8')) + '\n<!-- 并发修改 -->\n');
      }),
    });

    expect(outcome.needsHuman).toBe(true);
    expect(outcome.archived).toBe(false);
    // 卡在归档前的基线冲突：canonical spec 在 change 存续期间被改过，不能静默覆盖（ADR 0004）。
    expect(outcome.verdict).toBe('spec-conflict');
    // 人工出口要写在结论里（日志 / 状态投影 / 界面都显示同一句）。
    expect(outcome.detail).toContain('reconciliation');
  });

  it('验收不过 → 回到 queued 重试，并按上限停机；两次的结论都留在账本里', async () => {
    // 把验收 check 改成恒失败：builder 成功、验收不过——这正是「不能再按退出码判成败」的场景。
    await fs.writeFile(
      path.join(root, 'specs', 'core', 'spec.md'),
      SPEC.replace('node -e "process.exit(0)"', 'node -e "process.exit(1)"'),
    );
    await freezePlan();

    await runDaemonLoop({
      projectRoot: root,
      agentId: 'mock',
      mode: 'always',
      runner: mockRunner(),
      intervalMs: 0,
      maxAttempts: 2,
    });

    const queue = await readQueue(root);
    const task = queue?.tasks.find((entry) => entry.id === 'G1:T1');
    expect(task?.status).toBe('failed');
    expect(task?.attempts).toBe(2);
    expect(task?.verdict).toBe('verify-failed');
    // change 没归档、停在 build，人可以接手；账本里留着验收结论。
    const state = await readChangeState(root, changeNameForTask('G1', 'T1'));
    expect(state.archived).toBe(false);
    expect(state.phase).toBe('build');
    const verification = await fs.readFile(path.join(root, 'changes', 'G1-T1', 'verification.md'), 'utf8');
    expect(verification).toContain('failed');
    // 状态投影里能看到「为什么停」：attempts 用尽 → failed，停机原因是队列跑空。
    const daemon = await readDaemonState(root);
    expect(daemon?.last_task?.verdict).toBe('verify-failed');
  });
});
