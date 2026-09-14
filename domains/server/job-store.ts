import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appendLineAtomic, atomicWriteJson, renameWithRetry } from '../../platform/fs/atomic-write.js';
import { redactSecrets } from '../../platform/io/redact.js';
import type { JobRecord } from './jobs.js';

/**
 * Job 的落盘形态。
 *
 * - 记录：`.cometflow/runtime/jobs/<id>.json`（原子写；不含 logTail，日志单独存文件）；
 * - 日志：`.cometflow/runtime/jobs/<id>.log`（追加写 + 1 MiB 轮转一代，与 change journal 同款）；
 * - 保留：默认「最近 200 条已完成」与「30 天」双阈值，**满足任一即保留**，由 `planJobGc` 出候选、
 *   `applyJobGc` 才真正删除（默认 dry-run 的调用方在 CLI/doctor 一侧）。
 */

export const JOB_RETENTION_DAYS = 30;
export const JOB_RETENTION_COUNT = 200;
export const JOB_LOG_MAX_BYTES = 1024 * 1024;
export const JOB_READ_LIMIT = 200;

export function jobDir(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'jobs');
}

function recordPath(projectRoot: string, jobId: string): string {
  return path.join(jobDir(projectRoot), jobId + '.json');
}

function logPath(projectRoot: string, jobId: string): string {
  return path.join(jobDir(projectRoot), jobId + '.log');
}

function rotatedLogPath(projectRoot: string, jobId: string): string {
  return path.join(jobDir(projectRoot), jobId + '.log.1');
}

async function fileSize(target: string): Promise<number> {
  try {
    return (await fs.stat(target)).size;
  } catch {
    return 0;
  }
}

/** 写任务记录（不含日志正文：日志在 .log 里，读取时再拼）。 */
export async function writeJobRecord(projectRoot: string, record: JobRecord): Promise<void> {
  await atomicWriteJson(recordPath(projectRoot, record.id), { ...record, logTail: [] });
}

/** 追加一行日志：先脱敏，超过上限则轮转一代。 */
export async function appendJobLog(projectRoot: string, jobId: string, line: string): Promise<void> {
  const target = logPath(projectRoot, jobId);
  if ((await fileSize(target)) > JOB_LOG_MAX_BYTES) {
    await renameWithRetry(target, rotatedLogPath(projectRoot, jobId));
  }
  await appendLineAtomic(target, redactSecrets(line, { aggressive: true }) + '\n');
}

/** 读取日志（轮转后的历史在前），默认只回最近 200 行。 */
export async function readJobLog(projectRoot: string, jobId: string, limit = JOB_READ_LIMIT): Promise<string[]> {
  const lines: string[] = [];
  for (const file of [rotatedLogPath(projectRoot, jobId), logPath(projectRoot, jobId)]) {
    let source: string;
    try {
      source = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of source.split(/\r?\n/u)) {
      if (line.trim() !== '') lines.push(line);
    }
  }
  return limit > 0 && lines.length > limit ? lines.slice(lines.length - limit) : lines;
}

export async function readJobRecord(projectRoot: string, jobId: string): Promise<JobRecord | null> {
  let source: string;
  try {
    source = await fs.readFile(recordPath(projectRoot, jobId), 'utf8');
  } catch {
    return null;
  }
  const record = JSON.parse(source) as JobRecord;
  record.logTail = await readJobLog(projectRoot, jobId);
  return record;
}

/** 列出落盘的任务（新→旧），带日志尾部。 */
export async function listJobRecords(projectRoot: string, limit = JOB_READ_LIMIT): Promise<JobRecord[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(jobDir(projectRoot));
  } catch {
    return [];
  }
  const records: JobRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const record = await readJobRecord(projectRoot, entry.replace(/\.json$/u, ''));
    if (record !== null) records.push(record);
  }
  records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  // limit <= 0 表示不截断（GC 要看到全部记录才能算「最近 N 条」）。
  return limit > 0 && records.length > limit ? records.slice(0, limit) : records;
}

export async function removeJob(projectRoot: string, jobId: string): Promise<void> {
  for (const file of [recordPath(projectRoot, jobId), logPath(projectRoot, jobId), rotatedLogPath(projectRoot, jobId)]) {
    await fs.rm(file, { force: true }).catch(() => undefined);
  }
}

export interface JobUsage {
  bytes: number;
  files: number;
  finished: number;
  running: number;
}

export async function collectJobUsage(projectRoot: string): Promise<JobUsage> {
  const records = await listJobRecords(projectRoot, 0);
  let bytes = 0;
  let files = 0;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(jobDir(projectRoot));
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    bytes += await fileSize(path.join(jobDir(projectRoot), entry));
    files += 1;
  }
  const finished = records.filter((record) => record.status === 'succeeded' || record.status === 'failed').length;
  return { bytes, files, finished, running: records.length - finished };
}

export interface JobGcCandidate {
  id: string;
  bytes: number;
  reason: 'age' | 'count';
  createdAt: string;
}

export interface JobGcPlan {
  candidates: JobGcCandidate[];
  reclaimableBytes: number;
  totalBytes: number;
  running: number;
}

/**
 * 计划回收：把「已结束」且落在保留窗口之外的任务列为候选。
 *
 * 双阈值（最近 N 条 + D 天）取**更宽**者：只要任务还在最近 N 条里、或还在 D 天以内，就保留。
 * 运行中的任务永不进候选。
 */
export async function planJobGc(
  projectRoot: string,
  options: { now?: Date; retentionDays?: number; retentionCount?: number } = {},
): Promise<JobGcPlan> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? JOB_RETENTION_DAYS;
  const retentionCount = options.retentionCount ?? JOB_RETENTION_COUNT;
  const records = await listJobRecords(projectRoot, 0);
  const finished = records.filter((record) => record.status === 'succeeded' || record.status === 'failed');
  const keepByCount = new Set(finished.slice(0, retentionCount).map((record) => record.id));
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

  const candidates: JobGcCandidate[] = [];
  let reclaimableBytes = 0;
  let totalBytes = 0;
  for (const entry of filesToScan(records)) {
    totalBytes += await fileSize(path.join(jobDir(projectRoot), entry.file));
  }
  for (const record of finished) {
    if (keepByCount.has(record.id)) continue;
    const createdAt = new Date(record.createdAt).getTime();
    if (Number.isNaN(createdAt) || createdAt >= cutoff) continue;
    let bytes = 0;
    for (const entry of filesToScan([record])) bytes += await fileSize(path.join(jobDir(projectRoot), entry.file));
    candidates.push({ id: record.id, bytes, reason: 'age', createdAt: record.createdAt });
    reclaimableBytes += bytes;
  }
  return { candidates, reclaimableBytes, totalBytes, running: records.length - finished.length };
}

function filesToScan(records: JobRecord[]): Array<{ file: string }> {
  const files: Array<{ file: string }> = [];
  for (const record of records) {
    files.push({ file: record.id + '.json' }, { file: record.id + '.log' }, { file: record.id + '.log.1' });
  }
  return files;
}

/** 执行回收：只删除计划里的候选（调用方负责先 dry-run 给人看）。 */
export async function applyJobGc(projectRoot: string, plan: JobGcPlan): Promise<{ removed: number; bytes: number }> {
  let bytes = 0;
  for (const candidate of plan.candidates) {
    await removeJob(projectRoot, candidate.id);
    bytes += candidate.bytes;
  }
  return { removed: plan.candidates.length, bytes };
}
