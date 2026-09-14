#!/usr/bin/env node
/**
 * 只读门禁：把「spec 是不是还是唯一根源」变成 CI 能判定的退出码。
 *
 * 判定项：
 *   spec validate / spec verify / doctor / change gc（dry-run）
 *   plan validate（跳过故意损坏的 fixture）
 *   metrics 对照基线（关键指标只许持平或变好）
 *
 * 用法：
 *   node scripts/spec-gates.mjs [projectPath]
 *   node scripts/spec-gates.mjs [projectPath] --update-baseline
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'app', 'cli', 'index.ts');

export const BASELINE_FILE = 'metrics-baseline.json';

/** 指标方向：up = 越大越好，down = 越小越好。 */
const DIRECTIONS = {
  acceptance_checkable_rate: 'up',
  anchor_coverage_rate: 'up',
  specs: 'up',
  capabilities: 'up',
  versions_total: 'up',
  drift_count: 'down',
};

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

function flattenMetrics(report) {
  return {
    acceptance_checkable_rate: report.spec_health.acceptance_checkable_rate,
    anchor_coverage_rate: report.spec_health.anchor_coverage_rate,
    specs: report.spec_health.specs,
    capabilities: report.spec_health.capabilities,
    versions_total: report.spec_health.versions.total_versions,
    drift_count: report.spec_health.drift.count,
  };
}

function compareToBaseline(baseline, current) {
  const failures = [];
  for (const [key, direction] of Object.entries(DIRECTIONS)) {
    const before = baseline[key];
    const after = current[key];
    if (typeof before !== 'number' || typeof after !== 'number') continue;
    if (direction === 'up' && after < before) {
      failures.push(key + ' 退化：' + before + ' → ' + after);
    }
    if (direction === 'down' && after > before) {
      failures.push(key + ' 升高：' + before + ' → ' + after);
    }
  }
  return failures;
}

/**
 * 跑一组只读门禁。返回 { ok, results }；调用方决定如何打印与退出。
 */
export function runSpecGates(projectRoot, options = {}) {
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    return ok;
  };

  const steps = [
    ['spec validate', ['spec', 'validate', '.']],
    ['spec verify', ['spec', 'verify', '.']],
    ['doctor', ['doctor', '.']],
    ['change gc (dry-run)', ['change', 'gc', '.', '--json']],
  ];
  for (const [name, args] of steps) {
    const result = runCli(args, { cwd: projectRoot });
    record(name, result.code === 0, result.code === 0 ? '' : (result.stdout + result.stderr).trim());
  }

  // plan validate：fixture 里有一个故意损坏的 plan（broken.*），跳过它。
  const plansDir = path.join(projectRoot, '.cometflow', 'plans');
  if (existsSync(plansDir)) {
    const goals = readdirSync(plansDir)
      .filter((entry) => entry.endsWith('.task-plan.yaml') && !entry.startsWith('broken'))
      .map((entry) => entry.replace(/\.task-plan\.yaml$/u, ''))
      .sort();
    for (const goal of goals) {
      const result = runCli(['plan', 'validate', goal, '.'], { cwd: projectRoot });
      record('plan validate ' + goal, result.code === 0, (result.stdout + result.stderr).trim());
    }
  }

  // metrics 与基线对比
  const metricsResult = runCli(['metrics', '.', '--json'], { cwd: projectRoot });
  if (metricsResult.code !== 0) {
    record('metrics', false, (metricsResult.stdout + metricsResult.stderr).trim());
    return { ok: false, results };
  }
  let report;
  try {
    report = JSON.parse(metricsResult.stdout);
  } catch {
    record('metrics', false, 'metrics --json 输出无法解析');
    return { ok: false, results };
  }
  const current = flattenMetrics(report);

  const baselinePath = path.join(projectRoot, BASELINE_FILE);
  if (options.updateBaseline === true) {
    writeFileSync(
      baselinePath,
      JSON.stringify({ schema: 'cometflow.metrics-baseline.v1', metrics: current }, null, 2) + '\n',
      'utf8',
    );
    record('metrics baseline', true, '已更新 ' + baselinePath);
    return { ok: results.every((entry) => entry.ok), results };
  }
  if (!existsSync(baselinePath)) {
    record('metrics baseline', false, '缺少 ' + baselinePath + '；先运行 --update-baseline');
    return { ok: false, results };
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).metrics;
  } catch {
    record('metrics baseline', false, baselinePath + ' 无法解析');
    return { ok: false, results };
  }
  const regressions = compareToBaseline(baseline, current);
  record(
    'metrics baseline',
    regressions.length === 0,
    regressions.length === 0 ? '' : regressions.join('; '),
  );

  return { ok: results.every((entry) => entry.ok), results };
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
