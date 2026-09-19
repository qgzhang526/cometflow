import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentRunner } from '../../platform/agents/types.js';
import { pathExists } from '../../platform/fs/read-file.js';
import { toPosix } from '../../platform/paths/relative.js';
import { runLocalEval } from '../eval/eval-service.js';
import { ROOT_KIND_FILES } from '../spec/kind.js';
import { capabilitySpecFile } from '../spec/spec-index.js';
import { readGoalRecord } from '../goal/goal-sync.js';
import { validateSpecs } from '../spec/spec-validate.js';
import { extractAnchorSection, parseSpecContent } from '../spec/spec-parse.js';
import { normalizeModulePath, parseSpecMeta } from '../spec/spec-meta.js';
import { gatherSpecAuthoringHints, renderSpecAuthoringInputs } from './spec-authoring-inputs.js';
import { hashSpecText } from '../spec/spec-hash.js';
import { readSpecBlob, recordSpecVersion, refreshSpecBaseline } from '../spec/spec-version.js';
import { readTextFile } from '../../platform/fs/read-file.js';
import {
  readProjectConfig,
  resolveModel,
  type VerificationMode,
  type VerifierPolicy,
} from '../project/config.js';
import { redactSecrets } from '../../platform/io/redact.js';
import { acquireLock } from '../../platform/fs/file-lock.js';
import { canonicalHash } from '../state/canonical-hash.js';
import { describeDriftFailure, enforceGitProvenance } from './git-provenance.js';
import { clearCurrentChange } from './current-change.js';
import { commitTransition, readChangeState, writeChangeState } from './change-store.js';
import { applyChangeTransition } from './change-transitions.js';
import { appendChangeEvent } from './change-journal.js';
import { runAcceptanceChecks, type AcceptanceCheckReport } from './change-checks.js';
import { runIndependentVerifier } from './change-verifier.js';
import {
  captureImplementationBaseline,
  collectImplementationScope,
  resolveScopeAllow,
  type ImplementationScopeReport,
} from './implementation-scope.js';
import {
  captureChangeSpecBaseline,
  diffChangeSpecBaseline,
  readChangeSpecBaseline,
} from './change-spec-baseline.js';
import type { ChangeState } from './change-types.js';
import {
  allAcceptancePassed,
  readVerificationDocument,
  validateVerificationDocument,
} from './verification.js';

export interface ChangeRunOutcome {
  state: ChangeState;
  agentExitCode: number;
}

export interface DriftGuardOptions {
  /** 显式忽略来源漂移（CLI --allow-drift）。 */
  allowDrift?: boolean;
}

/**
 * 推进前的来源守卫：漂移时阻断，并给出恢复路径。
 * 放行（配置或 flag）时会记一条审核流水，保证「谁决定忽略漂移」可追溯。
 */
async function assertGitProvenance(
  projectRoot: string,
  name: string,
  state: ChangeState,
  options: DriftGuardOptions,
): Promise<void> {
  const config = await readProjectConfig(projectRoot);
  const enforcement = await enforceGitProvenance(projectRoot, state, {
    allowDrift: options.allowDrift,
    configAllowsDrift: config.git?.allow_drift === true,
  });
  if (!enforcement.allowed) {
    throw new Error(describeDriftFailure(name, enforcement.report));
  }
  if (enforcement.override) {
    await appendChangeEvent(projectRoot, name, 'git-drift-overridden', {
      override: enforcement.override,
      status: enforcement.report.status,
      base_commit: enforcement.report.base_commit,
      current_head: enforcement.report.current_head,
      detail: enforcement.report.detail,
    }, { phase: state.phase });
  }
}

export class SpecConflictError extends Error {
  readonly conflicts: { path: string; expected: string | null; actual: string | null; kind: string }[];

  constructor(name: string, conflicts: { path: string; expected: string | null; actual: string | null; kind: string }[]) {
    super(
      'spec conflict while archiving ' +
        name +
        ': ' +
        conflicts
          .map((entry) => entry.path + ' (' + entry.kind + ')')
          .join(', ') +
        '；canonical spec 在 change 存续期间被改动。请先 cometflow spec diff --impact 评估，' +
        '再用 cometflow change rebase ' +
        name +
        ' 接受新基线，或按 ADR 0004 创建 reconciliation change。',
    );
    this.name = 'SpecConflictError';
    this.conflicts = conflicts;
  }
}

/**
 * 起草类 change（`task_kind: spec-authoring`）的收口护栏（G4）。
 *
 * 这类 change 没有 spec_ref，`validateVerifierCoverage` 拿空 acceptance_ids 对照，
 * 于是「覆盖 0 条」也算通过——可它真正要交付的就是那份 spec 本身。
 * 所以验证与归档前都必须确认：产物存在，且 `spec validate` 对它没有 error。
 *
 * 注意不在 `plan freeze` 拦：冻结发生在起草之前（spec 缺失正是产生这条任务的原因），
 * 在那里要求产物存在等于让这条路走不通。
 */
async function assertAuthoredSpecReady(projectRoot: string, state: ChangeState): Promise<void> {
  if (state.task_kind !== 'spec-authoring') return;
  if (!state.capability) {
    throw new Error('起草 change ' + state.name + ' 未记录 capability，无法确认产物路径');
  }
  const target = capabilitySpecFile(state.capability);
  if (!(await pathExists(path.join(projectRoot, target)))) {
    throw new Error(
      '起草 change ' + state.name + ' 的产物还不存在：' + target +
        '；先写出 spec（front-matter 带 status: draft）再验收 / 归档',
    );
  }
  const errors = (await validateSpecs(projectRoot)).findings.filter(
    (finding) => finding.path === target && finding.severity === 'error',
  );
  if (errors.length > 0) {
    throw new Error(
      '起草 change ' + state.name + ' 的产物未通过 spec validate（' + errors.length + ' 条 error）：' +
        errors.map((finding) => finding.code).join(', ') + '；修好 ' + target + ' 再验收 / 归档',
    );
  }
}

/**
 * 起草类任务（`kind: spec-authoring`）没有可冻结的契约——它要产出的正是那份 spec（G4）。
 *
 * 过去这里直接返回空段落，Agent 只拿到 `brief.md` 的一行标题，等于让它凭空写契约。
 * 现在至少把「这份 capability 服务于哪个 goal、成功标准与非目标是什么」交底，
 * 并要求产物带 `status: draft`：起草件必须走 G1 的定稿关口才能被冻结绑定。
 */
async function specAuthoringSection(projectRoot: string, state: ChangeState): Promise<string[]> {
  const target = state.capability ? capabilitySpecFile(state.capability) : 'specs/<capability>/spec.md';
  const lines: string[] = [
    '## Spec authoring',
    '本次任务的产物是契约本身（' + target + '），没有可绑定的冻结 spec。',
    '',
    '要求：',
    '- 每个需求一个 `## <anchor>` 段落，段落内给出可判定的验收（`## 验收` 下的 `- A<n>：…`）；',
    '- front-matter 写 `capability: ' + (state.capability ?? '<capability>') + '` 与 `module: <代码模块>`；',
    '- front-matter 必须带 `status: draft`：起草件在被人工确认前不是契约，不能参与 plan freeze。',
  ];

  const goal = await readGoalRecord(projectRoot, state.goal);
  // 先把 goal 的意图交底，再给事实面与体例：Agent 需要知道「要什么」，
  // 也需要知道「这个仓库里已经有什么可以引用、写成什么样才算合格」。
  if (goal === null) {
    lines.push('', '## Goal', 'goal: ' + state.goal + '（未找到 goal 投影，运行 cometflow goal sync 补齐）');
  } else {
    lines.push('', '## Goal');
    lines.push('goal: ' + goal.id + ' · ' + goal.title);
    if (goal.summary !== '') lines.push('summary: ' + goal.summary);
    if (goal.scope.length > 0) lines.push('scope: ' + goal.scope.join(', '));
    if (goal.success_criteria.length > 0) {
      lines.push('success_criteria:');
      for (const item of goal.success_criteria) lines.push('- ' + item);
    }
    if (goal.non_goals.length > 0) {
      lines.push('non_goals:');
      for (const item of goal.non_goals) lines.push('- ' + item);
    }
  }

  // 输入面（事实 + 体例）与 goal 同级展开。取不到时静默跳过：
  // 提示词少一段不该让起草任务本身失败，护栏在 change verify / archive。
  try {
    const hints = await gatherSpecAuthoringHints(projectRoot, {
      capability: state.capability ?? null,
      scope: goal?.scope ?? [],
    });
    lines.push('', ...renderSpecAuthoringInputs(hints));
  } catch {
    lines.push('', '## Existing facts you may reference', '（读取现有 spec 失败，起草前请自行确认可引用的模型 / 错误码 / 配置键）');
  }

  return lines;
}

async function frozenSpecSection(projectRoot: string, state: ChangeState): Promise<string[]> {
  // Builder 的输入必须是「冻结版本」的 spec 段落，而不是当前工作区的内容：
  // 这是 spec 驱动重建的核心——代码丢失后按同一份契约重建，目标不会漂。
  if (!state.spec_ref) return specAuthoringSection(projectRoot, state);
  const lines: string[] = ['## Frozen spec'];
  lines.push('spec_ref: ' + state.spec_ref);
  lines.push('spec_anchor: ' + (state.spec_anchor ?? '(none)'));
  lines.push('spec_version: ' + (state.spec_version ?? '(untracked)'));
  lines.push('spec_hash: ' + (state.spec_hash ?? '(none)'));
  if (state.module) lines.push('module: ' + state.module);

  let content: string | null = null;
  if (state.spec_hash) content = await readSpecBlob(projectRoot, state.spec_hash);
  if (content === null) {
    const current = path.join(projectRoot, state.spec_ref);
    if (await pathExists(current)) {
      content = await readTextFile(current);
      if (state.spec_hash && hashSpecText(content) !== state.spec_hash) {
        lines.push('');
        lines.push(
          'WARNING: 版本仓缺少冻结内容，已退回当前工作区文件；该文件与冻结哈希不一致，' +
            '请运行 cometflow spec lock 补齐版本仓。',
        );
      }
    }
  }
  if (content === null) {
    lines.push('');
    lines.push('ERROR: 无法读取冻结的 spec 内容，停止执行以免偏离契约。');
    return lines;
  }

  const section = state.spec_anchor ? extractAnchorSection(content, state.spec_anchor) : null;
  lines.push('');
  if (section) {
    lines.push(section.text);
    lines.push('');
    lines.push('## Acceptance (all items must pass)');
    for (const item of section.acceptance) lines.push('- ' + item.id + ': ' + item.text);
  } else {
    lines.push(content.trimEnd());
  }
  return lines;
}

export async function buildChangePrompt(projectRoot: string, name: string): Promise<string> {
  const state = await readChangeState(projectRoot, name);
  const dir = path.join(projectRoot, 'changes', name);
  let brief = '';
  try { brief = await fs.readFile(path.join(dir, 'brief.md'), 'utf8'); } catch { brief = state.name; }
  const specSection = await frozenSpecSection(projectRoot, state);
  const prompt = [
    'You are the Builder for a CometFlow change.',
    'Implement the change described in brief.md and satisfy every acceptance criterion.',
    'The spec section below is the frozen contract for this change; treat it as the source of truth.',
    'If the code is missing or was deleted, regenerate it from this spec rather than guessing.',
    'Do not modify comet-state.yaml or verification.md.',
    '',
    '## Change',
    'name: ' + state.name,
    'task: ' + state.task,
    'spec: ' + (state.spec_ref ?? '(none)') + '#' + (state.spec_anchor ?? ''),
    'acceptance: ' + (state.acceptance_ids.join(', ') || '(none)'),
    'module: ' + (state.module ?? '(unbounded)'),
    '',
    state.module
      ? 'Keep the implementation inside `' +
        state.module +
        '`; do not scatter this capability across other modules.'
      : 'No module boundary is declared by the spec; stay minimal and local.',
    '',
    ...specSection,
    '',
    '## brief.md',
    brief,
  ].join('\n');
  // 提示词会带上人写的 brief 与 spec 原文，其中的高置信凭证先裁剪再送给 agent。
  // 这一档不启用通用键值规则，避免把 spec 里的 `password: string` 之类契约示例改花。
  return redactSecrets(prompt);
}

export async function runChange(
  projectRoot: string,
  name: string,
  runner: AgentRunner,
  options: DriftGuardOptions & { model?: string; timeoutMs?: number } = {},
): Promise<ChangeRunOutcome> {
  const state = await readChangeState(projectRoot, name);
  if (state.phase !== 'build') throw new Error('change run requires build phase');
  // 停机的 change 必须先由人判断（改 spec / 改验收 / 改实现方向），再 unblock 重跑。
  if (state.status === 'blocked') {
    throw new Error(
      'change ' +
        name +
        ' is blocked after ' +
        (state.repair_attempts ?? 0) +
        ' repair attempt(s) without progress; review changes/' +
        name +
        '/verification.md, then run cometflow change unblock ' +
        name,
    );
  }
  await assertGitProvenance(projectRoot, name, state, options);
  // C1：change 级互斥。人手工 `change run` 与 daemon 可能同时驱动同一个 change，
  // 没有这把锁就会真跑两个 agent 改同一块代码。拿不到锁立刻失败并说明持有者（ADR 0021）。
  // scope：**按 change 隔离**。项目级那把锁是给"一次改多个文件"的事务用的（冻结/归档），
  // 并发执行两个不同 change 时不该互相排队（P4/C3，ADR 0028）。
  const lock = await acquireLock(projectRoot, 'change run ' + name, { scope: 'change-run-' + name });
  try {
    const prompt = await buildChangePrompt(projectRoot, name);
    // 模型解析放在这里，而不是各调用方各写一遍：`change run`（CLI）、Web 的 run-change、
    // daemon 三条路径都要拿到同一个默认值。过去只有 daemon 会解析 `.cometflow/config.yaml`，
    // CLI 与 Web 是静默用 Agent 自己的默认模型——项目里配的 model 对它们等于没写。
    const model = options.model ?? (await resolveModel(projectRoot, runner.id));
    await appendChangeEvent(
      projectRoot,
      name,
      'run-started',
      { agent: runner.id, model: model ?? null },
      { phase: state.phase },
    );
    const result = await runner.run({ prompt, cwd: projectRoot, model, timeoutMs: options.timeoutMs });
    if (result.exitCode !== 0) {
      await appendChangeEvent(projectRoot, name, 'run-completed', {
        agent: runner.id,
        exitCode: result.exitCode,
        ok: false,
      }, { phase: state.phase });
      return { state, agentExitCode: result.exitCode };
    }
    const next = applyChangeTransition(state, 'submit-candidate');
    await commitTransition(projectRoot, 'submit-candidate', state, next);
    await appendChangeEvent(projectRoot, name, 'run-completed', {
      agent: runner.id,
      exitCode: result.exitCode,
      ok: true,
    }, { phase: next.phase });
    return { state: next, agentExitCode: result.exitCode };
  } finally {
    await lock.release();
  }
}

export interface ChangeVerifyOutcome {
  state: ChangeState;
  reportPassed: boolean;
  verdicts: AcceptanceVerdictRecord[];
  checks: AcceptanceCheckReport | null;
  scope: ImplementationScopeReport | null;
  verifierAgent: string | null;
}

export type VerdictResult = 'passed' | 'failed' | 'blocked';
export type VerdictSource = 'check' | 'document' | 'agent' | 'eval' | 'uncovered';

export interface AcceptanceVerdictRecord {
  id: string;
  result: VerdictResult;
  reason: string;
  source: VerdictSource;
}

export interface ChangeVerifyOptions {
  runner?: AgentRunner;
  mode?: VerificationMode;
  /** 未显式传入时取项目配置的 verification.verifier_policy，再退回 warn。 */
  verifierPolicy?: VerifierPolicy;
  /** 已解析出的 Verifier agent id（即使不可用也记录，便于解释「谁没跑」）。 */
  verifierAgentId?: string | null;
  /** Verifier 不可用的原因；用于 warn/fail 的说明。 */
  verifierUnavailableReason?: string | null;
  model?: string;
  timeoutMs?: number;
  now?: Date;
  /** 显式忽略 git 来源漂移。 */
  allowDrift?: boolean;
}

export const VERDICT_FINGERPRINT_TAG = 'cometflow.verify-fingerprint.v1';
/** 默认的修复轮数上限；可用 verification.max_repair_attempts 覆盖。 */
export const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;
/**
 * 独立 Verifier 的默认超时。
 *
 * A（独立验证默认化）之后 Verifier 真的会被调用，而 `runner.run` 不传 timeout 就是无限等待——
 * 一次挂起的 agent 会话会让 `change verify` 永久卡住。
 */
export const DEFAULT_VERIFIER_TIMEOUT_MS = 600_000;

/**
 * 失败结论指纹。
 *
 * 刻意只包含「结论」——验收项 id 与结果、越界项——不含自由文本理由与证据来源：
 * - 理由措辞每次都会变，纳入指纹会让停滞检测永远失效；
 * - 来源（check/document/agent）反映证据质量而非结论，纳入会让同一问题被当成两个。
 *
 * 指纹相同 = 修了一轮，问题集合一模一样 = 没有进展。
 */
export function verdictFingerprint(
  verdicts: readonly AcceptanceVerdictRecord[],
  violations: readonly string[],
): string {
  return canonicalHash(VERDICT_FINGERPRINT_TAG, {
    failing: verdicts
      .filter((verdict) => verdict.result !== 'passed')
      .map((verdict) => verdict.id + ':' + verdict.result)
      .sort(),
    violations: [...violations].sort(),
  });
}

/**
 * 判定优先级（高到低）：
 *   1. acceptance 自带的 `check` 命令 —— 机器事实，任何人都不能推翻；
 *   2. 独立 Verifier 的结论 —— 覆盖 check 未覆盖的验收项；
 *   3. changes/<name>/verification.yaml —— 兼容既有流程；
 *   4. 项目级 eval —— 兜底；
 *   5. 都没有 → blocked（宁可失败，也不放行无法判定的验收）。
 */
export async function verifyChange(
  projectRoot: string,
  name: string,
  options: ChangeVerifyOptions = {},
): Promise<ChangeVerifyOutcome> {
  const state = await readChangeState(projectRoot, name);
  if (state.phase !== 'verify') throw new Error('change verify requires verify phase');
  await assertGitProvenance(projectRoot, name, state, { allowDrift: options.allowDrift });
  // 这里刻意**不**加 change 级锁：verify 只读代码、跑确定性检查与只读 Verifier，唯一的写入是
  // verification.md（同源结果，最后写入者胜），而真正改状态的归档有自己的锁。
  // 需要互斥的是"跑 builder"（`change run` 已加锁）与"归档"（archiveChange 已有锁）。
  // 起草类 change 的「验收」就是那份 spec 本身：先确认它真的合格，再谈别的。
  await assertAuthoredSpecReady(projectRoot, state);

  const config = await readProjectConfig(projectRoot);
  const mode: VerificationMode = options.mode ?? config.verification?.mode ?? 'checks';
  const verifierPolicy: VerifierPolicy =
    options.verifierPolicy ?? config.verification?.verifier_policy ?? 'warn';
  const allow = await resolveScopeAllow(projectRoot);

  const checks = await runAcceptanceChecks(projectRoot, name, {
    timeoutMs: options.timeoutMs,
    now: options.now,
  });
  const scope = await collectImplementationScope(projectRoot, name, {
    module: state.module ?? null,
    allow,
  });

  const document = await readVerificationDocument(projectRoot, name);
  if (document) {
    const errors = validateVerificationDocument(state, document);
    if (errors.length > 0) throw new Error(errors.join('; '));
  }
  const documentById = new Map(document?.acceptance.map((item) => [item.id, item]) ?? []);

  const verdicts: AcceptanceVerdictRecord[] = [];
  const checkById = new Map(checks.results.map((entry) => [entry.id, entry]));
  for (const id of state.acceptance_ids) {
    const check = checkById.get(id);
    if (check && check.kind === 'command' && check.passed !== null) {
      verdicts.push({
        id,
        result: check.passed ? 'passed' : 'failed',
        reason: check.reason + (check.check ? ' [' + check.check + ']' : ''),
        source: 'check',
      });
      continue;
    }
    const documented = documentById.get(id);
    if (documented) {
      verdicts.push({ id, result: documented.result, reason: documented.reason, source: 'document' });
      continue;
    }
    verdicts.push({
      id,
      result: 'blocked',
      reason: 'no check and no verdict; needs an independent verifier or a human verdict',
      source: 'uncovered',
    });
  }

  // eval 兜底：仅在仍有无法判定的验收项、且项目配置了 eval 时使用。
  if (verdicts.some((entry) => entry.source === 'uncovered') && mode !== 'agent-required') {
    try {
      const report = await runLocalEval(projectRoot);
      for (const verdict of verdicts) {
        if (verdict.source !== 'uncovered') continue;
        verdict.result = report.passed ? 'passed' : 'failed';
        verdict.reason = 'project eval ' + (report.passed ? 'passed' : 'failed');
        verdict.source = 'eval';
      }
    } catch {
      // 没有 eval 配置时保持 blocked。
    }
  }

  // 独立 Verifier：Builder 不能自证。
  let verifierAgent: string | null = null;
  let verifierDurationMs: number | null = null;
  const verifierRequested = mode === 'checks+agent' || mode === 'agent-required';
  const violations: string[] = [];
  const notes: string[] = [];
  if (verifierRequested) {
    const runner = options.runner;
    if (!runner) {
      // 不可用时按 verifier_policy 决定：fail 直接判失败，warn 记录「本轮没有独立验证」，
      // skip 保持旧行为（静默降级）。agent-required 无论策略如何都必须有 Verifier。
      const reason =
        options.verifierUnavailableReason ??
        (options.verifierAgentId
          ? 'verifier agent "' + options.verifierAgentId + '" is not available'
          : 'no independent verifier is configured (set verification.agent or agent)');
      const mustFail = mode === 'agent-required' || verifierPolicy === 'fail';
      if (mustFail) {
        violations.push(
          (mode === 'agent-required'
            ? 'verification.mode=agent-required'
            : 'verification.verifier_policy=fail') +
            ' but the independent verifier is unavailable: ' +
            reason,
        );
        for (const verdict of verdicts) {
          if (verdict.source === 'check') continue;
          verdict.result = 'blocked';
          verdict.reason = 'independent verifier is required but unavailable: ' + reason;
          verdict.source = 'uncovered';
        }
      } else if (verifierPolicy === 'warn') {
        notes.push('no independent verification this round: ' + reason);
      }
    } else if (runner) {
      const outcome = await runIndependentVerifier(projectRoot, name, checks, {
        runner,
        model: options.model ?? config.verification?.model,
        timeoutMs: options.timeoutMs ?? DEFAULT_VERIFIER_TIMEOUT_MS,
        now: options.now,
      });
      verifierAgent = outcome.agentId;
      verifierDurationMs = outcome.durationMs;
      if (outcome.status !== 'verdict') {
        notes.push('verifier did not produce a verdict (' + outcome.status + '): ' + outcome.notes.join('; '));
      }
      const byId = new Map(outcome.report?.acceptance.map((item) => [item.id, item]) ?? []);
      for (const verdict of verdicts) {
        // 确定性检查一票否决：agent 不能把失败的 check 判成通过。
        if (verdict.source === 'check') continue;
        const agentVerdict = byId.get(verdict.id);
        if (agentVerdict) {
          verdict.result = agentVerdict.result;
          verdict.reason = agentVerdict.reason + ' (verifier: ' + outcome.agentId + ')';
          verdict.source = 'agent';
        } else if (mode === 'agent-required') {
          verdict.result = 'blocked';
          verdict.reason = 'verifier did not return a verdict: ' + outcome.notes.join('; ');
          verdict.source = 'uncovered';
        }
      }
    }
  }

  if (state.module && scope.unattributed.length > 0) {
    violations.push('implementation escaped module ' + state.module + ': ' + scope.unattributed.join(', '));
  }
  // 老 change（在实现范围基线机制之前创建）没有基线。此时无法证明模块边界：
  // 声明了 module 的 change 必须失败（fail closed），未声明模块的只记录警告，
  // 否则升级会让历史 change 全部不可验证。
  if (state.module && !scope.baseline_captured_at) {
    violations.push(
      'implementation baseline is missing; module boundary ' + state.module + ' could not be verified',
    );
  }
  // 快照有 omission 就说明「有东西没被比对」；是否致命由 scope.omission_policy 决定。
  const omissionPolicy = config.scope?.omission_policy ?? 'warn';
  if (scope.omittedCount > 0) {
    const summary =
      scope.omittedCount +
      ' path(s) were not compared (' +
      scope.omitted.slice(0, 3).map((entry) => entry.path + ': ' + entry.reason).join(', ') +
      (scope.omittedCount > 3 ? ' 等' : '') +
      ')';
    if (omissionPolicy === 'fail') violations.push('implementation scope is incomplete: ' + summary);
    else notes.push('scope omission: ' + summary);
  }

  const reportPassed = verdicts.every((verdict) => verdict.result === 'passed') && violations.length === 0;

  // 有界修复循环：连续同一失败结论说明「修了但没变」，继续跑只是烧时间。
  const fingerprint = verdictFingerprint(verdicts, violations);
  const maxAttempts = config.verification?.max_repair_attempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
  const previousAttempts = state.repair_attempts ?? 0;
  const sameSignature = !reportPassed && state.last_verdict_hash === fingerprint;
  const repairAttempts = reportPassed ? 0 : sameSignature ? previousAttempts + 1 : 1;
  const stalled = !reportPassed && repairAttempts >= maxAttempts;

  const dir = path.join(projectRoot, 'changes', name);
  const verification = [
    '# Verification',
    '',
    'change: ' + state.name,
    'spec_version: ' + (state.spec_version ?? '(untracked)'),
    'module: ' + (state.module ?? '(unbounded)'),
    'acceptance: ' + (state.acceptance_ids.length > 0 ? state.acceptance_ids.join(', ') : '(none)'),
    'verifier: ' + (verifierAgent ?? '(none)'),
    'verifier_policy: ' + verifierPolicy + (verifierRequested ? '' : ' (mode=' + mode + '，未要求独立验证)'),
    ...(verifierDurationMs === null ? [] : ['verifier_ms: ' + verifierDurationMs]),
    'scope: ' +
      (scope.baseline_captured_at === null
        ? 'not-baselined (change predates implementation baselines)'
        : scope.complete
          ? 'complete'
          : 'incomplete'),
    'repair_attempts: ' + repairAttempts + '/' + maxAttempts,
    ...verdicts.map(
      (entry) =>
        '- ' +
        entry.id +
        ': ' +
        entry.result +
        ' [' +
        entry.source +
        '] - ' +
        redactSecrets(entry.reason, { aggressive: true }),
    ),
    ...violations.map((entry) => '- violation: ' + redactSecrets(entry, { aggressive: true })),
    ...notes.map((entry) => '- note: ' + redactSecrets(entry, { aggressive: true })),
    ...(stalled
      ? [
          '- stalled: 连续 ' +
            repairAttempts +
            ' 轮得到同一失败结论，已停机等待人工介入（cometflow change unblock ' +
            name +
            ' 后可重试）',
        ]
      : []),
    'result: ' + (reportPassed ? 'pass' : 'fail'),
  ];
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'verification.md'), verification.join('\n'));

  await appendChangeEvent(projectRoot, name, 'verify-result', {
    passed: reportPassed,
    verifier: verifierAgent,
    verifier_agent_id: options.verifierAgentId ?? null,
    verifier_ms: verifierDurationMs,
    verifier_policy: verifierPolicy,
    verification_mode: mode,
    verdicts: verdicts.map((entry) => entry.id + ':' + entry.result + '@' + entry.source),
    violations,
    repair_attempts: repairAttempts,
    max_repair_attempts: maxAttempts,
    stalled,
    fingerprint: fingerprint.slice(0, 12),
  }, { phase: state.phase, now: options.now });

  const transitioned = applyChangeTransition(state, reportPassed ? 'verify-pass' : 'verify-fail');
  const next: ChangeState = reportPassed
    ? { ...transitioned, repair_attempts: 0, last_verdict_hash: null }
    : {
        ...transitioned,
        repair_attempts: repairAttempts,
        last_verdict_hash: fingerprint,
        // 停机不等于换阶段：phase 仍回到 build，用 status 表达「需要人」。
        status: stalled ? 'blocked' : transitioned.status,
      };
  await commitTransition(projectRoot, reportPassed ? 'verify-pass' : 'verify-fail', state, next);
  return { state: next, reportPassed, verdicts, checks, scope, verifierAgent };
}

export interface ChangeArchiveOutcome {
  state: ChangeState;
  appliedSpecs: string[];
  /** 归档后 canonical spec 的版本号，键为 specs/ 相对路径。 */
  specVersions: { path: string; spec_version: number; hash: string }[];
}

const ROOT_KIND_FILENAMES = new Set(
  Object.values(ROOT_KIND_FILES).map((relativePath) => relativePath.replace(/^specs\//u, '')),
);

/**
 * Proposed specs live under changes/<name>/specs/ and are copied verbatim into specs/ on archive.
 * Supported targets mirror the spec kind model:
 *   - <capability>/spec.md   → specs/<capability>/spec.md
 *   - flows/<name>.md        → specs/flows/<name>.md
 *   - <root kind>.md         → specs/<root kind>.md  (e.g. models.md / protocol.md /
 *                              errors.md / config.md / constraints.md / permissions.md /
 *                              rules.md / processes.md / pages.md)
 */
function isSupportedProposedSpec(relativePath: string): boolean {
  if (/^[^\\/]+\.md$/u.test(relativePath)) return ROOT_KIND_FILENAMES.has(relativePath);
  if (/^[^\\/]+\/spec\.md$/u.test(relativePath)) return true;
  if (/^flows\/[^\\/]+\.md$/u.test(relativePath)) return true;
  return false;
}

async function collectProposedSpecFiles(root: string, current = root): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectProposedSpecFiles(root, fullPath));
    } else if (entry.isFile()) {
      files.push(toPosix(path.relative(root, fullPath)));
    }
  }
  return files.sort();
}

/**
 * Copy changes/<name>/specs/** into specs/**. Returns the list of applied spec paths.
 * Throws on unsupported paths instead of silently skipping them.
 */
export interface SpecApplyTransactionState {
  schema: 'cometflow.spec-apply-transaction.v1';
  change: string;
  txId: string;
  started_at: string;
  status: 'staged' | 'committed' | 'rolled-back';
  files: { target: string; existed: boolean }[];
}

export function specApplyTransactionDir(projectRoot: string, name: string, txId: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'changes', name, 'tx', txId);
}

/**
 * 归档写入 spec 的事务：
 *
 *   1. stage   —— 把提案内容与「被覆盖文件的备份」都落到 tx 目录；
 *   2. commit  —— 逐个写入 specs/，并记录状态；
 *   3. rollback—— 任一步失败就把已写入的目标恢复成备份（或删除新建文件），
 *                 保证 specs/ 不会停在一半新一半旧的中间态。
 *
 * 借鉴 comet 的可恢复事务：写之前先留下可回滚的证据，失败后能回到起点。
 */
export async function applyProposedSpecs(projectRoot: string, name: string): Promise<string[]> {
  const proposedSpecsDir = path.join(projectRoot, 'changes', name, 'specs');
  if (!(await pathExists(proposedSpecsDir))) return [];

  const files = await collectProposedSpecFiles(proposedSpecsDir);
  const unsupported = files.filter((relativePath) => !isSupportedProposedSpec(relativePath));
  if (unsupported.length > 0) {
    throw new Error(
      'unsupported proposed spec path(s): ' + unsupported.join(', ') +
      ' (expected <capability>/spec.md, flows/<name>.md, or a root kind file such as models.md / protocol.md / errors.md / config.md)',
    );
  }
  if (files.length === 0) return [];

  const txId = new Date().toISOString().replace(/[:.]/gu, '-');
  const txDir = specApplyTransactionDir(projectRoot, name, txId);
  const stagedDir = path.join(txDir, 'staged');
  const backupDir = path.join(txDir, 'backup');

  const entries: { relativePath: string; target: string; existed: boolean; applied: boolean }[] = [];
  for (const relativePath of files) {
    const source = path.join(proposedSpecsDir, relativePath);
    const target = path.join(projectRoot, 'specs', relativePath);
    // 只有「确实存在且是普通文件」才需要备份；目录占位会在 commit 阶段报错并触发回滚。
    let existed = false;
    if (await pathExists(target)) {
      const stat = await fs.lstat(target);
      if (!stat.isFile()) {
        throw new Error(
          'spec target is not a regular file: specs/' +
            relativePath +
            '（归档已中止，未写入任何内容）',
        );
      }
      existed = true;
    }
    const staged = path.join(stagedDir, relativePath);
    await fs.mkdir(path.dirname(staged), { recursive: true });
    await fs.copyFile(source, staged);
    if (existed) {
      const backup = path.join(backupDir, relativePath);
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.copyFile(target, backup);
    }
    entries.push({ relativePath, target, existed, applied: false });
  }

  const stateFile = path.join(txDir, 'state.json');
  const writeState = async (status: SpecApplyTransactionState['status']): Promise<void> => {
    const state: SpecApplyTransactionState = {
      schema: 'cometflow.spec-apply-transaction.v1',
      change: name,
      txId,
      started_at: new Date().toISOString(),
      status,
      files: entries.map((entry) => ({ target: 'specs/' + entry.relativePath, existed: entry.existed })),
    };
    await fs.mkdir(txDir, { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
  };
  await writeState('staged');

  const applied: string[] = [];
  try {
    for (const entry of entries) {
      await fs.mkdir(path.dirname(entry.target), { recursive: true });
      await fs.copyFile(path.join(stagedDir, entry.relativePath), entry.target);
      entry.applied = true;
      applied.push('specs/' + entry.relativePath);
    }
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      if (!entry.applied) continue;
      try {
        if (entry.existed) {
          await fs.copyFile(path.join(backupDir, entry.relativePath), entry.target);
        } else {
          await fs.rm(entry.target, { force: true });
        }
      } catch {
        // 回滚失败时保留 tx 目录供人工恢复；出错信息里会带上 tx 路径。
      }
    }
    await writeState('rolled-back');
    throw new Error(
      'failed to apply proposed specs for ' +
        name +
        ': ' +
        (error instanceof Error ? error.message : String(error)) +
        '（已回滚；事务记录：' +
        txDir +
        '）',
    );
  }

  await writeState('committed');
  return applied;
}

export interface IncompleteSpecTransaction {
  change: string;
  txId: string;
  status: SpecApplyTransactionState['status'];
  dir: string;
}

/** 供 doctor 使用：找出停在 staged 状态（进程被杀）的归档事务。 */
export async function listIncompleteSpecTransactions(
  projectRoot: string,
): Promise<IncompleteSpecTransaction[]> {
  const root = path.join(projectRoot, '.cometflow', 'runtime', 'changes');
  let changes: string[];
  try {
    changes = await fs.readdir(root);
  } catch {
    return [];
  }
  const result: IncompleteSpecTransaction[] = [];
  for (const change of changes) {
    const txRoot = path.join(root, change, 'tx');
    let txs: string[];
    try {
      txs = await fs.readdir(txRoot);
    } catch {
      continue;
    }
    for (const txId of txs) {
      const stateFile = path.join(txRoot, txId, 'state.json');
      try {
        const state = JSON.parse(await readTextFile(stateFile)) as SpecApplyTransactionState;
        if (state.status === 'staged') {
          result.push({ change, txId, status: state.status, dir: path.join(txRoot, txId) });
        }
      } catch {
        continue;
      }
    }
  }
  return result;
}

function proposedSpecTargets(files: string[]): string[] {
  return files.map((file) => 'specs/' + file);
}

async function collectProposedTargets(projectRoot: string, name: string): Promise<string[]> {
  const proposedSpecsDir = path.join(projectRoot, 'changes', name, 'specs');
  if (!(await pathExists(proposedSpecsDir))) return [];
  return proposedSpecTargets(await collectProposedSpecFiles(proposedSpecsDir));
}

/**
 * 读取 change 的提案 spec，键为它在 specs/ 下的目标路径。
 * 归档前用它做影响预览，避免「先写 specs/ 再看影响」这种把风险提前落地的做法。
 */
export async function readProposedSpecs(
  projectRoot: string,
  name: string,
): Promise<Record<string, string>> {
  const proposedSpecsDir = path.join(projectRoot, 'changes', name, 'specs');
  if (!(await pathExists(proposedSpecsDir))) return {};
  const files = await collectProposedSpecFiles(proposedSpecsDir);
  const overlay: Record<string, string> = {};
  for (const relativePath of files) {
    overlay['specs/' + relativePath] = await readTextFile(path.join(proposedSpecsDir, relativePath));
  }
  return overlay;
}

/**
 * 归档前置检查：change 存续期间 canonical spec 是否被别人改过。
 *
 * 这是 spec 版本管理的 compare-and-swap 语义：change 基于一份确定的 spec 版本开工，
 * 归档时若基线已变，就直接覆盖等于悄悄丢掉那一次 spec 变更。
 */
async function assertSpecBaselineIntact(
  projectRoot: string,
  name: string,
  state: ChangeState,
): Promise<void> {
  const targets = await collectProposedTargets(projectRoot, name);
  // 精确到「本 change 会写入的目标」；没有提案时退化为它绑定的那一份 spec。
  // 纯代码 change 也不该在契约已经变化的情况下照旧归档——那正是 spec 驱动要拦住的事。
  const relevant = targets.length > 0 ? targets : state.spec_ref ? [state.spec_ref] : [];
  if (relevant.length === 0) return;

  const baseline = await readChangeSpecBaseline(projectRoot, name);
  if (baseline) {
    const conflicts = await diffChangeSpecBaseline(projectRoot, baseline, relevant);
    if (conflicts.length > 0) throw new SpecConflictError(name, conflicts);
    return;
  }

  // 兼容没有基线文件的旧 change：退化为只检查任务绑定的那一份 spec。
  if (!state.spec_ref || !state.spec_base_hash) return;
  const absolute = path.join(projectRoot, state.spec_ref);
  const actual = (await pathExists(absolute))
    ? hashSpecText(await readTextFile(absolute))
    : null;
  if (actual !== state.spec_base_hash) {
    throw new SpecConflictError(name, [
      { path: state.spec_ref, expected: state.spec_base_hash, actual, kind: actual === null ? 'removed' : 'modified' },
    ]);
  }
}

export async function archiveChange(
  projectRoot: string,
  name: string,
  options: DriftGuardOptions = {},
): Promise<ChangeArchiveOutcome> {
  const state = await readChangeState(projectRoot, name);
  if (state.phase !== 'archive') throw new Error('change archive requires archive phase');

  await assertGitProvenance(projectRoot, name, state, options);
  await appendChangeEvent(projectRoot, name, 'archive-started', {}, { phase: state.phase });
  await assertSpecBaselineIntact(projectRoot, name, state);
  // 起草类 change 即使绕过 verify，也不能带着不合格的 spec 进归档。
  await assertAuthoredSpecReady(projectRoot, state);
  // 最后一道模块闸门：即使 verify 被绕过，越界改动也不能进入归档。
  const scope = await collectImplementationScope(projectRoot, name, {
    module: state.module ?? null,
    allow: await resolveScopeAllow(projectRoot),
  });
  if (state.module && scope.unattributed.length > 0) {
    throw new Error(
      'implementation scope violation for ' +
        name +
        ': 以下改动不在 spec 声明的模块 ' +
        state.module +
        ' 内: ' +
        scope.unattributed.join(', ') +
        '；请移回模块内，或在 COMETFLOW.md 的「## 模块归属」中声明为共享路径',
    );
  }

  // 归档会同时改多个 spec 文件 + 状态 + 版本仓：整段持锁，避免与另一个进程的事务交错。
  const lock = await acquireLock(projectRoot, 'change archive ' + name);
  let appliedSpecs: string[] = [];
  try {
    appliedSpecs = await applyProposedSpecs(projectRoot, name);
  } finally {
    await lock.release();
  }
  for (const applied of appliedSpecs) {
    await appendChangeEvent(projectRoot, name, 'spec-applied', { path: applied }, { phase: state.phase });
  }
  // 归档即记账：把新 canonical spec 登记为版本并刷新 spec-lock，
  // 这样「归档后 lock 立刻过期」的问题不再出现。
  const refreshed = await refreshSpecBaseline(projectRoot, { change: name, note: 'archive' });
  const appliedVersions = refreshed.recorded.filter((entry) => appliedSpecs.includes(entry.path));
  for (const version of appliedVersions) {
    await appendChangeEvent(projectRoot, name, 'spec-version-recorded', {
      path: version.path,
      spec_version: version.spec_version,
      hash: version.hash,
    });
  }
  const boundVersion = appliedVersions.find((entry) => entry.path === state.spec_ref);
  const next: ChangeState = {
    ...applyChangeTransition(state, 'archive-complete'),
    applied_spec_version: boundVersion?.spec_version ?? null,
  };
  if (state.spec_ref) {
    const applied = refreshed.lock.files.find((entry) => entry.path === state.spec_ref);
    if (applied) next.spec_hash = applied.hash;
  }
  await commitTransition(projectRoot, 'archive-complete', state, next);
  // 归档后把它从「当前 change」上摘掉，避免指针指向已结束的变更。
  await clearCurrentChange(projectRoot, name);
  await appendChangeEvent(projectRoot, name, 'archive-completed', {
    appliedSpecs,
    versions: appliedVersions,
  }, { phase: next.phase });
  return { state: next, appliedSpecs, specVersions: appliedVersions };
}

export interface ChangeRebaseOutcome {
  state: ChangeState;
  baselineFiles: number;
  specVersion: number | null;
  acceptanceIds: string[];
}

export interface ChangeUnblockOutcome {
  state: ChangeState;
  previousAttempts: number;
}

/**
 * 解封停机的 change。
 *
 * 停机是「交还人工」而不是「放弃」：人看过失败结论、改完方向之后，
 * 需要一个显式动作把计数清零重来。这也是唯一应该由人决定的重置点。
 */
export async function unblockChange(
  projectRoot: string,
  name: string,
  options: { note?: string; now?: Date } = {},
): Promise<ChangeUnblockOutcome> {
  const state = await readChangeState(projectRoot, name);
  if (state.archived) throw new Error('Change is already archived');
  if (state.status !== 'blocked') {
    throw new Error('change ' + name + ' is not blocked (status=' + state.status + ')');
  }
  const next: ChangeState = {
    ...state,
    status: 'active',
    repair_attempts: 0,
    last_verdict_hash: null,
  };
  await writeChangeState(projectRoot, next);
  await appendChangeEvent(projectRoot, name, 'unblocked', {
    previous_attempts: state.repair_attempts ?? 0,
    note: options.note ?? null,
  }, { phase: next.phase, now: options.now });
  return { state: next, previousAttempts: state.repair_attempts ?? 0 };
}

/**
 * 把 change 重新冻结到当前 canonical spec 版本。
 *
 * 语义上等价于「升级 spec 版本，然后按新版本重新生成代码」：
 * - 基线推进到当前 canonical spec；
 * - 重新提取该 anchor 的 acceptance 与正文哈希；
 * - 若 change 已进入 verify/archive，则退回 build，并把旧的验收记录改名留档，
 *   防止用旧版本的验收结论给新版本背书；
 * - 无法确认影响时应走 ADR 0004 的 reconciliation change，而不是 rebase。
 */
export async function rebaseChange(projectRoot: string, name: string): Promise<ChangeRebaseOutcome> {
  const state = await readChangeState(projectRoot, name);
  if (state.archived) throw new Error('Change is already archived');

  if (!state.spec_ref || !state.spec_anchor) {
    throw new Error('Change ' + name + ' has no bound spec anchor; nothing to rebase');
  }
  const absolute = path.join(projectRoot, state.spec_ref);
  if (!(await pathExists(absolute))) {
    throw new Error('Bound spec file is missing: ' + state.spec_ref + '；该 change 应改为 reconciliation change');
  }

  const content = await readTextFile(absolute);
  const meta = parseSpecMeta(content);
  const parsed = parseSpecContent(content, toPosix(state.spec_ref));
  const anchor = parsed.anchors.find((entry) => entry.heading === state.spec_anchor);
  if (!anchor) {
    throw new Error(
      'Bound anchor no longer exists in ' +
        state.spec_ref +
        ': ' +
        state.spec_anchor +
        '；请按 ADR 0004 创建 reconciliation change，而不是 rebase',
    );
  }

  const version = await recordSpecVersion(projectRoot, {
    specPath: state.spec_ref,
    content,
    change: name,
    note: 'change rebase',
  });
  const baseline = await captureChangeSpecBaseline(projectRoot, name);
  const acceptance = anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance;

  if (state.phase !== 'shape') {
    const stale = path.join(projectRoot, 'changes', name, 'verification.yaml');
    if (await pathExists(stale)) {
      await fs.rename(stale, stale.replace(/\.yaml$/u, '.stale-' + Date.now() + '.yaml'));
    }
  }

  const next: ChangeState = {
    ...state,
    phase: state.phase === 'shape' ? state.phase : 'build',
    spec_version: version.spec_version,
    spec_hash: version.hash,
    anchor_hash: anchor.hash,
    acceptance_ids: acceptance.map((item) => item.id),
    module: normalizeModulePath(meta.module) ?? state.module ?? null,
    spec_base_hash: baseline.files[toPosix(state.spec_ref)] ?? null,
    applied_spec_version: null,
  };
  await writeChangeState(projectRoot, next);
  await appendChangeEvent(projectRoot, name, 'rebase', {
    spec_version: version.spec_version,
    acceptance: next.acceptance_ids,
    phase: next.phase,
  }, { phase: next.phase });
  return {
    state: next,
    baselineFiles: Object.keys(baseline.files).length,
    specVersion: version.spec_version,
    acceptanceIds: next.acceptance_ids,
  };
}
