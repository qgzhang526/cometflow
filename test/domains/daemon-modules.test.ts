import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDaemonLoop } from '../../domains/scheduler/daemon.js';
import { modulesConflict, nextClaimableTask } from '../../domains/scheduler/daemon-concurrency.js';
import type { QueueTask } from '../../domains/scheduler/queue.js';
import type { AgentRunner } from '../../platform/agents/types.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { installHook } from '../../domains/guard/hook-install.js';
import { readDaemonState } from '../../domains/scheduler/daemon-state.js';

/**
 * 模块级并发排除（ADR 0028 第三轮修订）。
 *
 * 装了写保护守卫时，并发单元从 `spec_ref` 换成 **module 归属**：守卫按 module 判写入归属，
 * module 相等（都写 src/api）、互相包含（src vs src/api）或未声明时，路径归属是歧义的，
 * 那几条任务必须串行。
 *
 * 关键差别在于**形态**：串行是"领取时跳过它、先跑别人的"，不是"整个项目不许并发"。
 * 上一轮的做法（有歧义就拒绝 `--concurrency > 1`）代价过大——一个 spec 没写 module，
 * 整个项目就永远只能串行。
 */

let root: string;

function concurrencyProbe(): { runner: AgentRunner; maxInFlight: () => number; runs: () => number } {
  let inFlight = 0;
  let max = 0;
  let runs = 0;
  const runner: AgentRunner = {
    id: 'mock',
    name: 'mock',
    buildCommand: (input) => ({ command: 'mock', args: [input.prompt], cwd: input.cwd }),
    run: async () => {
      inFlight += 1;
      runs += 1;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 300));
      inFlight -= 1;
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    },
    check: async () => true,
    subagentTool: () => 'task',
    configTemplate: () => 'none',
  };
  return { runner, maxInFlight: () => max, runs: () => runs };
}

/** capability → module；`module: null` 表示 spec 不声明 module（归属不可判）。 */
async function writeProject(capabilities: Array<{ name: string; module: string | null }>): Promise<void> {
  await fs.mkdir(path.join(root, '.cometflow', 'plans'), { recursive: true });
  await fs.writeFile(path.join(root, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\nplan_review: auto\nagent: mock\n');
  await fs.writeFile(
    path.join(root, 'COMETFLOW.md'),
    ['# 项目使命', '', '## 任务目标', '', '### G1：核心', '- 目标：把能力做出来', '- 范围：' + capabilities.map((c) => c.name).join(', '), ''].join('\n'),
  );
  for (const capability of capabilities) {
    await fs.mkdir(path.join(root, 'specs', capability.name), { recursive: true });
    const frontmatter = capability.module === null ? ['---', 'capability: ' + capability.name, '---'] : ['---', 'capability: ' + capability.name, 'module: ' + capability.module, '---'];
    await fs.writeFile(
      path.join(root, 'specs', capability.name, 'spec.md'),
      [
        ...frontmatter,
        '',
        '# ' + capability.name,
        '',
        '## ' + capability.name.toUpperCase() + '-001 需求',
        '',
        '需求描述。',
        '',
        '## Acceptance',
        '',
        '- A1：可用',
        '  - check: node -e "process.exit(0)"',
        '',
      ].join('\n'),
    );
  }
  await writeTaskPlan(root, await freezeTaskPlan(root, await generateTaskPlan(root, 'G1')));
}

async function runConcurrent(): Promise<{ max: number; runs: number; reason: string }> {
  const probe = concurrencyProbe();
  const result = await runDaemonLoop({
    projectRoot: root,
    agentId: 'mock',
    mode: 'always',
    runner: probe.runner,
    concurrency: 2,
    intervalMs: 0,
  });
  return { max: probe.maxInFlight(), runs: probe.runs(), reason: result.reason };
}

/** 冒充"人正在某个 module 上干活"的活跃 change：守卫与调度器都按 module 判归属。 */
async function writeActiveChange(name: string, goal: string, task: string, module: string): Promise<void> {
  const dir = path.join(root, 'changes', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'comet-state.yaml'),
    [
      'schema: cometflow.change.v1',
      'name: ' + name,
      'goal: ' + goal,
      'task: ' + task,
      'phase: build',
      'status: active',
      'module: ' + module,
      'archived: false',
      '',
    ].join('\n'),
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-modules-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('modulesConflict：路径归属是否唯一', () => {
  it('相等 / 互相包含 / 未声明都算冲突', () => {
    expect(modulesConflict('src/api', 'src/api')).toBe(true);
    expect(modulesConflict('src', 'src/api')).toBe(true);
    expect(modulesConflict('src/api', 'src')).toBe(true);
    expect(modulesConflict(null, 'src/api')).toBe(true);
    expect(modulesConflict('src/api', null)).toBe(true);
    expect(modulesConflict(null, null)).toBe(true);
  });

  it('互不相交才并行', () => {
    expect(modulesConflict('src/api', 'src/web')).toBe(false);
    // 前缀相同的兄弟目录不是包含关系。
    expect(modulesConflict('src/api', 'src/apix')).toBe(false);
  });
});

describe('nextClaimableTask：跳过被占用的候选', () => {
  const task = (id: string, module: string | null, specRef: string): QueueTask => ({
    id: 'G1:' + id,
    goal: 'G1',
    task: id,
    title: id,
    status: 'queued',
    attempts: 0,
    updated_at: new Date().toISOString(),
    blocked_by: [],
    spec_ref: specRef,
    module,
  });

  const context = (occupied: Array<{ change: string; module: string | null }>) => ({
    activeUnits: new Set<string>(),
    occupied,
    moduleOf: (entry: QueueTask) => entry.module ?? null,
    changeOf: (entry: QueueTask) => 'G1-' + entry.task,
  });

  it('占着的是候选人自己的 change：不算冲突（那是续作自己的活）', () => {
    const tasks = [task('T1', 'src/api', 'specs/api/spec.md'), task('T2', 'src/web', 'specs/web/spec.md')];
    const selection = nextClaimableTask(tasks, context([{ change: 'G1-T1', module: 'src/api' }]));
    expect(selection.kind).toBe('claimable');
    if (selection.kind !== 'claimable') throw new Error('unreachable');
    expect(selection.task.task).toBe('T1');
  });

  it('第一条的 module 被别人占着：跳过它、先领后面那条（不是原地卡住）', () => {
    const tasks = [task('T1', 'src/api', 'specs/api/spec.md'), task('T2', 'src/web', 'specs/web/spec.md')];
    const blocked = nextClaimableTask(tasks, context([{ change: 'human-api', module: 'src/api' }]));
    expect(blocked.kind).toBe('claimable');
    if (blocked.kind !== 'claimable') throw new Error('unreachable');
    expect(blocked.task.task).toBe('T2');
  });

  it('全被占：返回 waiting 并点名占用者', () => {
    const tasks = [task('T1', 'src/api', 'specs/api/spec.md')];
    const selection = nextClaimableTask(tasks, context([{ change: 'human-api', module: 'src/api' }]));
    expect(selection.kind).toBe('waiting');
    if (selection.kind !== 'waiting') throw new Error('unreachable');
    expect(selection.skipped[0]?.reason).toBe('module-conflict');
    expect(selection.skipped[0]?.occupier?.change).toBe('human-api');
  });
});

describe('装在飞 change 的 module 与守卫下的并发（端到端）', () => {
  it('module 互相包含：串行（观测到 1），两条都交付', async () => {
    await writeProject([
      { name: 'core', module: 'src/core' },
      { name: 'deep', module: 'src/core/deep' },
    ]);
    await installHook(root, 'claude-code');

    const result = await runConcurrent();
    expect(result.runs).toBe(2);
    expect(result.max).toBe(1);
    expect(result.reason).toBe('no-queued-task');
  }, 60000);

  it('module 相同（两个 capability 都写 src/shared）：串行，两条都交付', async () => {
    await writeProject([
      { name: 'alpha', module: 'src/shared' },
      { name: 'beta', module: 'src/shared' },
    ]);
    await installHook(root, 'claude-code');

    const result = await runConcurrent();
    expect(result.runs).toBe(2);
    expect(result.max).toBe(1);
  }, 60000);

  it('spec 没声明 module：串行（归属不可判，按最坏情况独占）', async () => {
    await writeProject([
      { name: 'alpha', module: null },
      { name: 'beta', module: null },
    ]);
    await installHook(root, 'claude-code');

    const result = await runConcurrent();
    expect(result.runs).toBe(2);
    expect(result.max).toBe(1);
  }, 60000);

  it('module 互不相交：仍然并行（观测到 2）', async () => {
    await writeProject([
      { name: 'alpha', module: 'src/alpha' },
      { name: 'beta', module: 'src/beta' },
    ]);
    await installHook(root, 'claude-code');

    const result = await runConcurrent();
    expect(result.max).toBe(2);
  }, 60000);

  it('没装守卫：module 是否嵌套都不做排除（并发单元是 spec_ref）', async () => {
    await writeProject([
      { name: 'core', module: 'src/core' },
      { name: 'deep', module: 'src/core/deep' },
    ]);

    const result = await runConcurrent();
    expect(result.max).toBe(2);
  }, 60000);

  /**
   * 「为什么这条没被领」必须能在面板上问出答案：module 被**人手工开的** change 占着时，
   * 停止原因是 `waiting-on-active-change`，状态投影里写明在等谁——过去这条只出现在 stdout。
   */
  it('module 被在飞 change 占着：停机原因点名，状态投影写明在等谁', async () => {
    await writeProject([{ name: 'core', module: 'src/core' }]);
    await installHook(root, 'claude-code');
    // 冒充"人正在这个 module 上干活"：归属有歧义，调度器必须让开。
    // 注意不能复用 G1:T1：那种情况会被判成"别人正在做同一条任务"（in-flight），
    // 属于另一条规则（不做重复劳动），不是这里要验的 module 归属。
    await writeActiveChange('human-core', 'G7', 'T7', 'src/core');

    const probe = concurrencyProbe();
    const result = await runDaemonLoop({
      projectRoot: root,
      agentId: 'mock',
      mode: 'always',
      runner: probe.runner,
      concurrency: 2,
      intervalMs: 0,
    });

    expect(result.reason).toBe('waiting-on-active-change');
    expect(probe.runs()).toBe(0);
    const state = await readDaemonState(root);
    expect(state?.stopped_reason).toBe('waiting-on-active-change');
    expect(state?.last_skips?.length).toBe(1);
    expect(state?.last_skips?.[0]?.task).toBe('G1:T1');
    expect(state?.last_skips?.[0]?.reason).toBe('module-conflict');
    expect(state?.last_skips?.[0]?.holder).toBe('human-core');
    expect(state?.last_skips?.[0]?.occupier_module).toBe('src/core');
  }, 60000);
});
