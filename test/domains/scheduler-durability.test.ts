import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunner } from '../../platform/agents/types.js';
import { addBudgetUsage, readBudgetUsage } from '../../domains/scheduler/budget.js';
import { markQueueTask, readQueue, reclaimExpiredLeases, writeQueue } from '../../domains/scheduler/queue.js';
import { runDaemonLoop } from '../../domains/scheduler/daemon.js';
import type { SchedulerQueue } from '../../domains/scheduler/queue.js';
import { generateTaskPlan } from '../../domains/task-plan/task-plan-generate.js';
import { freezeTaskPlan } from '../../domains/task-plan/task-plan-freeze.js';
import { writeTaskPlan } from '../../domains/task-plan/task-plan-store.js';

vi.setConfig({ testTimeout: 30_000 });

let tmp: string;

function queueWith(task: Partial<SchedulerQueue['tasks'][number]>): SchedulerQueue {
  return {
    schema: 'cometflow.queue.v1',
    tasks: [
      {
        id: 'T1',
        goal: 'G1',
        task: 'T1',
        title: 'demo',
        status: 'queued',
        attempts: 0,
        updated_at: new Date(0).toISOString(),
        ...task,
      },
    ],
  };
}

function runner(onRun: (timeoutMs: number | undefined) => number, id = 'fake'): AgentRunner {
  return {
    id,
    name: id,
    buildCommand(input) {
      return { command: id, args: [input.prompt], cwd: input.cwd };
    },
    async run(input) {
      return { exitCode: onRun(input.timeoutMs), stdout: '', stderr: '', timedOut: false };
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

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-scheduler-'));
  // P4 之后 daemon 走 change 交付通道：要它真的跑任务，项目里必须有**冻结任务**
  // （change 只能从 frozen task 派生）。这三个用例测的是租约/重试/超时的持久性，
  // 因此这里给一份最小可交付项目：goal G1 → spec/acceptance（check 恒过）→ 冻结计划。
  await fs.mkdir(path.join(tmp, '.cometflow', 'plans'), { recursive: true });
  await fs.writeFile(
    path.join(tmp, '.cometflow', 'config.yaml'),
    'schema: cometflow.project.v1\nplan_review: auto\nagent: fake\nverification:\n  mode: checks\n',
  );
  await fs.writeFile(
    path.join(tmp, 'COMETFLOW.md'),
    ['# 项目使命', '', '## 任务目标', '', '### G1：核心能力', '- 目标：实现 core', '- 范围：core', ''].join('\n'),
  );
  await fs.mkdir(path.join(tmp, 'specs', 'core'), { recursive: true });
  await fs.writeFile(
    path.join(tmp, 'specs', 'core', 'spec.md'),
    [
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
    ].join('\n'),
  );
  await writeTaskPlan(tmp, await freezeTaskPlan(tmp, await generateTaskPlan(tmp, 'G1')));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('lease reclaim', () => {
  it('requeues an expired running task and counts the attempt', () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    const result = reclaimExpiredLeases(
      queueWith({ status: 'running', attempts: 1, lease_until: expired, owner: 'pid@host' }),
      { maxAttempts: 3 },
    );
    expect(result.reclaimed.map((task) => task.id)).toEqual(['T1']);
    expect(result.queue.tasks[0].status).toBe('queued');
    // attempts 只统计「启动过几次」，回收不额外计数（否则一次崩溃会算两次）。
    expect(result.queue.tasks[0].attempts).toBe(1);
    expect(result.queue.tasks[0].lease_until).toBeNull();
  });

  it('gives up instead of retrying forever once the attempt limit is reached', () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    const result = reclaimExpiredLeases(
      queueWith({ status: 'running', attempts: 3, lease_until: expired }),
      { maxAttempts: 3 },
    );
    expect(result.exhausted.map((task) => task.id)).toEqual(['T1']);
    expect(result.queue.tasks[0].status).toBe('failed');
  });

  it('leaves a task alone while its lease is still valid', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = reclaimExpiredLeases(queueWith({ status: 'running', attempts: 1, lease_until: future }));
    expect(result.reclaimed).toHaveLength(0);
    expect(result.queue.tasks[0].status).toBe('running');
  });
});

describe('budget persistence', () => {
  it('accumulates usage across restarts', async () => {
    expect((await readBudgetUsage(tmp)).used_ms).toBe(0);
    await addBudgetUsage(tmp, 1_000);
    await addBudgetUsage(tmp, 2_500);
    expect((await readBudgetUsage(tmp)).used_ms).toBe(3_500);
  });
});

describe('daemon loop', () => {
  it('passes the task timeout to the runner and records budget usage', async () => {
    await writeQueue(tmp, queueWith({}));
    const seen: (number | undefined)[] = [];
    await runDaemonLoop({
      projectRoot: tmp,
      agentId: 'fake',
      mode: 'always',
      intervalMs: 1,
      taskTimeoutMs: 1_234,
      runner: runner((timeoutMs) => {
        seen.push(timeoutMs);
        return 0;
      }),
    });

    expect(seen).toEqual([1_234]);
    expect((await readQueue(tmp))?.tasks[0].status).toBe('done');
    expect((await readBudgetUsage(tmp)).used_ms).toBeGreaterThanOrEqual(0);
  });

  it('reclaims a crashed task on startup instead of leaving it stuck', async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    const crashed = markQueueTask(queueWith({}), 'T1', 'running');
    crashed.tasks[0].lease_until = expired;
    await writeQueue(tmp, crashed);

    let runs = 0;
    await runDaemonLoop({
      projectRoot: tmp,
      agentId: 'fake',
      mode: 'always',
      intervalMs: 1,
      maxAttempts: 3,
      runner: runner(() => {
        runs += 1;
        return 0;
      }),
    });

    expect(runs).toBe(1);
    const queue = await readQueue(tmp);
    expect(queue?.tasks[0].status).toBe('done');
    // 崩溃的那次算一次尝试，回收后 +1，执行成功后不再累加。
    expect(queue?.tasks[0].attempts).toBe(2);
  });

  it('stops retrying a task that keeps failing', async () => {
    await writeQueue(tmp, queueWith({}));
    let runs = 0;
    await runDaemonLoop({
      projectRoot: tmp,
      agentId: 'fake',
      mode: 'always',
      intervalMs: 1,
      maxAttempts: 2,
      runner: runner(() => {
        runs += 1;
        return 1;
      }),
    });
    expect(runs).toBe(2);
    expect((await readQueue(tmp))?.tasks[0].status).toBe('failed');
  });
});
