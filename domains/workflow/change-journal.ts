import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appendLineAtomic } from '../../platform/fs/atomic-write.js';

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
  options: { phase?: string; now?: Date } = {},
): Promise<ChangeJournalEvent> {
  const record: ChangeJournalEvent = {
    schema: CHANGE_JOURNAL_SCHEMA,
    at: (options.now ?? new Date()).toISOString(),
    change: name,
    event,
    ...(options.phase ? { phase: options.phase } : {}),
    ...(Object.keys(data).length > 0 ? { data } : {}),
  };
  const filePath = changeJournalPath(projectRoot, name);
  await appendLineAtomic(filePath, JSON.stringify(record) + '\n');
  return record;
}

export async function readChangeJournal(
  projectRoot: string,
  name: string,
): Promise<ChangeJournalEvent[]> {
  let source: string;
  try {
    source = await fs.readFile(changeJournalPath(projectRoot, name), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const events: ChangeJournalEvent[] = [];
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
  return events;
}
