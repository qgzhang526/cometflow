import { promises as fs } from 'node:fs';
import path from 'node:path';
import { rotateChangeJournal } from './change-journal.js';
import { listChangeStates } from './change-list.js';

export interface EvidenceUsageEntry {
  change: string;
  archived: boolean;
  bytes: number;
  files: number;
}

export type ReclaimReason = 'tx-staging' | 'implementation-baseline' | 'journal-rotation';

export interface ReclaimCandidate {
  change: string;
  path: string;
  reason: ReclaimReason;
  bytes: number;
}

export interface EvidenceGcPlan {
  entries: EvidenceUsageEntry[];
  candidates: ReclaimCandidate[];
  reclaimableBytes: number;
  totalBytes: number;
}

function runtimeChangesDir(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'changes');
}

async function directoryUsage(directory: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return { bytes, files };
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await directoryUsage(absolute);
      bytes += nested.bytes;
      files += nested.files;
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const stat = await fs.stat(absolute);
      bytes += stat.size;
      files += 1;
    } catch {
      continue;
    }
  }
  return { bytes, files };
}

async function pathSize(target: string): Promise<number> {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return 0;
  }
  if (stat.isFile()) return stat.size;
  const usage = await directoryUsage(target);
  return usage.bytes;
}

/** 统计每个 change 的证据占用，供 doctor 与 gc 展示。 */
export async function collectEvidenceUsage(projectRoot: string): Promise<EvidenceUsageEntry[]> {
  const root = runtimeChangesDir(projectRoot);
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  const states = new Map((await listChangeStates(projectRoot)).map((state) => [state.name, state]));
  const entries: EvidenceUsageEntry[] = [];
  for (const change of names) {
    const usage = await directoryUsage(path.join(root, change));
    entries.push({
      change,
      archived: states.get(change)?.archived ?? false,
      bytes: usage.bytes,
      files: usage.files,
    });
  }
  return entries.sort((left, right) => right.bytes - left.bytes);
}

/**
 * 规划可回收的证据。
 *
 * 只碰 `.cometflow/runtime/` 之下、且只碰「可重新推导」的东西：
 * - `tx/<id>/staged|backup`：归档事务的中间产物，canonical spec 已经在版本仓里；
 * - 归档 change 的 `impl-baseline.json`：实现范围基线，只服务于「正在进行」的变更；
 * - 超过阈值的 journal：轮转成 `.1.jsonl`（保留一代），不是删除。
 *
 * 从不触碰 `changes/`、`.cometflow-history/`、`specs/`。
 */
export async function planEvidenceGc(
  projectRoot: string,
): Promise<EvidenceGcPlan> {
  const states = new Map((await listChangeStates(projectRoot)).map((state) => [state.name, state]));
  const entries = await collectEvidenceUsage(projectRoot);
  const candidates: ReclaimCandidate[] = [];

  for (const entry of entries) {
    const changeDir = path.join(runtimeChangesDir(projectRoot), entry.change);
    const txRoot = path.join(changeDir, 'tx');

    if (entry.archived) {
      let txIds: string[] = [];
      try {
        txIds = await fs.readdir(txRoot);
      } catch {
        txIds = [];
      }
      for (const txId of txIds) {
        for (const sub of ['staged', 'backup']) {
          const target = path.join(txRoot, txId, sub);
          const bytes = await pathSize(target);
          if (bytes > 0) {
            candidates.push({ change: entry.change, path: target, reason: 'tx-staging', bytes });
          }
        }
      }

      const implBaseline = path.join(changeDir, 'impl-baseline.json');
      const baselineBytes = await pathSize(implBaseline);
      if (baselineBytes > 0) {
        candidates.push({
          change: entry.change,
          path: implBaseline,
          reason: 'implementation-baseline',
          bytes: baselineBytes,
        });
      }
    }
  }

  const reclaimableBytes = candidates.reduce((total, entry) => total + entry.bytes, 0);
  const totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  return { entries, candidates, reclaimableBytes, totalBytes };
}

export interface EvidenceGcResult {
  removed: { path: string; bytes: number }[];
  freedBytes: number;
  rotatedJournals: string[];
}

export async function applyEvidenceGc(
  projectRoot: string,
  plan: EvidenceGcPlan,
  options: { journalMaxBytes?: number } = {},
): Promise<EvidenceGcResult> {
  const removed: { path: string; bytes: number }[] = [];
  let freedBytes = 0;
  const runtimeRoot = runtimeChangesDir(projectRoot);

  for (const candidate of plan.candidates) {
    // 安全边界：只删 runtime 目录下的路径，越界的一律跳过。
    const relative = path.relative(runtimeRoot, candidate.path);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    await fs.rm(candidate.path, { recursive: true, force: true });
    removed.push({ path: candidate.path, bytes: candidate.bytes });
    freedBytes += candidate.bytes;
  }

  const rotatedJournals: string[] = [];
  for (const entry of plan.entries) {
    const rotated = await rotateChangeJournal(projectRoot, entry.change, {
      maxBytes: options.journalMaxBytes,
    });
    if (rotated.rotated) {
      rotatedJournals.push(entry.change);
      // 轮转不减少总量，只是把大文件挪到历史档；这里不计入 freedBytes。
    }
  }

  return { removed, freedBytes, rotatedJournals };
}

/** 供 doctor 使用：人类可读的体积摘要。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
