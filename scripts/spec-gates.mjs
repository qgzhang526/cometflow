#!/usr/bin/env node
/**
 * 只读门禁的 CI 入口（**薄壳**）。
 *
 * 判定逻辑不在这里，而在 `domains/gates/spec-gates.ts`，由 `cometflow gate check` 暴露。
 * CI 与本地提交门禁因此共用一份实现——H3 那次 bash 回归与真实逻辑分叉，让一条「应该被阻断」
 * 的断言其实从没验证到漂移。门禁最怕的不是漏判，是**两套判定**。
 *
 * 用法：
 *   node scripts/spec-gates.mjs [projectPath]
 *   node scripts/spec-gates.mjs [projectPath] --update-baseline
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'app', 'cli', 'index.ts');

export function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * 跑一组只读门禁。返回 { ok, results }。
 *
 * 同步实现是刻意的（回归脚本把它当同步函数用），但底层只有**一次** CLI 调用——
 * 而不是每个判定各起一个进程：门禁会被装进 git hook，每次提交都要跑。
 */
export function runSpecGates(projectRoot, options = {}) {
  const args = ['gate', 'check', projectRoot, '--json'];
  if (options.updateBaseline === true) args.push('--update-baseline');
  const result = runCli(args);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return {
      ok: false,
      results: [
        {
          name: 'gate check',
          ok: false,
          detail: (result.stdout + result.stderr).trim().slice(0, 500),
        },
      ],
    };
  }
  return { ok: report.ok === true, results: report.steps ?? [] };
}

function main() {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');
  const target = args.find((arg) => !arg.startsWith('--')) ?? path.join('experiments', 'regression-fixture');
  const projectRoot = path.resolve(ROOT, target);

  console.log('spec gates on ' + projectRoot);
  const { ok, results } = runSpecGates(projectRoot, { updateBaseline });
  for (const entry of results) {
    console.log((entry.ok ? 'PASS' : 'FAIL') + ' ' + entry.name + (entry.detail ? ' — ' + entry.detail : ''));
  }
  console.log(ok ? 'spec-gates: PASS' : 'spec-gates: FAILED');
  process.exitCode = ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
