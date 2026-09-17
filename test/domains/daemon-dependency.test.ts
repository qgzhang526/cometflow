import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextQueuedTask } from '../../domains/scheduler/queue.js';
import { mergeTodoView } from '../../domains/scheduler/daemon-todo.js';
import { checkConcurrencyGate } from '../../domains/scheduler/daemon-concurrency.js';
import { installHook } from '../../domains/guard/hook-install.js';

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

  /**
   * ADR 0028（第三轮修订）：装了守卫**不再拒绝并发**——spec 没声明 module 只是让那些任务退化成
   * 串行（归属不可判），而不是让整个项目失去并发。这里钉的是"准入的形态"：单元从 spec_ref
   * 换成 module，并把会串行的任务点名说出来。
   */
  it('装了写保护守卫且 spec 没声明 module：并发仍开，但点明这些任务只能串行', async () => {
    // 真装一次守卫（claude-code），让准入检查面对真实证据而不是桩。
    await installHook(root, 'claude-code');

    const gate = await checkConcurrencyGate(root, 2);
    expect(gate.unit).toBe('module');
    // 说明里必须点出：这些任务没声明 module，所以会串行（而不是笼统的"不支持"）。
    expect(gate.reason).toContain('没声明 module');
    expect(gate.reason).toContain('G1:T1');
  });

  it('没装守卫：并发单元仍是 capability spec（不额外牺牲吞吐）', async () => {
    const gate = await checkConcurrencyGate(root, 2);
    expect(gate.unit).toBe('spec-ref');
  });
});
