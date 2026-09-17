import path from 'node:path';
import { attributionFor, resolveScopeAllow } from '../workflow/implementation-scope.js';
import { listChangeStates } from '../workflow/change-list.js';
import { readCurrentChange } from '../workflow/current-change.js';
import type { ChangeState } from '../workflow/change-types.js';

export type HookEvent = 'write' | 'edit';

export interface HookDecision {
  allowed: boolean;
  reason: string;
  /** 被拒时给出可直接执行的修复建议。 */
  hint?: string;
}

function relativePath(projectRoot: string, target: string): string | null {
  const relative = path.relative(projectRoot, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function isInside(relative: string | null, prefix: string): boolean {
  return relative !== null && (relative === prefix || relative.startsWith(prefix + "/"));
}

/**
 * 决定这次写入归属哪个 change。
 *
 * 只有一个活跃 change 时没有歧义，不需要指针；多个时必须靠
 * `.cometflow/current-change.json` 精确路由，指针缺失或失效一律 fail closed——
 * 猜错归属比拒绝写入危险得多。
 */
async function resolveOwningChange(
  projectRoot: string,
  activeChanges: ChangeState[],
  relative: string,
): Promise<{ change: ChangeState | null; decision: HookDecision | null }> {
  if (activeChanges.length === 0) {
    return { change: null, decision: { allowed: true, reason: 'no-active-change' } };
  }
  if (activeChanges.length === 1) {
    return { change: activeChanges[0], decision: null };
  }

  /**
   * 模块归属（ADR 0028 的守卫扩容）：多个活跃 change 并存时，先看**这次写入落在谁的 module 里**。
   *
   * 这是并发的前提条件：两个 change 各写自己声明的模块时，归属本来就没有歧义，
   * 不需要人工先设 current-change 指针。只有"没有 module / 落在多个 module 里"才回落到指针与 fail closed。
   * 只认 build 阶段：shape 写 specs（走保护路径），verify/archive 是只读的。
   */
  const moduleCandidates = activeChanges.filter((change) => {
    if (change.phase !== 'build' || change.module === null || change.module === undefined) return false;
    const attribution = attributionFor(relative, change.module, []);
    return attribution === 'module' || attribution === 'module-prefix';
  });
  if (moduleCandidates.length === 1) {
    return { change: moduleCandidates[0], decision: null };
  }

  const pointer = await readCurrentChange(projectRoot);
  if (!pointer) {
    return {
      change: null,
      decision: {
        allowed: false,
        reason: 'multiple-active-changes',
        hint:
          '同时存在 ' +
          activeChanges.length +
          ' 个活跃 change（' +
          activeChanges.map((entry) => entry.name).join(', ') +
          '），且 ' +
          relative +
          ' 不在任何一个 change 声明的 module 内（或同时落在多个 module 里），无法判断归属；' +
          '先运行 cometflow change select <name> 指定当前 change',
      },
    };
  }
  const target = activeChanges.find((entry) => entry.name === pointer.change);
  if (!target) {
    return {
      change: null,
      decision: {
        allowed: false,
        reason: 'stale-current-change',
        hint:
          'current-change 指针指向 ' +
          pointer.change +
          '，但它不存在或已归档；运行 cometflow change select <name> 重新指定（可选：' +
          activeChanges.map((entry) => entry.name).join(', ') +
          '）',
      },
    };
  }
  return { change: target, decision: null };
}

export async function evaluateHook(projectRoot: string, event: HookEvent, target: string): Promise<HookDecision> {
  void event;
  const relative = relativePath(path.resolve(projectRoot), path.resolve(target));
  if (relative === null) {
    return { allowed: true, reason: "outside-project" };
  }

  if (isInside(relative, ".cometflow")) {
    return { allowed: false, reason: "machine-owned-path" };
  }

  const activeChanges = (await listChangeStates(projectRoot)).filter((change) => !change.archived);
  const routing = await resolveOwningChange(projectRoot, activeChanges, relative);
  if (routing.decision) return routing.decision;
  const change = routing.change!;
  if (isInside(relative, "changes/" + change.name)) {
    return { allowed: true, reason: "change-workspace" };
  }

  const protectedSpecPath = relative === "COMETFLOW.md" || isInside(relative, "specs");
  if (protectedSpecPath) {
    if (change.phase === "shape") {
      return { allowed: true, reason: "spec-shaping" };
    }
    return { allowed: false, reason: "spec-write-not-allowed-in-phase-" + change.phase };
  }

  if (change.phase === "verify") {
    return { allowed: false, reason: "verify-is-read-only" };
  }

  // 模块边界是硬约束：spec 用 front-matter module 声明实现位置后，
  // build 阶段写模块外的文件会被拒绝，而不是只靠提示词请求 agent 自觉。
  if (change.phase === 'build' && change.module) {
    const allow = await resolveScopeAllow(projectRoot);
    const attribution = attributionFor(relative, change.module, allow);
    if (attribution === 'unattributed') {
      return {
        allowed: false,
        reason: 'outside-module-scope',
        hint:
          '当前 change 声明的模块是 ' +
          change.module +
          '，写入 ' +
          relative +
          ' 越界；若确有必要，请在 COMETFLOW.md 的「## 模块归属」中声明为共享路径（随仓库分发），' +
          '或在 .cometflow/config.yaml 的 scope.allow 中做本地放行',
      };
    }
  }

  return { allowed: true, reason: "implementation-allowed-in-phase-" + change.phase };
}
