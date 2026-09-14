import { parse } from 'yaml';
import type { AgentRunner } from '../../platform/agents/types.js';
import { extractAnchorSection } from '../spec/spec-parse.js';
import { readSpecBlob } from '../spec/spec-version.js';
import { readTextFile } from '../../platform/fs/read-file.js';
import { redactSecrets } from '../../platform/io/redact.js';
import path from 'node:path';
import { appendChangeEvent } from './change-journal.js';
import { collectImplementationScope, resolveScopeAllow } from './implementation-scope.js';
import { readChangeState } from './change-store.js';
import type { ChangeState } from './change-types.js';
import type { AcceptanceCheckReport } from './change-checks.js';

export const VERIFIER_SCHEMA = 'cometflow.verification.v1';

export interface VerifierVerdict {
  id: string;
  result: 'passed' | 'failed' | 'blocked';
  reason: string;
}

export interface VerifierReport {
  schema: typeof VERIFIER_SCHEMA;
  change: string;
  acceptance: VerifierVerdict[];
}

export interface VerifierOutcome {
  status: 'verdict' | 'unavailable' | 'invalid';
  report: VerifierReport | null;
  agentId: string | null;
  exitCode: number | null;
  notes: string[];
}

export interface VerifierPromptInput {
  state: ChangeState;
  brief: string;
  specSection: string | null;
  acceptance: { id: string; text: string; check: string | null }[];
  checkReport: AcceptanceCheckReport | null;
  implementationScope: { changes: { path: string; kind: string }[]; unattributed: string[] } | null;
  frozenSource: 'version-store' | 'current-file' | 'missing';
}

/**
 * 独立 Verifier 的提示词。
 *
 * 关键约束（借鉴 comet Native 的 Verifier 协议）：
 * - 只读：不得修改任何文件；
 * - 必须对**每一条** acceptance 给出 passed / failed / blocked 与理由，不允许遗漏；
 * - 必须逐字引用它据以判断的 spec 原文，避免凭印象打分；
 * - 输出机器可解析的 YAML 块，便于 Runtime 校验覆盖度。
 */
export function buildVerifierPrompt(input: VerifierPromptInput): string {
  const lines: string[] = [];
  lines.push('You are the independent Verifier for a CometFlow change.');
  lines.push('You did not write this code. Verify it against the frozen spec, not against the author\u2019s claims.');
  lines.push('Read-only: do NOT modify, create, or delete any file.');
  lines.push('');
  lines.push('## Change');
  lines.push('name: ' + input.state.name);
  lines.push('task: ' + input.state.task);
  lines.push('spec: ' + (input.state.spec_ref ?? '(none)') + '#' + (input.state.spec_anchor ?? ''));
  lines.push('spec_version: ' + (input.state.spec_version ?? '(untracked)'));
  lines.push('spec_hash: ' + (input.state.spec_hash ?? '(none)'));
  lines.push('module: ' + (input.state.module ?? '(unbounded)'));
  lines.push('frozen_spec_source: ' + input.frozenSource);
  lines.push('');
  lines.push('## brief.md');
  lines.push(input.brief || '(missing)');
  lines.push('');
  if (input.specSection) {
    lines.push('## Frozen spec section');
    lines.push(input.specSection);
    lines.push('');
  }
  lines.push('## Acceptance to judge (every item, exactly once)');
  for (const item of input.acceptance) {
    lines.push('- ' + item.id + ': ' + item.text + (item.check ? '  [check: ' + item.check + ']' : ''));
  }
  lines.push('');
  if (input.checkReport) {
    lines.push('## Deterministic check results (authoritative when present)');
    for (const result of input.checkReport.results) {
      lines.push(
        '- ' +
          result.id +
          ': ' +
          (result.kind === 'none' ? 'no check declared' : result.passed ? 'passed' : 'FAILED') +
          ' — ' +
          result.reason,
      );
    }
    lines.push('');
  }
  if (input.implementationScope) {
    lines.push('## Implementation scope (files changed by this change)');
    for (const entry of input.implementationScope.changes) {
      lines.push('- ' + entry.kind + ' ' + entry.path);
    }
    if (input.implementationScope.unattributed.length > 0) {
      lines.push('Unattributed (outside the declared module): ' + input.implementationScope.unattributed.join(', '));
    }
    lines.push('');
  }
  lines.push('## Output contract');
  lines.push('Reply with exactly one fenced YAML block and nothing else:');
  lines.push('```yaml');
  lines.push('schema: ' + VERIFIER_SCHEMA);
  lines.push('change: ' + input.state.name);
  lines.push('acceptance:');
  for (const item of input.acceptance) {
    lines.push('  - id: ' + item.id);
    lines.push('    result: passed | failed | blocked');
    lines.push('    reason: <evidence, quote the spec text you judged against>');
  }
  lines.push('```');
  lines.push('');
  lines.push('A deterministic check that FAILED cannot be overridden to passed.');
  // 同 Builder：只裁剪高置信凭证，保留 spec 原文的契约示例。
  return redactSecrets(lines.join('\n'));
}

const YAML_BLOCK = /```ya?ml\s*\n([\s\S]*?)```/u;

export function parseVerifierOutput(stdout: string): VerifierReport | null {
  const match = YAML_BLOCK.exec(stdout);
  const source = match ? match[1] : stdout;
  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.schema !== VERIFIER_SCHEMA) return null;
  if (typeof record.change !== 'string') return null;
  if (!Array.isArray(record.acceptance)) return null;

  const acceptance: VerifierVerdict[] = [];
  for (const raw of record.acceptance) {
    if (raw === null || typeof raw !== 'object') return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string') return null;
    if (item.result !== 'passed' && item.result !== 'failed' && item.result !== 'blocked') return null;
    if (typeof item.reason !== 'string') return null;
    acceptance.push({ id: item.id, result: item.result, reason: item.reason });
  }
  return { schema: VERIFIER_SCHEMA, change: record.change, acceptance };
}

/**
 * 校验 Verifier 覆盖面：必须与冻结的 acceptance_ids 完全一致，不允许重复/未知/遗漏。
 * 这正是 comet Native 里 Verifier 结果被接受前的那道检查。
 */
export function validateVerifierCoverage(state: ChangeState, report: VerifierReport): string[] {
  const errors: string[] = [];
  if (report.change !== state.name) errors.push('verifier change name does not match');
  const expected = [...state.acceptance_ids].sort();
  const actual = report.acceptance.map((item) => item.id).sort();
  const duplicates = actual.filter((id, index) => actual.indexOf(id) !== index);
  const unknown = actual.filter((id) => !expected.includes(id));
  const missing = expected.filter((id) => !actual.includes(id));
  if (duplicates.length > 0) errors.push('duplicate acceptance in verifier report: ' + [...new Set(duplicates)].join(','));
  if (unknown.length > 0) errors.push('unknown acceptance in verifier report: ' + unknown.join(','));
  if (missing.length > 0) errors.push('missing acceptance in verifier report: ' + missing.join(','));
  return errors;
}

export interface RunVerifierOptions {
  runner: AgentRunner;
  model?: string;
  timeoutMs?: number;
  now?: Date;
}

export async function runIndependentVerifier(
  projectRoot: string,
  name: string,
  checkReport: AcceptanceCheckReport | null,
  options: RunVerifierOptions,
): Promise<VerifierOutcome> {
  const state = await readChangeState(projectRoot, name);
  const notes: string[] = [];

  let brief = '';
  try {
    brief = await readTextFile(path.join(projectRoot, 'changes', name, 'brief.md'));
  } catch {
    notes.push('brief.md missing');
  }

  let frozenSource: 'version-store' | 'current-file' | 'missing' = 'missing';
  let frozenContent: string | null = null;
  if (state.spec_hash) {
    const blob = await readSpecBlob(projectRoot, state.spec_hash);
    if (blob !== null) {
      frozenContent = blob;
      frozenSource = 'version-store';
    }
  }
  if (frozenContent === null && state.spec_ref) {
    try {
      frozenContent = await readTextFile(path.join(projectRoot, state.spec_ref));
      frozenSource = 'current-file';
      notes.push('frozen spec blob missing; verifier was given the current file');
    } catch {
      notes.push('spec content unavailable');
    }
  }

  const section =
    frozenContent && state.spec_anchor ? extractAnchorSection(frozenContent, state.spec_anchor) : null;
  const acceptance =
    section?.acceptance ?? checkReport?.results.map((entry) => ({ id: entry.id, text: entry.text, check: entry.check })) ?? [];

  const scope = await collectImplementationScope(projectRoot, name, {
    module: state.module ?? null,
    allow: await resolveScopeAllow(projectRoot),
  });

  const prompt = buildVerifierPrompt({
    state,
    brief,
    specSection: section?.text ?? frozenContent,
    acceptance,
    checkReport,
    implementationScope: {
      changes: scope.changes.map((entry) => ({ path: entry.path, kind: entry.kind })),
      unattributed: scope.unattributed,
    },
    frozenSource,
  });

  await appendChangeEvent(projectRoot, name, 'verify-started', {
    agent: options.runner.id,
    mode: 'independent-verifier',
  }, { phase: state.phase, now: options.now });

  const result = await options.runner.run({
    prompt,
    cwd: projectRoot,
    model: options.model,
    timeoutMs: options.timeoutMs,
  });
  if (result.exitCode !== 0) {
    notes.push('verifier agent exited with code ' + result.exitCode);
    return { status: 'unavailable', report: null, agentId: options.runner.id, exitCode: result.exitCode, notes };
  }

  const report = parseVerifierOutput(result.stdout);
  if (!report) {
    notes.push('verifier output did not contain a parsable verification YAML block');
    return { status: 'invalid', report: null, agentId: options.runner.id, exitCode: result.exitCode, notes };
  }
  const coverage = validateVerifierCoverage(state, report);
  if (coverage.length > 0) {
    notes.push(...coverage);
    return { status: 'invalid', report: null, agentId: options.runner.id, exitCode: result.exitCode, notes };
  }
  return { status: 'verdict', report, agentId: options.runner.id, exitCode: result.exitCode, notes };
}
