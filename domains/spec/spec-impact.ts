import path from 'node:path';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';
import { hashSpecText } from './spec-hash.js';
import { parseSpecContent } from './spec-parse.js';
import { diffSpecs, type SpecDiff } from './spec-lock.js';
import { collectSpecDrift, type SpecDriftEntry, type SpecDriftKind, type SpecDriftSeverity } from './spec-drift.js';
import { latestSpecVersionContent } from './spec-version.js';
import type { ParsedSpec } from './types.js';

export const SPEC_IMPACT_SCHEMA = 'cometflow.spec-impact.v1';

export type SpecAnchorChangeKind = 'added' | 'removed' | 'renamed' | 'modified' | 'acceptance-changed';
export type SpecSeverity = 'none' | SpecDriftSeverity;

export interface SpecImpactAnchor {
  heading: string;
  change: SpecAnchorChangeKind;
  severity: SpecDriftSeverity;
  detail: string;
  /** renamed 时指向新标题。 */
  renamed_to?: string;
}

export interface SpecImpactTask {
  goal: string;
  task: string;
  task_status: string;
  anchor: string | null;
  change: SpecDriftKind;
  severity: SpecDriftSeverity;
  message: string;
  acceptance_added: string[];
  acceptance_removed: string[];
}

export interface SpecImpactFile {
  path: string;
  file_change: 'added' | 'modified' | 'removed';
  anchors: SpecImpactAnchor[];
  affected_tasks: SpecImpactTask[];
  severity: SpecSeverity;
}

export interface SpecImpactReport {
  schema: typeof SPEC_IMPACT_SCHEMA;
  generated_at: string;
  files: SpecImpactFile[];
  affected_tasks: SpecImpactTask[];
  /** 有一份 spec 被改了，但没有任何冻结任务引用它。 */
  untracked_changes: string[];
  summary: {
    files_changed: number;
    anchors_changed: number;
    tasks_affected: number;
    highest_severity: SpecSeverity;
  };
}

const SEVERITY_ORDER: SpecSeverity[] = ['none', 'low', 'medium', 'high'];

function maxSeverity(values: SpecSeverity[]): SpecSeverity {
  let result: SpecSeverity = 'none';
  for (const value of values) {
    if (SEVERITY_ORDER.indexOf(value) > SEVERITY_ORDER.indexOf(result)) result = value;
  }
  return result;
}

function anchorIndex(parsed: ParsedSpec): Map<string, { hash: string; ids: string[]; texts: Map<string, string> }> {
  const index = new Map<string, { hash: string; ids: string[]; texts: Map<string, string> }>();
  for (const anchor of parsed.anchors) {
    const items = anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance;
    index.set(anchor.heading, {
      hash: anchor.hash,
      ids: items.map((item) => item.id),
      texts: new Map(items.map((item) => [item.id, item.text])),
    });
  }
  return index;
}

function acceptanceDelta(
  before: Map<string, string>,
  after: Map<string, string>,
): { added: string[]; removed: string[]; rewritten: string[] } {
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const rewritten = [...after.keys()].filter(
    (id) => before.has(id) && before.get(id) !== after.get(id),
  );
  return { added, removed, rewritten };
}

/**
 * 文件内 anchor 级 diff：这是「spec 演进影响了哪些接口/流程」的机器视图。
 *
 * 判定顺序刻意如此：
 * 1. 标题消失但正文哈希在别处出现 → renamed（改名，不是删接口）；
 * 2. 验收项变化 → acceptance-changed（契约变化，通常最高风险）；
 * 3. 正文变化 → modified；
 * 4. 新增标题 → added。
 */
function diffAnchors(
  relativePath: string,
  before: ParsedSpec,
  after: ParsedSpec,
): SpecImpactAnchor[] {
  const beforeIndex = anchorIndex(before);
  const afterIndex = anchorIndex(after);
  const changes: SpecImpactAnchor[] = [];

  for (const [heading, beforeAnchor] of beforeIndex) {
    const afterAnchor = afterIndex.get(heading);
    if (!afterAnchor) {
      const renamed = [...afterIndex.entries()].find(([, value]) => value.hash === beforeAnchor.hash);
      if (renamed) {
        changes.push({
          heading,
          change: 'renamed',
          severity: 'medium',
          detail: 'anchor 改名: ' + heading + ' → ' + renamed[0],
          renamed_to: renamed[0],
        });
        continue;
      }
      changes.push({
        heading,
        change: 'removed',
        severity: 'high',
        detail: 'anchor 被删除: ' + relativePath + '#' + heading,
      });
      continue;
    }

    const delta = acceptanceDelta(beforeAnchor.texts, afterAnchor.texts);
    if (delta.added.length > 0 || delta.removed.length > 0 || delta.rewritten.length > 0) {
      const bodyAlsoChanged = afterAnchor.hash !== beforeAnchor.hash;
      changes.push({
        heading,
        change: 'acceptance-changed',
        // 改写比新增危险：id 不变但语义变了，旧验收结论会被错误地继承。
        severity: delta.removed.length > 0 || delta.rewritten.length > 0 ? 'high' : 'medium',
        detail:
          '验收项变化: 新增 ' +
          (delta.added.join(',') || '(none)') +
          '，删除 ' +
          (delta.removed.join(',') || '(none)') +
          '，改写 ' +
          (delta.rewritten.join(',') || '(none)') +
          (bodyAlsoChanged ? '；anchor 正文同时有变化' : ''),
      });
      continue;
    }

    if (afterAnchor.hash !== beforeAnchor.hash) {
      changes.push({
        heading,
        change: 'modified',
        severity: 'medium',
        detail: 'anchor 正文变化: ' + heading,
      });
    }
  }

  for (const [heading, afterAnchor] of afterIndex) {
    if (beforeIndex.has(heading)) continue;
    const isRenameTarget = [...beforeIndex.values()].some((value) => value.hash === afterAnchor.hash);
    if (isRenameTarget) continue;
    changes.push({
      heading,
      change: 'added',
      severity: 'low',
      detail: '新增 anchor: ' + relativePath + '#' + heading,
    });
  }

  return changes.sort((left, right) => left.heading.localeCompare(right.heading));
}

function taskFromDrift(entry: SpecDriftEntry): SpecImpactTask {
  return {
    goal: entry.goal,
    task: entry.task,
    task_status: entry.task_status,
    anchor: entry.spec_anchor,
    change: entry.kind,
    severity: entry.severity,
    message: entry.message,
    acceptance_added: entry.acceptance_added,
    acceptance_removed: entry.acceptance_removed,
  };
}

export interface AnalyzeSpecImpactOptions {
  now?: Date;
  /**
   * 追加一个「提案覆盖层」：键为 specs/ 相对路径，值为提案内容。
   * 用于在归档前评估 changes/<name>/specs/ 的影响。
   */
  overlay?: Record<string, string>;
}

export async function analyzeSpecImpact(
  projectRoot: string,
  options: AnalyzeSpecImpactOptions = {},
): Promise<SpecImpactReport> {
  const overlay = options.overlay ?? {};
  const resolveContent = async (specRef: string): Promise<string | null> => {
    if (Object.prototype.hasOwnProperty.call(overlay, specRef)) return overlay[specRef];
    const absolute = path.join(projectRoot, specRef);
    if (!(await pathExists(absolute))) return null;
    return readTextFile(absolute);
  };

  const [diff, drift] = await Promise.all([
    diffSpecs(projectRoot),
    collectSpecDrift(projectRoot, { resolveContent }),
  ]);

  const overlayPaths = Object.keys(overlay);

  const driftedByPath = new Map<string, SpecDriftEntry[]>();
  for (const entry of drift.drift) {
    const list = driftedByPath.get(entry.spec_ref) ?? [];
    list.push(entry);
    driftedByPath.set(entry.spec_ref, list);
  }

  const changedPaths = new Set<string>([
    ...diff.added.map((entry) => entry.path),
    ...diff.modified.map((entry) => entry.path),
    ...diff.removed.map((entry) => entry.path),
    ...overlayPaths,
    ...driftedByPath.keys(),
  ]);

  const files: SpecImpactFile[] = [];
  const untrackedChanges: string[] = [];

  for (const relativePath of [...changedPaths].sort()) {
    const hasOverlay = Object.prototype.hasOwnProperty.call(overlay, relativePath);
    const baseline = await latestSpecVersionContent(projectRoot, relativePath);
    const afterContent = hasOverlay ? overlay[relativePath] : await resolveContent(relativePath);
    const fileChange: SpecImpactFile['file_change'] = hasOverlay
      ? baseline === null
        ? 'added'
        : 'modified'
      : afterContent === null || diff.removed.some((entry) => entry.path === relativePath)
        ? 'removed'
        : baseline === null || diff.added.some((entry) => entry.path === relativePath)
          ? 'added'
          : 'modified';

    let anchors: SpecImpactAnchor[] = [];
    if (afterContent === null) {
      if (baseline) {
        const before = parseSpecContent(baseline.content, relativePath);
        anchors = before.anchors.map((anchor) => ({
          heading: anchor.heading,
          change: 'removed' as const,
          severity: 'high' as const,
          detail: 'spec 文件被删除: ' + relativePath,
        }));
      }
    } else if (baseline === null) {
      const parsed = parseSpecContent(afterContent, relativePath);
      anchors = parsed.anchors.map((anchor) => ({
        heading: anchor.heading,
        change: 'added' as const,
        severity: 'low' as const,
        detail: '新增 spec 文件中的 anchor',
      }));
    } else {
      const before = parseSpecContent(baseline.content, relativePath);
      const after = parseSpecContent(afterContent, relativePath);
      if (hashSpecText(afterContent) !== baseline.record.hash) {
        anchors = diffAnchors(relativePath, before, after);
      }
    }

    // `file-changed-anchor-unchanged` 表示本任务绑定的 anchor 没受影响，
    // 它只说明「文件动过」，不应算进受影响任务，否则影响面会被系统性高估。
    const driftEntries = driftedByPath.get(relativePath) ?? [];
    const affectedTasks = driftEntries
      .filter((entry) => entry.kind !== 'file-changed-anchor-unchanged')
      .map(taskFromDrift);
    if (driftEntries.length === 0) untrackedChanges.push(relativePath);

    const severity = maxSeverity([
      ...anchors.map((anchor) => anchor.severity),
      ...affectedTasks.map((task) => task.severity),
    ]);
    files.push({ path: relativePath, file_change: fileChange, anchors, affected_tasks: affectedTasks, severity });
  }

  const affectedTasks = files.flatMap((file) => file.affected_tasks);
  return {
    schema: SPEC_IMPACT_SCHEMA,
    generated_at: (options.now ?? new Date()).toISOString(),
    files,
    affected_tasks: affectedTasks,
    untracked_changes: untrackedChanges,
    summary: {
      files_changed: files.length,
      anchors_changed: files.reduce((total, file) => total + file.anchors.length, 0),
      tasks_affected: affectedTasks.length,
      highest_severity: maxSeverity(files.map((file) => file.severity)),
    },
  };
}

export function formatSpecImpact(report: SpecImpactReport): string[] {
  const lines: string[] = [];
  lines.push(
    'spec impact: files=' +
      report.summary.files_changed +
      ' anchors=' +
      report.summary.anchors_changed +
      ' tasks=' +
      report.summary.tasks_affected +
      ' severity=' +
      report.summary.highest_severity,
  );
  for (const file of report.files) {
    lines.push('[' + file.severity.toUpperCase() + '] ' + file.file_change + ' ' + file.path);
    for (const anchor of file.anchors) {
      lines.push('  - ' + anchor.change + ' ' + anchor.heading + ' (' + anchor.severity + '): ' + anchor.detail);
    }
    for (const task of file.affected_tasks) {
      lines.push('  * ' + task.task + ' ' + task.change + ' (' + task.severity + '): ' + task.message);
    }
  }
  for (const path of report.untracked_changes) {
    lines.push('warning: ' + path + ' 变化但没有任何冻结任务引用它');
  }
  if (report.files.length === 0) lines.push('no spec changes detected against the recorded baseline');
  return lines;
}
