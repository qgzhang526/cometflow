import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { readTextFile } from '../../platform/fs/read-file.js';
import { hashSpecText } from './spec-hash.js';
import { parseSpecContent } from './spec-parse.js';
import { readSpecBlob } from './spec-version.js';
import type { TaskPlan } from '../task-plan/types.js';

export type SpecDriftKind =
  | 'anchor-modified'
  | 'anchor-removed'
  | 'anchor-renamed'
  | 'acceptance-changed'
  | 'file-changed-anchor-unchanged'
  | 'unknown';

export type SpecDriftSeverity = 'low' | 'medium' | 'high';

export interface SpecDriftEntry {
  goal: string;
  task: string;
  /** 该任务在 task plan 中的状态（frozen / approved）。 */
  task_status: string;
  spec_ref: string;
  spec_anchor: string | null;
  frozen_hash: string;
  current_hash: string;
  /** 漂移分类：锚点被改 / 被删 / 被改名 / 验收项变化 / 仅文件其他位置变化。 */
  kind: SpecDriftKind;
  severity: SpecDriftSeverity;
  frozen_anchor_hash: string | null;
  current_anchor_hash: string | null;
  /** kind=anchor-renamed 时，正文哈希相同的新标题。 */
  renamed_to: string | null;
  acceptance_added: string[];
  acceptance_removed: string[];
  /** 冻结内容的来源：版本仓（可信）或当前文件（版本仓缺 blob 时的降级）。 */
  frozen_source: 'version-store' | 'current-file' | null;
  message: string;
}

export interface SpecDriftReport {
  drift: SpecDriftEntry[];
  scannedTasks: number;
  /** 冻结任务引用了 spec_hash，但版本仓里找不到对应内容，无法做锚点级比对。 */
  unresolvable: { goal: string; task: string; spec_ref: string; frozen_hash: string }[];
}

export interface CollectSpecDriftOptions {
  /**
   * 覆盖 spec 内容来源。用于「change 归档前预览影响」：
   * 传入 changes/<name>/specs 的提案内容，就能算出归档后谁会漂移，
   * 而不需要先把提案写进 specs/。返回 null 表示该 spec 文件不存在。
   */
  resolveContent?: (specRef: string) => Promise<string | null>;
}

async function listPlanFiles(projectRoot: string): Promise<string[]> {
  const dir = path.join(projectRoot, '.cometflow', 'plans');
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((entry) => entry.endsWith('.task-plan.yaml')).sort();
  } catch {
    return [];
  }
}

function acceptanceIds(content: string, anchorHeading: string | null): { ids: string[]; texts: Map<string, string> } {
  const parsed = parseSpecContent(content, 'memory://spec');
  const anchor = anchorHeading
    ? parsed.anchors.find((entry) => entry.heading === anchorHeading)
    : undefined;
  const items = anchor && anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance;
  return { ids: items.map((item) => item.id), texts: new Map(items.map((item) => [item.id, item.text])) };
}

function classify(input: {
  frozenContent: string | null;
  currentContent: string;
  specAnchor: string | null;
  frozenAnchorHash: string | null;
}): Pick<
  SpecDriftEntry,
  'kind' | 'severity' | 'frozen_anchor_hash' | 'current_anchor_hash' | 'renamed_to' | 'acceptance_added' | 'acceptance_removed' | 'frozen_source' | 'message'
> {
  const current = parseSpecContent(input.currentContent, 'memory://spec');
  const currentAnchor = input.specAnchor
    ? current.anchors.find((entry) => entry.heading === input.specAnchor)
    : undefined;
  const empty = {
    frozen_anchor_hash: input.frozenAnchorHash,
    current_anchor_hash: currentAnchor?.hash ?? null,
    renamed_to: null as string | null,
    acceptance_added: [] as string[],
    acceptance_removed: [] as string[],
    frozen_source: null as 'version-store' | 'current-file' | null,
  };

  if (input.frozenContent === null) {
    return {
      ...empty,
      kind: 'unknown',
      severity: 'high',
      message: '版本仓缺少冻结内容，无法做锚点级比对；请检查 .cometflow/spec-versions',
    };
  }

  const frozen = parseSpecContent(input.frozenContent, 'memory://frozen');
  const frozenAnchor = input.specAnchor
    ? frozen.anchors.find((entry) => entry.heading === input.specAnchor)
    : undefined;
  const frozenAcceptance = acceptanceIds(input.frozenContent, input.specAnchor);
  const currentAcceptance = acceptanceIds(input.currentContent, input.specAnchor);

  const added = currentAcceptance.ids.filter((id) => !frozenAcceptance.texts.has(id));
  const removed = frozenAcceptance.ids.filter((id) => !currentAcceptance.texts.has(id));
  const textsChanged = currentAcceptance.ids.some((id) => {
    const before = frozenAcceptance.texts.get(id);
    return before !== undefined && before !== currentAcceptance.texts.get(id);
  });
  const acceptanceChanged = added.length > 0 || removed.length > 0 || textsChanged;

  const shared = {
    ...empty,
    frozen_anchor_hash: frozenAnchor?.hash ?? input.frozenAnchorHash,
    current_anchor_hash: currentAnchor?.hash ?? null,
    acceptance_added: added,
    acceptance_removed: removed,
    frozen_source: 'version-store' as const,
  };

  if (!currentAnchor) {
    const renamed = frozenAnchor
      ? current.anchors.find((entry) => entry.hash === frozenAnchor.hash)
      : undefined;
    if (renamed) {
      return {
        ...shared,
        kind: 'anchor-renamed',
        severity: acceptanceChanged ? 'high' : 'medium',
        renamed_to: renamed.heading,
        message: 'anchor 被重命名: ' + (input.specAnchor ?? '(none)') + ' → ' + renamed.heading,
      };
    }
    return {
      ...shared,
      kind: 'anchor-removed',
      severity: 'high',
      renamed_to: null,
      message: 'anchor 已从 spec 中删除: ' + (input.specAnchor ?? '(none)'),
    };
  }

  if (acceptanceChanged) {
    const bodyAlsoChanged = Boolean(frozenAnchor && currentAnchor.hash !== frozenAnchor.hash);
    return {
      ...shared,
      kind: 'acceptance-changed',
      // 删除或改写已有验收项都判高危：id 不变而语义变化时，旧结论会被误用。
      severity: removed.length > 0 || textsChanged ? 'high' : 'medium',
      message:
        'anchor 的验收项变化: 新增 ' +
        (added.join(',') || '(none)') +
        '，删除 ' +
        (removed.join(',') || '(none)') +
        (textsChanged ? '，部分验收项文本被修改' : '') +
        (bodyAlsoChanged ? '；anchor 正文同时有变化' : ''),
    };
  }

  if (frozenAnchor && currentAnchor.hash !== frozenAnchor.hash) {
    return {
      ...shared,
      kind: 'anchor-modified',
      severity: 'medium',
      message: 'anchor 正文被修改: ' + currentAnchor.heading,
    };
  }

  return {
    ...shared,
    kind: 'file-changed-anchor-unchanged',
    severity: 'low',
    message: 'spec 文件其他位置变化，本任务绑定的 anchor 未受影响',
  };
}

export async function collectSpecDrift(
  projectRoot: string,
  options: CollectSpecDriftOptions = {},
): Promise<SpecDriftReport> {
  const planFiles = await listPlanFiles(projectRoot);
  const drift: SpecDriftEntry[] = [];
  const unresolvable: SpecDriftReport['unresolvable'] = [];
  let scannedTasks = 0;

  for (const file of planFiles) {
    let plan: TaskPlan;
    try {
      const source = await fs.readFile(path.join(projectRoot, '.cometflow', 'plans', file), 'utf8');
      plan = parse(source) as TaskPlan;
    } catch {
      continue;
    }

    for (const task of plan.tasks) {
      if (task.status !== 'frozen' && task.status !== 'approved') continue;
      if (!task.spec_ref || !task.spec_hash) continue;
      scannedTasks += 1;
      let currentContent: string | null;
      try {
        currentContent = options.resolveContent
          ? await options.resolveContent(task.spec_ref)
          : await readTextFile(path.join(projectRoot, task.spec_ref));
      } catch {
        currentContent = null;
      }
      if (currentContent === null) {
        drift.push({
          goal: plan.goal,
          task: task.id,
          task_status: task.status,
          spec_ref: task.spec_ref,
          spec_anchor: task.spec_anchor,
          frozen_hash: task.spec_hash,
          current_hash: '(missing)',
          kind: 'anchor-removed',
          severity: 'high',
          frozen_anchor_hash: task.anchor_hash ?? null,
          current_anchor_hash: null,
          renamed_to: null,
          acceptance_added: [],
          acceptance_removed: [],
          frozen_source: null,
          message: 'spec 文件已不存在: ' + task.spec_ref,
        });
        continue;
      }
      const currentHash = hashSpecText(currentContent);
      if (currentHash === task.spec_hash) continue;

      const frozenContent = await readSpecBlob(projectRoot, task.spec_hash);
      if (frozenContent === null) {
        unresolvable.push({
          goal: plan.goal,
          task: task.id,
          spec_ref: task.spec_ref,
          frozen_hash: task.spec_hash,
        });
      }
      const classification = classify({
        frozenContent: frozenContent ?? currentContent,
        currentContent,
        specAnchor: task.spec_anchor,
        frozenAnchorHash: task.anchor_hash ?? null,
      });
      drift.push({
        goal: plan.goal,
        task: task.id,
        task_status: task.status,
        spec_ref: task.spec_ref,
        spec_anchor: task.spec_anchor,
        frozen_hash: task.spec_hash,
        current_hash: currentHash,
        ...classification,
        frozen_source: frozenContent === null ? classification.frozen_source : 'version-store',
      });
    }
  }

  return { drift, scannedTasks, unresolvable };
}
