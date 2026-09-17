import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextQueuedTask } from '../../domains/scheduler/queue.js';
import { mergeTodoView } from '../../domains/scheduler/daemon-todo.js';
import { runDaemonLoop } from '../../domains/scheduler/daemon.js';
import type { AgentRunner } from '../../platform/agents/types.js';

/**
 * 依赖排序（C2）：`depends_on` 里的任务**已交付**（有归档 change）才轮到它。
 *
 * 之前 `depends_on` 只被 `plan validate` 用来查环，调度器完全没读——于是"没交付就开跑"这种
 * 顺序错误不会被拦。现在它是调度准入的一部分，并且"为什么还没轮到"直接显示在队列行上。
 */

let root: string;

async function writePlan(tasks: Array<{ id: string; depends_on?: string[] }>): Promise<void> {
  const dir = path.join(root, '.cometflow', 'plans');
  await fs.mkdir(dir, { recursive: true });
  const lines = ['schema: cometflow.task-plan.v1', 'goal: G1', 'status: frozen', 'tasks:'];
  for (const task of tasks) {
    lines.push(
      '  - id: ' + task.id,
      '    title: ' + task.id + ' 的实现',
      '    kind: implementation',
      '    capability: core',
      '    spec_ref: specs/core/spec.md',
      '    spec_anchor: CORE-001 add',
      '    acceptance_ids: []',
      '    spec_version: null',
      '    spec_hash: null',
      '    depends_on: [' + (task.depends_on ?? []).join(', ') + ']',
      '    definition_of_done:',
      '      - 所有 acceptance 通过',
      '    status: frozen',
    );
  }
  await fs.writeFile(path.join(dir, 'G1.task-plan.yaml'), lines.join('\n') + '\n');
}

async function archiveChange(name: string, task: string): Promise<void> {
  const dir = path.join(root, 'changes', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'comet-state.yaml'),
    ['schema: cometflow.change.v1', 'name: ' + name, 'goal: G1', 'task: ' + task, 'phase: archive', 'status: done', 'archived: true', ''].join('\n'),
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-dependency-'));
  await writePlan([{ id: 'T1' }, { id: 'T2', depends_on: ['T1'] }, { id: 'T3', depends_on: ['T2'] }]);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('依赖排序（C2）', () => {
  it('前序没交付：任务进制待办但标出「在等谁」，且不会被选中', async () => {
    const view = await mergeTodoView(root);
    const t2 = view.tasks.find((task) => task.task === 'T2');
    expect(t2?.status).toBe('queued');
    expect(t2?.blocked_by).toEqual(['T1']);
    expect(view.tasks.find((task) => task.task === 'T3')?.blocked_by).toEqual(['T2']);
    expect(view.tasks.find((task) => task.task === 'T1')?.blocked_by).toEqual([]);

    // 调度器只会挑依赖已满足的那条。
    const next = nextQueuedTask({ schema: 'cometflow.queue.v1', tasks: view.tasks });
    expect(next?.task).toBe('T1');
  });

  it('前序交付后，后一条自然变成可调度', async () => {
    await archiveChange('G1-T1', 'T1');
    const view = await mergeTodoView(root);
    expect(view.tasks.find((task) => task.task === 'T2')?.blocked_by).toEqual([]);
    // T3 仍然在等 T2：依赖是链式的。
    expect(view.tasks.find((task) => task.task === 'T3')?.blocked_by).toEqual(['T2']);

    const next = nextQueuedTask({ schema: 'cometflow.queue.v1', tasks: view.tasks });
    expect(next?.task).toBe('T2');
  });

  it('链式依赖全部交付后，队列被排空', async () => {
    await archiveChange('G1-T1', 'T1');
    await archiveChange('G1-T2', 'T2');
    await archiveChange('G1-T3', 'T3');
    const view = await mergeTodoView(root);
    expect(view.tasks.every((task) => task.delivered)).toBe(true);
    expect(nextQueuedTask({ schema: 'cometflow.queue.v1', tasks: view.tasks })).toBeNull();
  });

  // ADR 0028：并发槽位 >1 一律拒绝并说明原因（不静默降级），因为写保护守卫按指针 fail-closed。
  it('concurrency > 1 被拒绝，并说明怎么才能开', async () => {
    const lines: string[] = [];
    const runner: AgentRunner = {
      id: 'mock',
      name: 'mock',
      buildCommand: (input) => ({ command: 'mock', args: [input.prompt], cwd: input.cwd }),
      run: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
      check: async () => true,
      subagentTool: () => 'task',
      configTemplate: () => 'none',
    };
    const result = await runDaemonLoop({
      projectRoot: root,
      agentId: 'mock',
      mode: 'always',
      runner,
      concurrency: 2,
      log: (line) => lines.push(line),
    });
    expect(result.reason).toBe('concurrency-not-open');
    expect(lines.join('\n')).toContain('hook uninstall');
  });
});
