import { appendLineAtomic } from '../../platform/fs/atomic-write.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readProjectConfig } from './config.js';

/**
 * 并发写策略（ADR 0021）。
 *
 * `warn` 是有期限的过渡态：冲突照旧写入，但必须处处留痕；`warnUntil` 过后由 doctor 与
 * `spec verify` 报 error，CI 因此变红——**只有两条出路**：切 `fail`，或显式延长并写下理由。
 * 这样「先宽后严」不会因为忘记而永久停在宽模式。
 */

export type SpecWriteMode = 'warn' | 'fail';

export interface ConcurrencyPolicy {
  mode: SpecWriteMode;
  warnUntil: string | null;
  warnReason: string | null;
  /** warn 模式是否已到期（到期后必须显式决策）。 */
  expired: boolean;
  /** 距离到期还有多少天（未设置到期时 null；已过期返回负数）。 */
  daysUntilExpiry: number | null;
}

export const DEFAULT_WARN_DAYS = 30;

export function conflictsFile(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'cas-conflicts.jsonl');
}

export async function resolveConcurrencyPolicy(
  projectRoot: string,
  now: Date = new Date(),
): Promise<ConcurrencyPolicy> {
  const config = await readProjectConfig(projectRoot);
  const mode: SpecWriteMode = config.concurrency?.specWrites === 'fail' ? 'fail' : 'warn';
  const warnUntil = config.concurrency?.warnUntil ?? null;
  const warnReason = config.concurrency?.warnReason ?? null;
  if (mode === 'fail' || warnUntil === null) {
    return { mode, warnUntil, warnReason, expired: false, daysUntilExpiry: null };
  }
  const until = new Date(warnUntil).getTime();
  if (Number.isNaN(until)) return { mode, warnUntil, warnReason, expired: true, daysUntilExpiry: null };
  const days = Math.ceil((until - now.getTime()) / (24 * 60 * 60 * 1000));
  return { mode, warnUntil, warnReason, expired: days <= 0, daysUntilExpiry: days };
}

export interface CasConflictRecord {
  at: string;
  path: string;
  expected: string | null;
  actual: string | null;
  mode: SpecWriteMode;
}

/** 记录一次并发冲突（warn 模式下用来判断「误报率」与切换时机）。 */
export async function recordCasConflict(projectRoot: string, record: Omit<CasConflictRecord, 'at'>): Promise<void> {
  await appendLineAtomic(conflictsFile(projectRoot), JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
}

export async function readCasConflicts(projectRoot: string, limit = 200): Promise<CasConflictRecord[]> {
  let source: string;
  try {
    source = await fs.readFile(conflictsFile(projectRoot), 'utf8');
  } catch {
    return [];
  }
  const records: CasConflictRecord[] = [];
  for (const line of source.split(/\r?\n/u)) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line) as CasConflictRecord);
    } catch {
      // 半行写入（进程被杀）不应该让统计不可读
    }
  }
  return limit > 0 && records.length > limit ? records.slice(records.length - limit) : records;
}
