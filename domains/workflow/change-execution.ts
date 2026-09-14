import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentRunner } from '../../platform/agents/types.js';
import { pathExists } from '../../platform/fs/read-file.js';
import { toPosix } from '../../platform/paths/relative.js';
import { runLocalEval } from '../eval/eval-service.js';
import { ROOT_KIND_FILES } from '../spec/kind.js';
import { extractAnchorSection, parseSpecContent } from '../spec/spec-parse.js';
import { normalizeModulePath, parseSpecMeta } from '../spec/spec-meta.js';
import { hashSpecText } from '../spec/spec-hash.js';
import { readSpecBlob, recordSpecVersion, refreshSpecBaseline } from '../spec/spec-version.js';
import { readTextFile } from '../../platform/fs/read-file.js';
import { readProjectConfig, type VerificationMode } from '../project/config.js';
import { redactSecrets } from '../../platform/io/redact.js';
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
 * Builder 的输入必须是「冻结版本」的 spec 段落，而不是当前工作区的内容。
 *
 * 这是 spec 驱动重建的核心：只要 spec 在，agent 就能拿到确定的契约 + 验收项，
 * 于是代码丢失后重新生成的结果与当初冻结时是同一个目标。
 */
async function frozenSpecSection(projectRoot: string, state: ChangeState): Promise<string[]> {
  if (!state.spec_ref) return [];
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

export async function runChange(projectRoot: string, name: string, runner: AgentRunner): Promise<ChangeRunOutcome> {
  const state = await readChangeState(projectRoot, name);
  if (state.phase !== 'build') throw new Error('change run requires build phase');
  const prompt = await buildChangePrompt(projectRoot, name);
  await appendChangeEvent(projectRoot, name, 'run-started', { agent: runner.id }, { phase: state.phase });
  const result = await runner.run({ prompt, cwd: projectRoot });
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
  model?: string;
  timeoutMs?: number;
  now?: Date;
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

  const config = await readProjectConfig(projectRoot);
  const mode: VerificationMode = options.mode ?? config.verification?.mode ?? 'checks';
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
  const violations: string[] = [];
  const notes: string[] = [];
  if (mode === 'checks+agent' || mode === 'agent-required') {
    const runner = options.runner;
    if (!runner && mode === 'agent-required') {
      violations.push(
        'verification.mode=agent-required but no independent verifier agent is available',
      );
      for (const verdict of verdicts) {
        if (verdict.source === 'check') continue;
        verdict.result = 'blocked';
        verdict.reason = 'independent verifier is required but no agent runner is available';
        verdict.source = 'uncovered';
      }
    } else if (runner) {
      const outcome = await runIndependentVerifier(projectRoot, name, checks, {
        runner,
        model: options.model ?? config.verification?.model,
        timeoutMs: options.timeoutMs,
        now: options.now,
      });
      verifierAgent = outcome.agentId;
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

  const dir = path.join(projectRoot, 'changes', name);
  const verification = [
    '# Verification',
    '',
    'change: ' + state.name,
    'spec_version: ' + (state.spec_version ?? '(untracked)'),
    'module: ' + (state.module ?? '(unbounded)'),
    'acceptance: ' + (state.acceptance_ids.length > 0 ? state.acceptance_ids.join(', ') : '(none)'),
    'verifier: ' + (verifierAgent ?? '(none)'),
    'scope: ' +
      (scope.baseline_captured_at === null
        ? 'not-baselined (change predates implementation baselines)'
        : scope.complete
          ? 'complete'
          : 'incomplete'),
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
    'result: ' + (reportPassed ? 'pass' : 'fail'),
  ];
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'verification.md'), verification.join('\n'));

  await appendChangeEvent(projectRoot, name, 'verify-result', {
    passed: reportPassed,
    verifier: verifierAgent,
    verdicts: verdicts.map((entry) => entry.id + ':' + entry.result + '@' + entry.source),
    violations,
  }, { phase: state.phase, now: options.now });

  const next = applyChangeTransition(state, reportPassed ? 'verify-pass' : 'verify-fail');
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

export async function archiveChange(projectRoot: string, name: string): Promise<ChangeArchiveOutcome> {
  const state = await readChangeState(projectRoot, name);
  if (state.phase !== 'archive') throw new Error('change archive requires archive phase');

  await appendChangeEvent(projectRoot, name, 'archive-started', {}, { phase: state.phase });
  await assertSpecBaselineIntact(projectRoot, name, state);
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

  const appliedSpecs = await applyProposedSpecs(projectRoot, name);
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
