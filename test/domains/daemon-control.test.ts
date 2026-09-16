import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DAEMON_CONTROL_SCHEMA,
  clearDaemonControl,
  daemonControlPath,
  readDaemonControl,
  writeDaemonControl,
} from '../../domains/scheduler/daemon-control.js';
import { readDaemonState } from '../../domains/scheduler/daemon-state.js';
import { runDaemonLoop } from '../../domains/scheduler/daemon.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import type { AgentRunner } from '../../platform/agents/types.js';

/**
 * P4 / S4：daemon 的控制语义。
 *
 * 决策（ADR 0026）：**进程由 CLI 持有，控制走文件**。界面/脚本能暂停与停止，
 * 但不会让 serve 变成进程主人——所以这里测的是「循环有没有听指令」，不是「谁 spawn 了谁」。
 */

let root: string;

function runner(): AgentRunner {
  return {
    id: 'mock',
    name: 'mock',
    buildCommand: (input) => ({ command: 'mock', args: [input.prompt], cwd: input.cwd }),
    run: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    check: async () => true,
    subagentTool: () => 'task',
    configTemplate: () => 'none',
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-daemon-control-'));
  await fs.mkdir(path.join(root, '.cometflow', 'plans'), { recursive: true });
  await fs.writeFile(path.join(root, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\nplan_review: auto\n');
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

describe('daemon 控制（S4）', () => {
  it('读写控制文件；坏文件按「没有指令」处理；一次性动作可回落 idle', async () => {
    expect(await readDaemonControl(root)).toBeNull();

    const written = await writeDaemonControl(root, 'pause', { by: 'test' });
    expect(written.action).toBe('pause');
    expect((await readDaemonControl(root))?.requested_by).toBe('test');

    await clearDaemonControl(root);
    expect((await readDaemonControl(root))?.action).toBe('idle');

    await fs.writeFile(daemonControlPath(root), '{ 不是 JSON');
    expect(await readDaemonControl(root)).toBeNull();
    void DAEMON_CONTROL_SCHEMA;
  });

  it('stop：循环在下一轮退出，不启动任何任务，并把指令消费掉', async () => {
    await writeDaemonControl(root, 'stop', { by: 'web' });

    await runDaemonLoop({ projectRoot: root, agentId: 'mock', mode: 'always', runner: runner(), intervalMs: 1 });

    // 一条任务都没跑：连 change 目录都不该出现。
    expect(await fs.access(path.join(root, 'changes', 'G1-T1')).then(() => true, () => false)).toBe(false);
    const daemon = await readDaemonState(root);
    expect(daemon?.stopped_reason).toBe('stopped-by-control');
    // 一次性动作消费掉，否则下一次 start 会立刻又停。
    expect((await readDaemonControl(root))?.action).toBe('idle');
  });

  it('pause：循环只跳过不退出，任务保持待办', async () => {
    await writeDaemonControl(root, 'pause', { by: 'web' });

    // 预算要给够：它是从 Budget 构造时开始计的，而构造点在启动快照之前
    // （全量测试并行跑时，快照/git 那几步可能吃掉几百毫秒）。1.5s + 每轮 50ms
    // 保证循环至少进过一次 pause 分支，又能自己退出，不挂住测试。
    await runDaemonLoop({
      projectRoot: root,
      agentId: 'mock',
      mode: 'always',
      runner: runner(),
      intervalMs: 50,
      budgetMs: 1500,
    });

    expect(await fs.access(path.join(root, 'changes', 'G1-T1')).then(() => true, () => false)).toBe(false);
    expect((await readDaemonState(root))?.last_decision?.reason).toBe('paused-by-control');
    // 暂停是持续的：指令不会被消费掉，直到有人 resume / stop。
    expect((await readDaemonControl(root))?.action).toBe('pause');
  });
});
