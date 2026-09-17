import { HOOK_PLATFORMS, hookStatus } from '../guard/hook-install.js';
import type { QueueTask } from './queue.js';
import path from 'node:path';
import { readTextFile } from '../../platform/fs/read-file.js';
import { parseSpecMeta, normalizeModulePath } from '../spec/spec-meta.js';

/**
 * 并发准入与并发单元（ADR 0028 的执行部分）。
 *
 * 两件事必须同时成立才允许开并发：
 * 1. **项目没有装写保护守卫**——守卫按 current-change 指针 fail-closed（ADR 0018/0023），
 *    并发跑两个 change 时指针只能指一个，另一个的写入必然被拒；
 * 2. **并发的两条任务属于不同 capability**（`spec_ref` 不同）——同一份契约下的任务共享
 *    spec 与 module，并行改同一块代码是必然冲突，不是概率问题。
 */

/**
 * 并发单元：capability spec。
 *
 * 起草类任务（spec-authoring）没有 `spec_ref`，用它的 capability 当单元——
 * 否则同一个 capability 的多个起草任务会被当成不同单元并行跑。
 */
export function concurrencyUnit(task: Pick<QueueTask, 'spec_ref' | 'capability' | 'task'>): string {
  if (task.spec_ref !== null && task.spec_ref !== undefined && task.spec_ref !== '') return task.spec_ref;
  return 'capability:' + (task.capability ?? task.task);
}

export interface GuardStatus {
  installed: boolean;
  platforms: string[];
}

/** 有没有装写保护守卫（只看「支持且已安装」的平台，不把「不支持」当安装）。 */
export async function guardStatus(projectRoot: string): Promise<GuardStatus> {
  const platforms: string[] = [];
  for (const platform of HOOK_PLATFORMS) {
    try {
      const status = await hookStatus(projectRoot, platform);
      if (status.supported && status.installed) platforms.push(platform);
    } catch {
      // 探测失败按「没装」处理：并发准入不该因为探针异常而永久关闭。
    }
  }
  return { installed: platforms.length > 0, platforms };
}

export interface ConcurrencyGate {
  ok: boolean;
  reason: string;
}

export async function checkConcurrencyGate(projectRoot: string, requested: number): Promise<ConcurrencyGate> {
  if (requested <= 1) return { ok: true, reason: 'concurrency=1' };
  const guard = await guardStatus(projectRoot);
  if (!guard.installed) return { ok: true, reason: 'no-guard' };

  /**
   * 装了守卫也能并发——前提是**归属无歧义**：守卫现在先按 module 判归属（ADR 0028 的守卫扩容），
   * 所以要求每个待办实现任务的 spec 都声明了 module，且这些 module **两两不相交**
   * （一个路径只能落在一个 module 里，否则守卫仍然只能 fail closed）。
   * 起草类任务（spec-authoring）不受这条约束：它写的是 specs/，走保护路径。
   */
  const modules = await pendingImplementationModules(projectRoot);
  const missing = modules.filter((entry) => entry.module === null).map((entry) => entry.task);
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        '装了写保护守卫（' +
        guard.platforms.join(', ') +
        '）：它按 module 判定写入归属，而这些任务的 spec 没有声明 module —— ' +
        missing.join(', ') +
        '；给对应 spec 补 module，或先串行跑',
    };
  }
  const overlap = findOverlappingModules(modules.map((entry) => entry.module!));
  if (overlap !== null) {
    return {
      ok: false,
      reason:
        '装了写保护守卫（' +
        guard.platforms.join(', ') +
        '）：待办任务的 module 互相包含（' +
        overlap[0] +
        ' vs ' +
        overlap[1] +
        '），路径归属会有歧义；把它们排成串行，或让 module 两两不相交',
    };
  }
  return { ok: true, reason: 'guard-module-attribution' };
}

/** 待办实现任务的 module（读 spec 的 front-matter）。读不到 spec 时 module 记 null（= 不能并发）。 */
export async function pendingImplementationModules(
  projectRoot: string,
): Promise<Array<{ task: string; module: string | null }>> {
  const { mergeTodoView } = await import('./daemon-todo.js');
  const view = await mergeTodoView(projectRoot);
  const result: Array<{ task: string; module: string | null }> = [];
  for (const task of view.tasks) {
    if (task.status !== 'queued' || task.delivered) continue;
    if (task.kind === 'spec-authoring' || !task.spec_ref) continue;
    const absolute = path.join(projectRoot, task.spec_ref);
    try {
      const meta = parseSpecMeta(await readTextFile(absolute));
      result.push({ task: task.goal + ':' + task.task, module: normalizeModulePath(meta.module) });
    } catch {
      result.push({ task: task.goal + ':' + task.task, module: null });
    }
  }
  return result;
}

/** 找出第一对互相包含的 module（前缀关系），没有则返回 null。 */
export function findOverlappingModules(modules: readonly string[]): [string, string] | null {
  const sorted = [...new Set(modules)].sort();
  for (const [index, left] of sorted.entries()) {
    for (const right of sorted.slice(index + 1)) {
      if (right === left || right.startsWith(left + '/')) return [left, right];
    }
  }
  return null;
}

/**
 * 下一条**可领取**的任务：`queued` + 依赖已满足 + 并发单元没被占用。
 *
 * 与 `nextQueuedTask` 的区别只有最后一条：它不知道"哪些 capability 正在跑"，
 * 那是调度器内存里的状态（并发槽），所以放在这里由调用方传入。
 */
export function nextClaimableTask(
  tasks: readonly QueueTask[],
  activeUnits: ReadonlySet<string>,
): QueueTask | null {
  return (
    tasks.find(
      (task) =>
        task.status === 'queued' &&
        (task.blocked_by?.length ?? 0) === 0 &&
        !activeUnits.has(concurrencyUnit(task)),
    ) ?? null
  );
}
