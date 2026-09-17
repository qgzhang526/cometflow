import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDaemonLoop } from '../../domains/scheduler/daemon.js';
import { changeNameForTask } from '../../domains/scheduler/daemon-run-change.js';
import { runChange } from '../../domains/workflow/change-execution.js';
import { createChangeFromTask } from '../../domains/workflow/change-create.js';
import { applyChangeTransition } from '../../domains/workflow/change-transitions.js';
import { commitTransition, readChangeState } from '../../domains/workflow/change-store.js';
import { acquireLock } from '../../platform/fs/file-lock.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import type { AgentRunner } from '../../platform/agents/types.js';

/**
 * 并发（C1）：两个 daemon 实例、或「daemon + 人手工 change」同时推进时，
 * 交付语义不能被破坏——同一条任务只跑一次，同一个 change 只有一个执行者。
 */

let root: string;

function countingRunner(counter: { runs: number }, delayMs = 60, exitCode = 0): AgentRunner {
  return {
    id: 'mock',
    name: 'mock',
    buildCommand: (input) => ({ command: 'mock', args: [input.prompt], cwd: input.cwd }),
    run: async () => {
      counter.runs += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { exitCode, stdout: '', stderr: '', timedOut: false };
    },
    check: async () => true,
    subagentTool: () => 'task',
    configTemplate: () => 'none',
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-concurrency-'));
  await fs.mkdir(path.join(root, '.cometflow', 'plans'), { recursive: true });
  await fs.writeFile(path.join(root, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\nplan_review: auto\nagent: mock\n');
  await fs.writeFile(path.join(root, 'COMETFLOW.md'), ['# 项目使命', '', '## 任务目标', '', '### G1：核心', '- 范围：core', ''].join('\n'));
  await fs.mkdir(path.join(root, 'specs', 'core'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'specs', 'core', 'spec.md'),
    ['---', 'capability: core', 'module: src/core', '---', '', '# core', '', '## CORE-001 add', '', '需求。', '', '## Acceptance', '', '- A1：可用', '  - check: node -e "process.exit(0)"', ''].join('\n'),
  );
  await writeTaskPlan(root, await freezeTaskPlan(root, await generateTaskPlan(root, 'G1')));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('调度并发（C1）', () => {
  it('两个 daemon 实例同时跑：同一条任务只执行一次', async () => {
    const counter = { runs: 0 };
    // 同一个项目、同一份队列，两个循环同时开跑。
    await Promise.all([
      runDaemonLoop({ projectRoot: root, agentId: 'mock', mode: 'always', runner: countingRunner(counter), intervalMs: 5 }),
      runDaemonLoop({ projectRoot: root, agentId: 'mock', mode: 'always', runner: countingRunner(counter), intervalMs: 5 }),
    ]);

    // 领取在锁内完成 + 已交付即跳过 → builder 只该被叫起来一次。
    expect(counter.runs).toBe(1);
    const state = await readChangeState(root, changeNameForTask('G1', 'T1'));
    expect(state.archived).toBe(true);
  }, 30000);

  it('change 级互斥：锁被另一个人拿着时，runChange 直接失败并说明持有者', async () => {
    const created = await createChangeFromTask({ projectRoot: root, goalId: 'G1', taskId: 'T1', changeName: 'G1-T1' });
    // runChange 要求 build 阶段：先走 confirm-acceptance。
    const build = applyChangeTransition(created, 'confirm-acceptance');
    await commitTransition(root, 'confirm-acceptance', created, build);
    // 手工持有的锁与 runChange 内部一致（含 scope）：模拟「另一个驱动者正在跑同一个 change」。
    const holding = await acquireLock(root, 'change run G1-T1', { scope: 'change-run-G1-T1' });
    try {
      await expect(runChange(root, 'G1-T1', countingRunner({ runs: 0 }, 0))).rejects.toThrow(/另一个进程正在执行/u);
    } finally {
      await holding.release();
    }
    // 释放后同一 change 又能被驱动——锁不是永久挡板。
    const outcome = await runChange(root, 'G1-T1', countingRunner({ runs: 0 }, 0));
    expect(outcome.state.phase).toBe('verify');
  }, 30000);
});
