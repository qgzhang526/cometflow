import { HOOK_PLATFORMS, hookStatus } from '../guard/hook-install.js';
import type { QueueTask } from './queue.js';

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
  if (guard.installed) {
    return {
      ok: false,
      reason:
        '装了写保护守卫（' +
        guard.platforms.join(', ') +
        '）：它按 current-change 指针 fail-closed，并发会让另一个 change 的写入被拒；' +
        '先 cometflow hook uninstall . --platform <platform>，或等守卫支持按 module 判定归属（ADR 0028）',
    };
  }
  return { ok: true, reason: 'no-guard' };
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
