import { readChangeJournal, type ChangeJournalEvent } from '../workflow/change-journal.js';
import { listChangeStates } from '../workflow/change-list.js';
import type { ChangeJournalEventType } from '../workflow/change-journal.js';
import type { ChangeState } from '../workflow/change-types.js';
import {
  mean,
  rate,
  type ChangeOutcome,
  type RebuildBucket,
  type RebuildMetrics,
  type RebuildSample,
  type VerdictSource,
} from './types.js';

const VERDICT_SOURCES: VerdictSource[] = ['check', 'document', 'agent', 'eval', 'uncovered'];

function capabilityOf(specRef: string | null): string | null {
  if (!specRef) return null;
  const match = /^specs\/([^/]+)\/spec\.md$/u.exec(specRef);
  return match ? match[1] : null;
}

function verifyEvents(events: ChangeJournalEvent[]): ChangeJournalEvent[] {
  return events.filter((event) => event.event === ('verify-result' as ChangeJournalEventType));
}

/** 从一次 verify-result 事件里取出结论来源（`id:result@source`）。 */
function sourcesOf(event: ChangeJournalEvent): VerdictSource[] {
  const verdicts = event.data?.verdicts;
  if (!Array.isArray(verdicts)) return [];
  const found = new Set<VerdictSource>();
  for (const entry of verdicts) {
    if (typeof entry !== 'string') continue;
    const at = entry.lastIndexOf('@');
    if (at < 0) continue;
    const source = entry.slice(at + 1) as VerdictSource;
    if (VERDICT_SOURCES.includes(source)) found.add(source);
  }
  return [...found].sort();
}

function attemptsOf(event: ChangeJournalEvent): number | null {
  const value = event.data?.repair_attempts;
  return typeof value === 'number' ? value : null;
}

function passedOf(event: ChangeJournalEvent): boolean {
  return event.data?.passed === true;
}

/**
 * 一个 change 的重建样本。
 *
 * 口径要点：
 * - 「修复轮数」= 首次通过之前失败了几轮（0 = 一轮就对）。
 *   这里刻意**不用 state.repair_attempts**：验证通过时它会被重置为 0，
 *   于是每个通过事件看起来都像首轮通过——这是实现度量时踩过的一个坑。
 * - 从未通过的 change，`attempts_to_pass` 为 null；
 * - 老 change（验证记录里没有 repair_attempts 字段）标记 legacy，便于解释口径。
 */
export function buildRebuildSample(
  state: ChangeState,
  events: ChangeJournalEvent[],
): RebuildSample {
  const verdictEvents = verifyEvents(events);
  const sources = new Set<VerdictSource>();
  for (const event of verdictEvents) for (const source of sourcesOf(event)) sources.add(source);

  const firstPassIndex = verdictEvents.findIndex(passedOf);
  const attemptsToPass = firstPassIndex >= 0 ? firstPassIndex : null;
  const firstPass = firstPassIndex === 0;

  const legacy = verdictEvents.some((event) => attemptsOf(event) === null);
  const blocked = state.status === 'blocked';

  let outcome: ChangeOutcome;
  if (verdictEvents.length === 0) {
    outcome = 'unverified';
  } else if (state.archived) {
    outcome = 'archived';
  } else if (blocked) {
    outcome = 'blocked';
  } else if (passedOf(verdictEvents[verdictEvents.length - 1])) {
    outcome = 'passing';
  } else {
    outcome = 'failing';
  }

  return {
    change: state.name,
    capability: capabilityOf(state.spec_ref ?? null),
    module: state.module ?? null,
    spec_ref: state.spec_ref ?? null,
    spec_version: state.spec_version ?? null,
    outcome,
    verify_runs: verdictEvents.length,
    attempts_to_pass: attemptsToPass,
    first_pass: firstPass,
    sources: [...sources].sort(),
    check_only: sources.size > 0 && [...sources].every((source) => source === 'check'),
    blocked,
    legacy,
  };
}

function bucket(key: string, samples: RebuildSample[]): RebuildBucket {
  const passing = samples.filter((sample) => sample.attempts_to_pass !== null);
  return {
    key,
    sample_size: samples.length,
    first_pass_rate: rate(samples.filter((sample) => sample.first_pass).length, samples.length),
    mean_attempts_to_pass: mean(
      passing.map((sample) => sample.attempts_to_pass as number),
    ),
    blocked_rate: rate(samples.filter((sample) => sample.blocked).length, samples.length),
  };
}

function groupBy(samples: RebuildSample[], key: (sample: RebuildSample) => string | null): RebuildBucket[] {
  const groups = new Map<string, RebuildSample[]>();
  for (const sample of samples) {
    const group = key(sample);
    if (group === null) continue;
    const list = groups.get(group) ?? [];
    list.push(sample);
    groups.set(group, list);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, list]) => bucket(group, list));
}

export interface RebuildMetricsResult {
  metrics: RebuildMetrics;
  legacyChanges: string[];
}

/**
 * 重建质量指标。
 *
 * 分母刻意分成两个：
 * - `total_changes`：所有 change（含从未验证过的），用于看「有多少工作根本没走到验证」；
 * - `sample_size`：至少验证过一次的 change，其余比率都用它——把未验证的混进来会稀释结论。
 */
export async function collectRebuildMetrics(
  projectRoot: string,
): Promise<RebuildMetricsResult> {
  const states = (await listChangeStates(projectRoot)).slice().sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const samples: RebuildSample[] = [];
  for (const state of states) {
    // limit: 0 = 全量读取，避免轮转后的历史被截断而低估样本。
    const events = await readChangeJournal(projectRoot, state.name, { limit: 0 });
    samples.push(buildRebuildSample(state, events));
  }

  const verified = samples.filter((sample) => sample.verify_runs > 0);
  const sourceCounts = new Map<VerdictSource, number>();
  for (const source of VERDICT_SOURCES) sourceCounts.set(source, 0);
  for (const sample of verified) {
    for (const source of sample.sources) {
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
  }

  const metrics: RebuildMetrics = {
    sample_size: verified.length,
    verified_changes: verified.length,
    total_changes: samples.length,
    archived_changes: samples.filter((sample) => sample.outcome === 'archived').length,
    first_pass_rate: rate(verified.filter((sample) => sample.first_pass).length, verified.length),
    mean_attempts_to_pass: mean(
      verified
        .map((sample) => sample.attempts_to_pass)
        .filter((value): value is number => value !== null),
    ),
    pass_rate: rate(samples.filter((sample) => sample.outcome === 'archived').length, verified.length),
    blocked_rate: rate(verified.filter((sample) => sample.blocked).length, verified.length),
    verdict_sources: Object.fromEntries(
      [...sourceCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ) as Record<VerdictSource, number>,
    check_coverage_rate: rate(verified.filter((sample) => sample.check_only).length, verified.length),
    per_capability: groupBy(verified, (sample) => sample.capability),
    per_module: groupBy(verified, (sample) => sample.module),
    samples,
  };

  return {
    metrics,
    legacyChanges: samples.filter((sample) => sample.legacy).map((sample) => sample.change),
  };
}
