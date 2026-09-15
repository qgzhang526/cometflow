import path from 'node:path';
import { parse } from 'yaml';
import { promises as fs } from 'node:fs';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';
import { hashSpecText } from './spec-hash.js';
import { listSpecFiles } from './spec-index.js';
import { parseSpecContent } from './spec-parse.js';
import { diffSpecs, readSpecLock } from './spec-lock.js';
import { hasSpecBlob, latestSpecVersion, readSpecBlob } from './spec-version.js';
import { listChangeStates } from '../workflow/change-list.js';
import { diffChangeSpecBaseline, readChangeSpecBaseline } from '../workflow/change-spec-baseline.js';
import { verifyChangeStateHash, verifyPlanHash } from '../state/canonical-hash.js';
import { resolveConcurrencyPolicy } from '../project/concurrency.js';
import type { TaskPlan } from '../task-plan/types.js';

export const SPEC_VERIFY_SCHEMA = 'cometflow.spec-verify.v1';

export type SpecVerifyCode =
  | 'missing-spec-lock'
  | 'stale-spec-lock'
  | 'missing-spec-version'
  | 'missing-version-blob'
  | 'duplicate-anchor'
  | 'anchor-drift'
  | 'acceptance-drift'
  | 'frozen-anchor-missing'
  | 'change-base-conflict'
  | 'plan-integrity'
  | 'change-state-integrity'
  | 'concurrency-warn-expired';

export interface SpecVerifyFinding {
  severity: 'error' | 'warning';
  code: SpecVerifyCode;
  subject: string;
  message: string;
}

export interface SpecVerifyResult {
  schema: typeof SPEC_VERIFY_SCHEMA;
  valid: boolean;
  findings: SpecVerifyFinding[];
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

function acceptanceFor(content: string, heading: string): { id: string; text: string }[] {
  const parsed = parseSpecContent(content, 'memory://spec');
  const anchor = parsed.anchors.find((entry) => entry.heading === heading);
  if (!anchor) return [];
  const items = anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance;
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function sameAcceptance(
  left: { id: string; text: string }[],
  right: { id: string; text: string }[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 一致性门禁：回答「spec 是否仍然是唯一的、可重建代码的事实源」。
 *
 * 它检查四件事，每一条都对应一次真实的失效模式：
 * 1. spec-lock 与 specs/ 同步 —— 否则 diff/impact 的基线是错的；
 * 2. 每个冻结任务引用的 spec_hash 在版本仓里有对应内容 —— 否则「代码丢了能重建」是假的；
 * 3. anchor 唯一且冻结的 anchor 没漂移 —— 否则任务与 spec 的对应关系已经断了；
 * 4. 活跃 change 的 spec 基线与 canonical 一致 —— 否则归档会覆盖别人的 spec 改动。
 */
export async function verifySpecIntegrity(projectRoot: string): Promise<SpecVerifyResult> {
  const findings: SpecVerifyFinding[] = [];
  const files = await listSpecFiles(projectRoot);

  // 并发写策略的到期检查放在门禁里：`warn` 是有期限的过渡态，到期后必须显式决策
  // （切 fail 或延长并写理由），否则这里会一直红着——这正是「不会忘」的实现方式（ADR 0021）。
  const policy = await resolveConcurrencyPolicy(projectRoot);
  if (policy.expired) {
    findings.push({
      severity: 'error',
      code: 'concurrency-warn-expired',
      subject: '.cometflow/config.yaml',
      message:
        'concurrency.warnUntil 已过期（' +
        (policy.warnUntil ?? '?') +
        '）：warn 只是过渡态，请切换 concurrency.specWrites: fail，或显式延长 warnUntil 并写下 warnReason',
    });
  }

  const lock = await readSpecLock(projectRoot);
  if (!lock) {
    findings.push({
      severity: 'error',
      code: 'missing-spec-lock',
      subject: '.cometflow/spec-lock.json',
      message: '缺少 spec-lock；运行 cometflow spec lock 建立基线',
    });
  } else {
    const diff = await diffSpecs(projectRoot);
    for (const entry of [...diff.added, ...diff.modified, ...diff.removed]) {
      findings.push({
        severity: 'error',
        code: 'stale-spec-lock',
        subject: entry.path,
        message: 'spec 与 spec-lock 不一致；运行 cometflow spec lock 或 cometflow spec diff --impact 评估影响',
      });
    }
  }

  const anchorsByPath = new Map<string, ReturnType<typeof parseSpecContent>>();
  const contentByPath = new Map<string, string>();
  for (const relativePath of files) {
    const content = await readTextFile(path.join(projectRoot, relativePath));
    const parsed = parseSpecContent(content, relativePath);
    anchorsByPath.set(relativePath, parsed);
    contentByPath.set(relativePath, content);

    const seen = new Map<string, number>();
    for (const anchor of parsed.anchors) {
      seen.set(anchor.heading, (seen.get(anchor.heading) ?? 0) + 1);
    }
    for (const [heading, count] of seen) {
      if (count > 1) {
        findings.push({
          severity: 'error',
          code: 'duplicate-anchor',
          subject: relativePath + '#' + heading,
          message: '同一 spec 文件中 anchor 标题重复 ' + count + ' 次；anchor 必须唯一才能绑定任务',
        });
      }
    }

    const version = await latestSpecVersion(projectRoot, relativePath);
    if (!version) {
      findings.push({
        severity: 'warning',
        code: 'missing-spec-version',
        subject: relativePath,
        message: '该 spec 还没有登记版本；运行 cometflow spec lock 登记',
      });
    } else if (version.hash !== hashSpecText(content)) {
      findings.push({
        severity: 'warning',
        code: 'missing-spec-version',
        subject: relativePath,
        message: '当前内容尚未登记为新版本；运行 cometflow spec lock 登记',
      });
    }
  }

  for (const file of await listPlanFiles(projectRoot)) {
    let plan: TaskPlan;
    try {
      plan = parse(await fs.readFile(path.join(projectRoot, '.cometflow', 'plans', file), 'utf8')) as TaskPlan;
    } catch {
      continue;
    }
    // 计划被手工改写（内容与 plan_hash 不符）意味着「冻结关联」不再可信。
    const planIssue = verifyPlanHash(plan as unknown as Record<string, unknown>);
    if (planIssue) {
      findings.push({
        severity: 'error',
        code: 'plan-integrity',
        subject: file,
        message: planIssue + '；计划被改写后必须重新 validate/freeze，不要直接编辑机器生成文件',
      });
    }
    for (const task of plan.tasks) {
      if (task.status !== 'frozen' && task.status !== 'approved') continue;
      if (!task.spec_ref || !task.spec_hash) continue;

      if (!(await hasSpecBlob(projectRoot, task.spec_hash))) {
        findings.push({
          severity: 'error',
          code: 'missing-version-blob',
          subject: `${plan.goal}/${task.id}`,
          message:
            '冻结内容在版本仓中缺失 (' +
            task.spec_hash.slice(0, 12) +
            ')；该任务无法在代码丢失后按冻结版本重建',
        });
      }

      const parsed = anchorsByPath.get(task.spec_ref);
      if (!parsed) {
        findings.push({
          severity: 'error',
          code: 'frozen-anchor-missing',
          subject: `${plan.goal}/${task.id}`,
          message: '任务引用的 spec 文件不存在: ' + task.spec_ref,
        });
        continue;
      }
      const anchor = parsed.anchors.find((entry) => entry.heading === task.spec_anchor);
      if (!anchor) {
        findings.push({
          severity: 'error',
          code: 'frozen-anchor-missing',
          subject: `${plan.goal}/${task.id}`,
          message: '任务引用的 anchor 已不存在: ' + (task.spec_anchor ?? '(null)'),
        });
        continue;
      }
      if (task.anchor_hash && anchor.hash !== task.anchor_hash) {
        findings.push({
          severity: 'error',
          code: 'anchor-drift',
          subject: `${plan.goal}/${task.id}`,
          message:
            'anchor 内容已漂移: ' +
            task.spec_ref +
            '#' +
            (task.spec_anchor ?? '') +
            '（冻结 ' +
            task.anchor_hash.slice(0, 12) +
            ' → 当前 ' +
            anchor.hash.slice(0, 12) +
            '）',
        });
      }

      if (task.spec_anchor && task.spec_hash) {
        const frozen = await readSpecBlob(projectRoot, task.spec_hash);
        const current = contentByPath.get(task.spec_ref);
        if (frozen !== null && current !== undefined) {
          const before = acceptanceFor(frozen, task.spec_anchor);
          const after = acceptanceFor(current, task.spec_anchor);
          if (before.length > 0 && !sameAcceptance(before, after)) {
            findings.push({
              severity: 'error',
              code: 'acceptance-drift',
              subject: `${plan.goal}/${task.id}`,
              message:
                '验收项已漂移: ' +
                task.spec_ref +
                '#' +
                task.spec_anchor +
                '；冻结 ' +
                before.map((item) => item.id).join(',') +
                ' → 当前 ' +
                after.map((item) => item.id).join(',') +
                '。仅比对 id 会漏掉验收项语义改写，必须重新冻结后再验证。',
            });
          }
        }
      }
    }
  }

  for (const change of await listChangeStates(projectRoot)) {
    const stateIssue = verifyChangeStateHash(change as unknown as Record<string, unknown>);
    if (stateIssue) {
      findings.push({
        severity: 'error',
        code: 'change-state-integrity',
        subject: change.name,
        message: stateIssue + '；change 状态被改写，请改用 cometflow change transition 推进',
      });
    }
    if (change.archived) continue;
    const baseline = await readChangeSpecBaseline(projectRoot, change.name);
    if (baseline) {
      const targets = change.spec_ref ? [change.spec_ref] : [];
      if (targets.length === 0) continue;
      for (const conflict of await diffChangeSpecBaseline(projectRoot, baseline, targets)) {
        findings.push({
          severity: 'error',
          code: 'change-base-conflict',
          subject: change.name,
          message:
            'canonical spec 自 change 创建后已变化 (' +
            conflict.path +
            '，' +
            conflict.kind +
            ')：基线 ' +
            (conflict.expected ? conflict.expected.slice(0, 12) : 'missing') +
            ' → 当前 ' +
            (conflict.actual ? conflict.actual.slice(0, 12) : 'missing') +
            '；归档会覆盖该变更，请先 cometflow spec diff --impact 评估，再用 cometflow change rebase ' +
            change.name,
        });
      }
      continue;
    }
    const target = change.spec_ref;
    if (!target || change.spec_base_hash === undefined || change.spec_base_hash === null) continue;
    const absolute = path.join(projectRoot, target);
    let currentHash: string | null = null;
    if (await pathExists(absolute)) {
      currentHash = hashSpecText(await readTextFile(absolute));
    }
    if (currentHash !== change.spec_base_hash) {
      findings.push({
        severity: 'error',
        code: 'change-base-conflict',
        subject: change.name,
        message:
          'canonical spec 自 change 创建后已变化 (' +
          target +
          ')：基线 ' +
          change.spec_base_hash.slice(0, 12) +
          ' → 当前 ' +
          (currentHash ? currentHash.slice(0, 12) : 'missing') +
          '；归档会覆盖该变更，请先 cometflow change rebase ' +
          change.name,
      });
    }
  }

  return {
    schema: SPEC_VERIFY_SCHEMA,
    valid: findings.every((finding) => finding.severity !== 'error'),
    findings,
  };
}
