import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { listSpecEntries, listSpecFiles } from '../spec/spec-index.js';
import { parseSpecFile } from '../spec/spec-parse.js';
import { collectSpecDrift } from '../spec/spec-drift.js';
import { readSpecHistory } from '../spec/spec-version.js';
import type { TaskPlan } from '../task-plan/types.js';
import { rate, type SpecHealthEntry, type SpecHealthMetrics } from './types.js';

async function listPlanFiles(projectRoot: string): Promise<string[]> {
  const dir = path.join(projectRoot, '.cometflow', 'plans');
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((entry) => entry.endsWith('.task-plan.yaml')).sort();
  } catch {
    return [];
  }
}

/** 被冻结或已批准任务绑定的 anchor（键为 `spec_ref#anchor`）。 */
async function collectBoundAnchors(projectRoot: string): Promise<Set<string>> {
  const bound = new Set<string>();
  for (const file of await listPlanFiles(projectRoot)) {
    let plan: TaskPlan;
    try {
      plan = parse(
        await fs.readFile(path.join(projectRoot, '.cometflow', 'plans', file), 'utf8'),
      ) as TaskPlan;
    } catch {
      continue;
    }
    for (const task of plan.tasks) {
      if (task.status !== 'frozen' && task.status !== 'approved') continue;
      if (!task.spec_ref || !task.spec_anchor) continue;
      bound.add(task.spec_ref + '#' + task.spec_anchor);
    }
  }
  return bound;
}

/**
 * spec 健康度。
 *
 * 三个口径都刻意用「能机器判定的比例」而不是「写了多少」：
 * 验收可判定率看 `- check:`，anchor 覆盖率看是否被冻结任务绑定，
 * 漂移看的是「改了 spec 之后有多少任务还挂在旧版本上」。
 */
export async function collectSpecHealthMetrics(
  projectRoot: string,
  options: { now?: Date } = {},
): Promise<{ metrics: SpecHealthMetrics; legacyNotes: string[] }> {
  const files = await listSpecFiles(projectRoot);
  const entries = await listSpecEntries(projectRoot);
  const capabilityFiles = entries.filter((entry) => entry.kind === 'capability').map((entry) => entry.path);
  const bound = await collectBoundAnchors(projectRoot);
  const history = await readSpecHistory(projectRoot);

  const rows: SpecHealthEntry[] = [];
  let acceptanceTotal = 0;
  let acceptanceWithCheck = 0;
  let anchorTotal = 0;
  let anchorBoundTotal = 0;

  for (const file of files) {
    const parsed = await parseSpecFile(projectRoot, file);
    const anchors = parsed.anchors;
    const isCapability = capabilityFiles.includes(file);
    // 只有 capability 参与 anchor 覆盖率：其它 kind 的标题不是任务绑定单位。
    const specAnchors = isCapability ? anchors : [];
    const uncovered = specAnchors
      .filter((anchor) => !bound.has(file + '#' + anchor.heading))
      .map((anchor) => anchor.heading);

    acceptanceTotal += parsed.acceptance.length;
    acceptanceWithCheck += parsed.acceptance.filter((item) => item.check !== null).length;
    anchorTotal += specAnchors.length;
    anchorBoundTotal += specAnchors.length - uncovered.length;

    const versions = history.specs[file]?.length ?? 0;
    rows.push({
      path: file,
      anchors: specAnchors.length,
      acceptance_total: parsed.acceptance.length,
      acceptance_with_check: parsed.acceptance.filter((item) => item.check !== null).length,
      checkable_rate: rate(
        parsed.acceptance.filter((item) => item.check !== null).length,
        parsed.acceptance.length,
      ),
      bound_anchors: specAnchors.length - uncovered.length,
      coverage_rate: rate(specAnchors.length - uncovered.length, specAnchors.length),
      uncovered_anchors: uncovered.sort(),
      versions,
    });
  }

  const drift = await collectSpecDrift(projectRoot);
  const byKind = new Map<string, number>();
  const bySeverity = new Map<string, number>();
  for (const entry of drift.drift) {
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
    bySeverity.set(entry.severity, (bySeverity.get(entry.severity) ?? 0) + 1);
  }

  // 「漂移年龄」用的不是漂移发生时间（没有记录），而是受影响 spec 的最后变更时间：
  // 它回答的是「这份 spec 多久前改过，而任务还挂在旧版本上」。
  const now = (options.now ?? new Date()).getTime();
  let oldestAgeDays: number | null = null;
  for (const entry of drift.drift) {
    const versions = history.specs[entry.spec_ref] ?? [];
    const latest = versions[versions.length - 1];
    if (!latest?.recorded_at) continue;
    const recorded = Date.parse(latest.recorded_at);
    if (Number.isNaN(recorded)) continue;
    const ageDays = Math.floor((now - recorded) / 86_400_000);
    oldestAgeDays = oldestAgeDays === null ? ageDays : Math.max(oldestAgeDays, ageDays);
  }

  const notes: string[] = [];
  const untrackedSpecs = files.filter((file) => (history.specs[file]?.length ?? 0) === 0);
  if (untrackedSpecs.length > 0) {
    notes.push(
      untrackedSpecs.length +
        ' 个 spec 还没有版本记录（未运行过 spec lock / plan freeze），版本类指标会低估',
    );
  }

  const metrics: SpecHealthMetrics = {
    specs: files.length,
    capabilities: capabilityFiles.length,
    acceptance_total: acceptanceTotal,
    acceptance_with_check: acceptanceWithCheck,
    acceptance_checkable_rate: rate(acceptanceWithCheck, acceptanceTotal),
    anchor_total: anchorTotal,
    anchor_bound: anchorBoundTotal,
    anchor_coverage_rate: rate(anchorBoundTotal, anchorTotal),
    drift: {
      count: drift.drift.length,
      by_kind: Object.fromEntries([...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))),
      by_severity: Object.fromEntries([...bySeverity.entries()].sort(([a], [b]) => a.localeCompare(b))),
      unresolvable: drift.unresolvable.length,
      oldest_spec_change_age_days: oldestAgeDays,
    },
    versions: {
      specs_tracked: Object.keys(history.specs).length,
      total_versions: Object.values(history.specs).reduce((sum, list) => sum + list.length, 0),
      specs_with_multiple_versions: Object.values(history.specs).filter((list) => list.length > 1).length,
    },
    entries: rows.sort((left, right) => left.path.localeCompare(right.path)),
  };

  return { metrics, legacyNotes: notes };
}
