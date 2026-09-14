import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appendLineAtomic, renameWithRetry } from '../../platform/fs/atomic-write.js';
import { redactDeep } from '../../platform/io/redact.js';

export const CHANGE_JOURNAL_SCHEMA = 'cometflow.change-journal.v1';

export type ChangeJournalEventType =
  | 'change-created'
  | 'spec-baseline-captured'
  | 'implementation-baseline-captured'
  | 'run-started'
  | 'run-completed'
  | 'verify-started'
  | 'verify-result'
  | 'rebase'
  | 'transition'
  | 'transition-settled'
  | 'journal-rotated'
  | 'unblocked'
  | 'git-drift-overridden'
  | 'archive-started'
  | 'spec-applied'
  | 'spec-version-recorded'
  | 'archive-completed'
  | 'archive-rolled-back';

export interface ChangeJournalEvent {
  schema: typeof CHANGE_JOURNAL_SCHEMA;
  at: string;
  change: string;
  event: ChangeJournalEventType;
  phase?: string;
  data?: Record<string, unknown>;
}

export function changeJournalPath(projectRoot: string, name: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'changes', name, 'journal.jsonl');
}

/** 单个 journal 的体积上限；超过后轮转，避免长跑项目证据无限增长。 */
export const MAX_JOURNAL_BYTES = 1024 * 1024;
/** 读取时默认返回的最近事件条数；0 表示不限制。 */
export const DEFAULT_JOURNAL_READ_LIMIT = 2000;

export function rotatedJournalPath(projectRoot: string, name: string): string {
  return changeJournalPath(projectRoot, name).replace(/\.jsonl$/u, '.1.jsonl');
}

/**
 * 轮转 journal：把当前文件改名为 `.1.jsonl`（只保留一代），
 * 并在新文件开头写一条摘要，说明「之前的内容去哪了、有多少」。
 */
export async function rotateChangeJournal(
  projectRoot: string,
  name: string,
  options: { maxBytes?: number; force?: boolean } = {},
): Promise<{ rotated: boolean; bytes: number }> {
  const filePath = changeJournalPath(projectRoot, name);
  let size: number;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return { rotated: false, bytes: 0 };
  }
  if (!options.force && size < (options.maxBytes ?? MAX_JOURNAL_BYTES)) {
    return { rotated: false, bytes: 0 };
  }
  const rotatedPath = rotatedJournalPath(projectRoot, name);
  await fs.rm(rotatedPath, { force: true });
  await renameWithRetry(filePath, rotatedPath);
  await appendLineAtomic(
    filePath,
    JSON.stringify({
      schema: CHANGE_JOURNAL_SCHEMA,
      at: new Date().toISOString(),
      change: name,
      event: 'journal-rotated',
      data: { rotatedTo: path.basename(rotatedPath), bytes: size },
    }) + '\n',
  );
  return { rotated: true, bytes: size };
}

/**
 * 追加式审计流水。
 *
 * 借鉴 comet 的 `state-events.jsonl`：状态迁移、spec 应用、验证结论都留一条不可变的记录，
 * 这样「谁在什么时候把哪一版 spec 变成了什么」可以在事后被完整回答，
 * 而不是只依赖当前状态的快照。
 */
export async function appendChangeEvent(
  projectRoot: string,
  name: string,
  event: ChangeJournalEventType,
  data: Record<string, unknown> = {},
  options: { phase?: string; now?: Date; maxJournalBytes?: number } = {},
): Promise<ChangeJournalEvent> {
  await rotateChangeJournal(projectRoot, name, { maxBytes: options.maxJournalBytes });
  const record: ChangeJournalEvent = {
    schema: CHANGE_JOURNAL_SCHEMA,
    at: (options.now ?? new Date()).toISOString(),
    change: name,
    event,
    ...(options.phase ? { phase: options.phase } : {}),
    // 审计流水是长期留存的证据，一律按 aggressive 档裁剪凭证。
    ...(Object.keys(data).length > 0
      ? { data: redactDeep(data, { aggressive: true }) as Record<string, unknown> }
      : {}),
  };
  const filePath = changeJournalPath(projectRoot, name);
  await appendLineAtomic(filePath, JSON.stringify(record) + '\n');
  return record;
}

export async function readChangeJournal(
  projectRoot: string,
  name: string,
  options: { limit?: number } = {},
): Promise<ChangeJournalEvent[]> {
  const events: ChangeJournalEvent[] = [];
  // 轮转后的历史文件在前，当前文件在后，拼起来才是完整的事件序列。
  for (const filePath of [rotatedJournalPath(projectRoot, name), changeJournalPath(projectRoot, name)]) {
    let source: string;
    try {
      source = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const line of source.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        events.push(JSON.parse(trimmed) as ChangeJournalEvent);
      } catch {
        // 半行写入（进程被杀）不应该让整个流水不可读。
        continue;
      }
    }
  }
  const limit = options.limit ?? DEFAULT_JOURNAL_READ_LIMIT;
  return limit > 0 && events.length > limit ? events.slice(events.length - limit) : events;
}
