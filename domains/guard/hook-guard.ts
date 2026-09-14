import path from 'node:path';
import { attributionFor, resolveScopeAllow } from '../workflow/implementation-scope.js';
import { listChangeStates } from '../workflow/change-list.js';
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
  if (activeChanges.length === 0) {
    return { allowed: true, reason: "no-active-change" };
  }
  if (activeChanges.length > 1) {
    return { allowed: false, reason: "multiple-active-changes" };
  }

  const change = activeChanges[0];
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
