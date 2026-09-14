import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCommand } from '../../platform/process/spawn-command.js';
import { readTextFile } from '../../platform/fs/read-file.js';
import { redactSecrets } from '../../platform/io/redact.js';
import { extractAnchorSection } from '../spec/spec-parse.js';
import { readSpecBlob } from '../spec/spec-version.js';
import { readChangeState } from './change-store.js';
import type { ChangeState } from './change-types.js';

export const ACCEPTANCE_CHECKS_SCHEMA = 'cometflow.acceptance-checks.v1';

export interface AcceptanceCheckResult {
  id: string;
  text: string;
  /** null 表示该验收项没有声明可执行命令。 */
  check: string | null;
  /** 有无 check：none 的项只能由独立 Verifier 或人工判定。 */
  kind: 'command' | 'none';
  passed: boolean | null;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  reason: string;
}

export interface AcceptanceCheckReport {
  schema: typeof ACCEPTANCE_CHECKS_SCHEMA;
  change: string;
  spec_ref: string | null;
  spec_anchor: string | null;
  spec_version: number | null;
  spec_hash: string | null;
  /** 冻结内容是否成功从版本仓取回。 */
  frozen_source: 'version-store' | 'current-file';
  checked_at: string;
  results: AcceptanceCheckResult[];
  uncovered: string[];
  passed: boolean;
}

/** 引号感知的命令行拆分，避免把 `-run "Test A"` 拆坏。 */
export function parseCommandLine(text: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      // 双引号内的单引号是参数的一部分（如 `-e "process.env.X === '1'"`），不能当分隔符。
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current !== '') tokens.push(current);
  return { command: tokens[0] ?? '', args: tokens.slice(1) };
}

export function acceptanceChecksPath(projectRoot: string, name: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'changes', name, 'acceptance-checks.json');
}

async function frozenSpecContent(
  projectRoot: string,
  state: ChangeState,
): Promise<{ content: string; source: 'version-store' | 'current-file' } | null> {
  if (state.spec_hash) {
    const blob = await readSpecBlob(projectRoot, state.spec_hash);
    if (blob !== null) return { content: blob, source: 'version-store' };
  }
  if (!state.spec_ref) return null;
  try {
    return {
      content: await readTextFile(path.join(projectRoot, state.spec_ref)),
      source: 'current-file',
    };
  } catch {
    return null;
  }
}

export interface RunAcceptanceChecksOptions {
  timeoutMs?: number;
  now?: Date;
}

/**
 * 把 spec 里声明的 acceptance 变成真正跑起来的检查。
 *
 * 这是「重建质量可判定」的基础：spec 若能用 `- check: <command>` 表达验收，
 * 那么「重新生成的代码是否可用」就不再依赖人的印象，而是命令的退出码。
 */
export async function runAcceptanceChecks(
  projectRoot: string,
  name: string,
  options: RunAcceptanceChecksOptions = {},
): Promise<AcceptanceCheckReport> {
  const state = await readChangeState(projectRoot, name);
  const frozen = await frozenSpecContent(projectRoot, state);
  const results: AcceptanceCheckResult[] = [];

  if (!frozen || !state.spec_anchor) {
    return {
      schema: ACCEPTANCE_CHECKS_SCHEMA,
      change: name,
      spec_ref: state.spec_ref,
      spec_anchor: state.spec_anchor,
      spec_version: state.spec_version,
      spec_hash: state.spec_hash,
      frozen_source: frozen?.source ?? 'current-file',
      checked_at: (options.now ?? new Date()).toISOString(),
      results,
      uncovered: [...state.acceptance_ids],
      passed: false,
    };
  }

  const section = extractAnchorSection(frozen.content, state.spec_anchor);
  const items = section?.acceptance ?? [];

  for (const item of items) {
    // 只跑冻结 acceptance_ids 覆盖的项，避免 spec 新增验收项时悄悄改变判定范围。
    if (state.acceptance_ids.length > 0 && !state.acceptance_ids.includes(item.id)) continue;
    if (!item.check) {
      results.push({
        id: item.id,
        text: item.text,
        check: null,
        kind: 'none',
        passed: null,
        exitCode: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        reason: 'no check declared; requires independent verifier or human verdict',
      });
      continue;
    }
    const { command, args } = parseCommandLine(item.check);
    if (command === '') {
      results.push({
        id: item.id,
        text: item.text,
        check: item.check,
        kind: 'command',
        passed: false,
        exitCode: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        reason: 'check command is empty',
      });
      continue;
    }
    const outcome = await runCommand(command, args, {
      cwd: projectRoot,
      timeoutMs: options.timeoutMs ?? 120_000,
    });
    results.push({
      id: item.id,
      text: item.text,
      check: item.check,
      kind: 'command',
      passed: outcome.exitCode === 0 && !outcome.timedOut,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      // 命令输出会落盘成证据，按 aggressive 档裁剪（含 `token: xxx` 这类键值）。
      stdout: redactSecrets(outcome.stdout, { aggressive: true }).slice(0, 8_000),
      stderr: redactSecrets(outcome.stderr, { aggressive: true }).slice(0, 8_000),
      reason:
        outcome.exitCode === 0
          ? 'check passed'
          : outcome.timedOut
            ? 'check timed out'
            : 'check exited with code ' + outcome.exitCode,
    });
  }

  const covered = new Set(results.map((entry) => entry.id));
  const uncovered = state.acceptance_ids.filter((id) => !covered.has(id));
  const report: AcceptanceCheckReport = {
    schema: ACCEPTANCE_CHECKS_SCHEMA,
    change: name,
    spec_ref: state.spec_ref,
    spec_anchor: state.spec_anchor,
    spec_version: state.spec_version,
    spec_hash: state.spec_hash,
    frozen_source: frozen.source,
    checked_at: (options.now ?? new Date()).toISOString(),
    results,
    uncovered,
    // 只要有一条命令失败就不是 passed，与「全部 acceptance 必须通过」一致。
    passed: results.every((entry) => entry.passed !== false),
  };

  const filePath = acceptanceChecksPath(projectRoot, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(report, null, 2));
  return report;
}
