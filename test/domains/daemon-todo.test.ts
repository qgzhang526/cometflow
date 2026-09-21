import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeTodoView, rebuildQueue, resetQueue, retryQueueTask } from '../../domains/scheduler/daemon-todo.js';
import { readQueue, writeQueue } from '../../domains/scheduler/queue.js';
import type { QueueTask } from '../../domains/scheduler/queue.js';

/**
 * P4 / S3：待办清单的推导规则。
 *
 * 在它之前，`queue.json` 是事实源：跑过的任务永不重跑（除非手删文件），
 * 而「做完没有」由三本账各答一遍。这里钉住新的优先级：
 * **change 账本（交付） > 运行时覆盖（跑过/失败/在跑） > 计划推导（待办）**。
 */

let root: string;

/** 手写计划：推导只看 `status: frozen|approved` 的任务，不需要跑一遍 freeze 流程。 */
async function writePlan(goal: string, tasks: Array<{ id: string; status: string }>): Promise<void> {
  const dir = path.join(root, '.cometflow', 'plans');
  await fs.mkdir(dir, { recursive: true });
  const lines = ['schema: cometflow.task-plan.v1', 'goal: ' + goal, 'status: frozen', 'tasks:'];
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
      '    depends_on: []',
      '    definition_of_done:',
      '      - 所有 acceptance 通过',
      '    status: ' + task.status,
    );
  }
  await fs.writeFile(path.join(dir, goal + '.task-plan.yaml'), lines.join('\n') + '\n');
}

/** 手写 change 账本：唯一被读的字段是 goal / task / archived / name。 */
async function writeArchivedChange(name: string, goal: string, task: string): Promise<void> {
  const dir = path.join(root, 'changes', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'comet-state.yaml'),
    ['schema: cometflow.change.v1', 'name: ' + name, 'goal: ' + goal, 'task: ' + task, 'phase: archive', 'status: done', 'archived: true', ''].join('\n'),
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-daemon-todo-'));
  await writePlan('G1', [
    { id: 'T1', status: 'frozen' },
    { id: 'T2', status: 'frozen' },
    { id: 'T3', status: 'cancelled' },
  ]);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('待办推导（S3）', () => {
  it('只把 frozen/approved 的任务算作待办，cancelled 不进队列', async () => {
    const view = await mergeTodoView(root);
    expect(view.tasks.map((task) => task.goal + ':' + task.task)).toEqual(['G1:T1', 'G1:T2']);
    expect(view.tasks.every((task) => task.status === 'queued')).toBe(true);
    expect(view.tasks.every((task) => task.source === 'derived')).toBe(true);
  });

  it('已有归档 change 的任务被标成「交付过」，不再进待办', async () => {
    await writeArchivedChange('G1-T1', 'G1', 'T1');

    const view = await mergeTodoView(root);
    const t1 = view.tasks.find((task) => task.task === 'T1');
    expect(t1?.status).toBe('done');
    expect(t1?.delivered).toBe(true);
    expect(t1?.change).toBe('G1-T1');
    expect(t1?.verdict).toBe('delivered');
    expect(t1?.source).toBe('delivered');
    // 另一条仍然是待办：交付事实只影响它自己那条。
    expect(view.tasks.find((task) => task.task === 'T2')?.status).toBe('queued');
  });

  it('运行时覆盖优先于推导（在跑的不重复排队），rebuild 保留 legacy done', async () => {
    // 老路径（daemon 直接跑 agent 的时代）留下的记录：任务已不在计划里，但队列里有 done。
    await writeQueue(root, {
      schema: 'cometflow.queue.v1',
      tasks: [
        { id: 'legacy:done', goal: 'legacy', task: 'done', title: '旧交付', status: 'done', attempts: 1, updated_at: new Date(0).toISOString() },
      ],
    });
    // 当前计划里的 T2 正在跑。
    const runningTask: QueueTask = {
      id: 'G1:T2',
      goal: 'G1',
      task: 'T2',
      title: 'T2 的实现',
      status: 'running',
      attempts: 1,
      updated_at: new Date().toISOString(),
      lease_until: new Date(Date.now() + 60_000).toISOString(),
      owner: 'test@host',
    };
    await writeQueue(root, {
      schema: 'cometflow.queue.v1',
      tasks: [...(await readQueue(root))!.tasks, runningTask],
    });

    const view = await mergeTodoView(root);
    expect(view.tasks.find((task) => task.task === 'T2')?.status).toBe('running');
    expect(view.tasks.find((task) => task.task === 'T2')?.source).toBe('overlay');
    expect(view.tasks.find((task) => task.task === 'done')?.status).toBe('done');

    const rebuilt = await rebuildQueue(root);
    // rebuild 之后：legacy done 保留（迁移期不重跑），正在跑的保持 running，剩下的仍是待办。
    expect(rebuilt.tasks.find((task) => task.task === 'done')?.status).toBe('done');
    expect(rebuilt.tasks.find((task) => task.task === 'T2')?.status).toBe('running');
    expect(rebuilt.tasks.find((task) => task.task === 'T1')?.status).toBe('queued');
  });

  it('reset 清掉运行时覆盖：legacy done 重新排队，但已归档 change 的任务仍算已交付', async () => {
    await writeArchivedChange('G1-T1', 'G1', 'T1');
    await writeQueue(root, {
      schema: 'cometflow.queue.v1',
      tasks: [
        { id: 'legacy:done', goal: 'legacy', task: 'done', title: '旧交付', status: 'done', attempts: 1, updated_at: new Date(0).toISOString() },
        { id: 'G1:T2', goal: 'G1', task: 'T2', title: 'T2 的实现', status: 'failed', attempts: 3, updated_at: new Date(0).toISOString() },
      ],
    });

    const view = await resetQueue(root);
    expect(view.tasks.some((task) => task.task === 'done')).toBe(false);
    const t2 = view.tasks.find((task) => task.task === 'T2');
    expect(t2?.status).toBe('queued');
    expect(t2?.attempts).toBe(0);
    expect(view.tasks.find((task) => task.task === 'T1')?.status).toBe('done');
    expect(view.tasks.find((task) => task.task === 'T1')?.delivered).toBe(true);
  });

  it('别的通道正在做的任务：daemon 让开（标在飞），但自己没跑完的 change 继续做', async () => {
    // 人手工建的 change（名字不是 daemon 的确定性命名）→ daemon 不碰 T2。
    const dir = path.join(root, 'changes', 'human-made');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'comet-state.yaml'),
      ['schema: cometflow.change.v1', 'name: human-made', 'goal: G1', 'task: T2', 'phase: build', 'status: active', 'archived: false', ''].join('\n'),
    );

    const view = await mergeTodoView(root);
    const t2 = view.tasks.find((task) => task.task === 'T2');
    expect(t2?.status).toBe('running');
    expect(t2?.verdict).toBe('in-flight');
    expect(t2?.change).toBe('human-made');
    // T1 没有人在做 → 仍是待办。
    expect(view.tasks.find((task) => task.task === 'T1')?.status).toBe('queued');

    // daemon 自己没跑完的（确定性命名 G1-T1）→ 仍是待办，下一轮续作（崩溃恢复语义不变）。
    const own = path.join(root, 'changes', 'G1-T1');
    await fs.mkdir(own, { recursive: true });
    await fs.writeFile(
      path.join(own, 'comet-state.yaml'),
      ['schema: cometflow.change.v1', 'name: G1-T1', 'goal: G1', 'task: T1', 'phase: build', 'status: active', 'archived: false', ''].join('\n'),
    );
    const again = await mergeTodoView(root);
    const t1 = again.tasks.find((task) => task.task === 'T1');
    expect(t1?.status).toBe('queued');
    expect(t1?.change).toBe('G1-T1');
  });

  it('运行时覆盖里的非待办记录只出现一次，且 rebuild 之后仍然稳定', async () => {
    // 回归：队列里已经有一条非 queued 的运行时记录（上一次 merge 落盘的结果）。
    // 它既被「运行时优先」分支推入结果，就不该在末尾再被当成孤儿追加一次。
    // 缺了 overlayById.delete 时，界面上会看到同一条任务出现两行。
    await writeQueue(root, {
      schema: 'cometflow.queue.v1',
      tasks: [
        {
          id: 'G1:T1',
          goal: 'G1',
          task: 'T1',
          title: 'T1 的实现',
          status: 'running',
          attempts: 0,
          updated_at: new Date(0).toISOString(),
        },
      ],
    });

    const merged = await mergeTodoView(root);
    const ids = merged.tasks.map((task) => task.goal + ':' + task.task);
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids.filter((id) => id === 'G1:T1')).toHaveLength(1);
    expect(merged.tasks.find((task) => task.task === 'T1')?.status).toBe('running');
    expect(merged.tasks.find((task) => task.task === 'T2')?.status).toBe('queued');

    // 再合并一次也必须稳定：rebuild 不是幂等的话，队列每刷新一次就多一行。
    const rebuilt = await rebuildQueue(root);
    const rebuiltIds = rebuilt.tasks.map((task) => task.goal + ':' + task.task);
    expect(rebuiltIds).toEqual([...new Set(rebuiltIds)]);
    const again = await mergeTodoView(root);
    const againIds = again.tasks.map((task) => task.goal + ':' + task.task);
    expect(againIds).toEqual([...new Set(againIds)]);
  });

  // 细粒度恢复：daemon 因「需人工介入」停机后，只把修好的那一条放回待办。
  it('retry 只重排指定的一条，其余任务的覆盖与尝试次数不动', async () => {
    await writeQueue(root, {
      schema: 'cometflow.queue.v1',
      tasks: [
        { id: 'G1:T1', goal: 'G1', task: 'T1', title: 'T1 的实现', status: 'failed', attempts: 3, updated_at: new Date(0).toISOString(), verdict: 'spec-conflict' },
        { id: 'G1:T2', goal: 'G1', task: 'T2', title: 'T2 的实现', status: 'failed', attempts: 2, updated_at: new Date(0).toISOString(), verdict: 'verify-failed' },
      ],
    });

    const result = await retryQueueTask(root, 'G1:T1');
    expect(result.retried).toBe(true);
    const t1 = result.view.tasks.find((task) => task.task === 'T1');
    const t2 = result.view.tasks.find((task) => task.task === 'T2');
    expect(t1?.status).toBe('queued');
    expect(t1?.attempts).toBe(0);
    expect(t1?.verdict).toBeNull();
    // 另一条原样：还是 failed / 2 次尝试——这正是 reset 做不到的。
    expect(t2?.status).toBe('failed');
    expect(t2?.attempts).toBe(2);
  });

  it('retry 不重排已交付的任务，也不认不认识的任务', async () => {
    await writeArchivedChange('G1-T1', 'G1', 'T1');
    const delivered = await retryQueueTask(root, 'G1:T1');
    expect(delivered.retried).toBe(false);
    expect(delivered.reason).toContain('已交付');

    const unknown = await retryQueueTask(root, 'nope:1');
    expect(unknown.retried).toBe(false);
    expect(unknown.reason).toContain('没有这条任务');
  });
});
