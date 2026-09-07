import path from 'node:path';
import { listChangeStates } from '../workflow/change-list.js';
import type { ChangeState } from '../workflow/change-types.js';

export type HookEvent = 'write' | 'edit';

export interface HookDecision {
  allowed: boolean;
  reason: string;
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

  return { allowed: true, reason: "implementation-allowed-in-phase-" + change.phase };
}
