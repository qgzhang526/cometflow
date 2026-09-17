import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDaemonLoop } from '../../domains/scheduler/daemon.js';
import type { AgentRunner } from '../../platform/agents/types.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';
import { installHook } from '../../domains/guard/hook-install.js';

/**
 * C3 执行部分：并发槽位（ADR 0028）。
 *
 * 两条硬约束在这里被钉住：
 * 1. **并发单元是 capability spec**：同一 `spec_ref` 的任务永不并行（并行改同一块契约/模块是必然冲突）；
 * 2. **没装写保护守卫才开放**（守卫那条在 daemon-dependency 里测）。
 */

let root: string;

/** 记录「同时有多少个 agent 在跑」的注入式 runner：并发度只能靠它测出来。 */
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
      // 300ms 是"重叠窗口"：领取两次之间的耗时（读计划 + 锁 + 写队列）在全量测试并行跑时
      // 可能到几十毫秒，窗口太窄会把"没重叠"误报成"并发没生效"。
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

/**
 * 手写计划 + capability spec：两个 capability 各两个 anchor，验收都用恒过的 check，
 * 于是"交付"这条路能走通，剩下的变量只有并发本身。
 */
async function writeProject(capabilities: Array<{ name: string; anchors: number }>): Promise<void> {
  await fs.mkdir(path.join(root, '.cometflow', 'plans'), { recursive: true });
  await fs.writeFile(path.join(root, '.cometflow', 'config.yaml'), 'schema: cometflow.project.v1\nplan_review: auto\nagent: mock\n');
  await fs.writeFile(
    path.join(root, 'COMETFLOW.md'),
    ['# 项目使命', '', '## 任务目标', '', '### G1：核心', '- 目标：把能力做出来', '- 范围：' + capabilities.map((c) => c.name).join(', '), ''].join('\n'),
  );
  for (const capability of capabilities) {
    await fs.mkdir(path.join(root, 'specs', capability.name), { recursive: true });
    const sections: string[] = [];
    for (let index = 1; index <= capability.anchors; index += 1) {
      sections.push(
        '## ' + capability.name.toUpperCase() + '-00' + index + ' 需求',
        '',
        '需求描述。',
        '',
        '## Acceptance',
        '',
        '- A1：可用',
        '  - check: node -e "process.exit(0)"',
        '',
      );
    }
    await fs.writeFile(
      path.join(root, 'specs', capability.name, 'spec.md'),
      ['---', 'capability: ' + capability.name, 'module: src/' + capability.name, '---', '', '# ' + capability.name, '', ...sections].join('\n'),
    );
  }
  // 走真实流程（generate + freeze）：acceptance_ids 由 freeze 填上——
  // 手写计划的那套在 daemon-dependency 里够用，但驱动 change 需要真实冻结的 acceptance。
  await writeTaskPlan(root, await freezeTaskPlan(root, await generateTaskPlan(root, 'G1')));
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-slots-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('并发槽位（C3 执行部分）', () => {
  it('concurrency=2 且两个 capability 的任务：真的并行（观测到 2）', async () => {
    await writeProject([{ name: 'core', anchors: 1 }, { name: 'cli', anchors: 1 }]);
    const probe = concurrencyProbe();

    const result = await runDaemonLoop({
      projectRoot: root,
      agentId: 'mock',
      mode: 'always',
      runner: probe.runner,
      concurrency: 2,
      intervalMs: 0,
    });

    expect(probe.runs()).toBe(2);
    expect(probe.maxInFlight()).toBe(2);
    expect(result.reason).toBe('no-queued-task');
  }, 60000);

  it('同一 spec_ref 的两个任务：串行（观测到 1）', async () => {
    // 一个 capability 两个 anchor → 两条任务都指向 specs/core/spec.md：
    // 同一 capability，两个槽也不能同时跑。
    await writeProject([{ name: 'core', anchors: 2 }]);

    const probe = concurrencyProbe();
    await runDaemonLoop({
      projectRoot: root,
      agentId: 'mock',
      mode: 'always',
      runner: probe.runner,
      concurrency: 2,
      intervalMs: 0,
    });

    expect(probe.runs()).toBe(2);
    // 两条都在同一 spec_ref 上：并发单元去重把它们排成串行。
    expect(probe.maxInFlight()).toBe(1);
  }, 60000);

  // ADR 0028 的守卫扩容：装了守卫也能并发——前提是 module 声明齐全且两两不相交
  // （守卫先按 module 判归属，路径归属无歧义就不需要 current-change 指针）。
  it('装了写保护守卫、且 module 两两不相交：仍然可以并发', async () => {
    await writeProject([{ name: 'core', anchors: 1 }, { name: 'cli', anchors: 1 }]);
    await installHook(root, 'claude-code');
    const probe = concurrencyProbe();

    const result = await runDaemonLoop({
      projectRoot: root,
      agentId: 'mock',
      mode: 'always',
      runner: probe.runner,
      concurrency: 2,
      intervalMs: 0,
    });

    expect(probe.runs()).toBe(2);
    expect(probe.maxInFlight()).toBe(2);
    expect(result.reason).toBe('no-queued-task');
  }, 60000);
});
