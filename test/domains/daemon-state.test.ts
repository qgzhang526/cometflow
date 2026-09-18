import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DAEMON_STATE_SCHEMA,
  countQueue,
  daemonStatePath,
  readDaemonState,
  writeDaemonState,
} from '../../domains/scheduler/daemon-state.js';
import { runDaemonLoop } from '../../domains/scheduler/daemon.js';
import type { AgentRunner } from '../../platform/agents/types.js';
import type { SchedulerQueue } from '../../domains/scheduler/queue.js';

/**
 * 调度器状态投影（审计 C5）。
 *
 * 在它之前，daemon 除了往 stdout 打日志什么都不留：界面答不出
 * 「无人值守到底有没有在工作」。这里钉住两件事——投影本身可读可写，
 * 以及 daemon 主循环真的在决策点写它。
 */

let root: string;

function mockRunner(): AgentRunner {
  return {
    id: 'mock',
    name: 'mock',
    buildCommand: (input) => ({ command: 'mock', args: [input.prompt], cwd: input.cwd }),
    run: async () => ({ exitCode: 0, stdout: 'mock ok', stderr: '', timedOut: false }),
    check: async () => true,
    subagentTool: () => 'task',
    configTemplate: () => 'none',
  };
}

const EMPTY_QUEUE: SchedulerQueue = { schema: 'cometflow.queue.v1', tasks: [] };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-daemon-state-'));
  await fs.mkdir(path.join(root, '.cometflow', 'plans'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('daemon state projection', () => {
  it('writes and reads the projection, and treats a broken file as「没跑过」', async () => {
    expect(await readDaemonState(root)).toBeNull();

    await writeDaemonState(root, {
      pid: 1234,
      mode: 'always',
      agent: 'mock',
      iteration: 2,
      phase: 'ran',
      stopped_reason: null,
      last_decision: { ran: true, reason: 'task-done', task: 'G1:T1' },
      last_task: { id: 'G1:T1', result: 'done', elapsedMs: 1200, timedOut: false },
      last_skips: [],
      queue: { queued: 1, running: 0, done: 1, failed: 0 },
      budget: { used_ms: 1200, total_ms: 60_000, remaining_ms: 58_800 },
    });

    const state = await readDaemonState(root);
    expect(state?.schema).toBe(DAEMON_STATE_SCHEMA);
    expect(state?.iteration).toBe(2);
    expect(state?.last_decision?.task).toBe('G1:T1');
    expect(state?.last_task?.result).toBe('done');
    expect(state?.queue.done).toBe(1);
    // 时间戳由写入方盖章，读回来必须是可解析的 ISO。
    expect(Number.isNaN(new Date(state?.updated_at ?? '').getTime())).toBe(false);

    await fs.writeFile(daemonStatePath(root), '{ 这不是 JSON');
    expect(await readDaemonState(root)).toBeNull();
  });

  it('counts queue states', () => {
    const counts = countQueue({
      schema: 'cometflow.queue.v1',
      tasks: [
        { id: 'a', goal: 'G1', task: 'T1', title: 't', status: 'queued', attempts: 0, updated_at: '2026-01-01T00:00:00.000Z' },
        { id: 'b', goal: 'G1', task: 'T2', title: 't', status: 'running', attempts: 1, updated_at: '2026-01-01T00:00:00.000Z' },
        { id: 'c', goal: 'G1', task: 'T3', title: 't', status: 'done', attempts: 1, updated_at: '2026-01-01T00:00:00.000Z' },
        { id: 'd', goal: 'G1', task: 'T4', title: 't', status: 'failed', attempts: 3, updated_at: '2026-01-01T00:00:00.000Z' },
      ],
    });
    expect(counts).toEqual({ queued: 1, running: 1, done: 1, failed: 1 });
  });

  it('daemon 主循环在「没有待办」这个决策点写下状态', async () => {
    // 没有 plans → 推导队列为空 → 主循环第一轮就判定 no-queued-task 并退出。
    const result = await runDaemonLoop({ projectRoot: root, agentId: 'mock', mode: 'always', runner: mockRunner(), intervalMs: 0 });

    const state = await readDaemonState(root);
    expect(state).not.toBeNull();
    expect(state?.phase).toBe('stopped');
    expect(state?.stopped_reason).toBe('no-queued-task');
    expect(state?.last_decision).toEqual({ ran: false, reason: 'no-queued-task', task: null });
    expect(result.reason).toBe('no-queued-task');
    expect(state?.mode).toBe('always');
    expect(state?.agent).toBe('mock');
    expect(state?.queue).toEqual({ queued: 0, running: 0, done: 0, failed: 0 });
    expect(EMPTY_QUEUE.tasks.length).toBe(0);
  });

  it('manual 模式只做一次准备动作就结束，不进循环', async () => {
    // 旧实现在没有预算时会无限空转；内嵌进 serve 就是一个永不结束的 job，所以显式收口。
    const result = await runDaemonLoop({ projectRoot: root, agentId: 'mock', mode: 'manual', runner: mockRunner() });
    expect(result.reason).toBe('manual-single-pass');
    expect(result.iterations).toBe(0);
    expect((await readDaemonState(root))?.stopped_reason).toBe('manual-single-pass');
  });
});
