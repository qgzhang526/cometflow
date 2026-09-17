import path from 'node:path';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';
import { parseSpecContent } from '../spec/spec-parse.js';
import { readSpecBlob } from '../spec/spec-version.js';
import { evalManifestPath } from '../eval/eval-service.js';
import { getBuiltInAgentRunner } from '../../platform/agents/registry.js';
import type { ProjectConfig } from '../project/config.js';
import type { TaskRecord } from '../task-plan/types.js';

/**
 * 无人值守前置检查（P4 后续）：**验收能不能被自动判定**。
 *
 * 起因是一个白烧预算的死循环：默认配置（`mode: checks`、`verifier_policy: warn`）下，
 * 只有文字、没有 `check:` 的验收项判不出来 → 一律 `blocked` → 验收不过 → 重试到上限，
 * 或者因为「反复同一失败结论」把 change 置 blocked 停机。既然结局注定是 blocked，
 * 那就**在执行之前**判掉：任务直接失败、daemon 停机，把时间留给人把 spec 补成可判定的。
 *
 * 判定标准是「至少有一条兜底」：spec 里每条验收都有可执行 `check:`，或项目配了 eval，
 * 或配置了独立 Verifier（`checks+agent` / `agent-required` 且 agent 可用）。
 */

export type PreflightVerdict = 'ok' | 'unverifiable' | 'skipped';

export interface PreflightResult {
  verdict: PreflightVerdict;
  reason: string;
  /** 没有可判定来源的验收项 id。 */
  uncovered: string[];
  /** 这条任务能用的兜底来源（eval / verifier）。 */
  fallbacks: string[];
  /** 配置里的策略（未配置等价 fail）。 */
  policy: 'fail' | 'warn' | 'off';
}

function policyOf(config: ProjectConfig): 'fail' | 'warn' | 'off' {
  return config.verification?.unattended_preflight ?? 'fail';
}

async function fallbacksFor(projectRoot: string, config: ProjectConfig): Promise<string[]> {
  const fallbacks: string[] = [];
  if (await pathExists(evalManifestPath(projectRoot))) fallbacks.push('eval');

  const mode = config.verification?.mode ?? 'checks';
  if (mode === 'checks+agent' || mode === 'agent-required') {
    const agentId = config.verification?.agent ?? config.agent ?? null;
    if (agentId !== null) {
      try {
        // 只探一次可用性：不可用时 verify 阶段会按 verifier_policy 处理，这里不重复判断。
        if (await getBuiltInAgentRunner(agentId).check()) fallbacks.push('verifier:' + agentId);
      } catch {
        // 未知 agent：不算兜底。
      }
    }
  }
  return fallbacks;
}

export interface PreflightOptions {
  projectRoot: string;
  task: Pick<TaskRecord, 'kind' | 'spec_ref' | 'spec_anchor' | 'spec_hash'>;
  config: ProjectConfig;
}

export async function preflightTask(options: PreflightOptions): Promise<PreflightResult> {
  const policy = policyOf(options.config);
  if (policy === 'off') {
    return { verdict: 'skipped', reason: 'unattended_preflight=off', uncovered: [], fallbacks: [], policy };
  }
  // 起草类任务没有 acceptance 可判定，它由 G4 的产物护栏负责。
  if (options.task.kind === 'spec-authoring' || !options.task.spec_ref) {
    return { verdict: 'skipped', reason: 'spec-authoring 任务由产物护栏负责', uncovered: [], fallbacks: [], policy };
  }

  const content =
    (options.task.spec_hash ? await readSpecBlob(options.projectRoot, options.task.spec_hash) : null) ??
    (await pathExists(path.join(options.projectRoot, options.task.spec_ref))
      ? await readTextFile(path.join(options.projectRoot, options.task.spec_ref))
      : null);
  if (content === null) {
    return {
      verdict: 'unverifiable',
      reason: '读不到 spec 内容：' + options.task.spec_ref,
      uncovered: [],
      fallbacks: [],
      policy,
    };
  }

  const parsed = parseSpecContent(content, options.task.spec_ref);
  const anchor = options.task.spec_anchor
    ? parsed.anchors.find((entry) => entry.heading === options.task.spec_anchor)
    : undefined;
  const acceptance = anchor && anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance;
  const uncovered = acceptance.filter((item) => item.check === null).map((item) => item.id);

  if (uncovered.length === 0) {
    return { verdict: 'ok', reason: '每条验收都有可执行 check', uncovered: [], fallbacks: [], policy };
  }

  const fallbacks = await fallbacksFor(options.projectRoot, options.config);
  if (fallbacks.length > 0) {
    return {
      verdict: 'ok',
      reason: '有 ' + fallbacks.join(' / ') + ' 兜底未覆盖的 ' + uncovered.length + ' 项',
      uncovered,
      fallbacks,
      policy,
    };
  }

  return {
    verdict: 'unverifiable',
    reason:
      '验收无法自动判定：' +
      uncovered.join(', ') +
      ' 既没有可执行 check，也没有 eval 或独立 Verifier 兜底（跑到最后必然是 blocked）',
    uncovered,
    fallbacks,
    policy,
  };
}
