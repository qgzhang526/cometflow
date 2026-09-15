import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { runDoctor } from '../dashboard/doctor.js';
import { collectMetrics } from '../metrics/metrics-service.js';
import { evaluateMetricsGate, METRIC_DIRECTIONS } from '../metrics/metric-gates.js';
import type { MetricsReport } from '../metrics/types.js';
import { validateSpecs } from '../spec/spec-validate.js';
import { verifySpecIntegrity } from '../spec/spec-verify.js';
import { readTaskPlan } from '../task-plan/task-plan-store.js';
import { validateTaskPlan } from '../task-plan/task-plan-validate.js';
import { planEvidenceGc } from '../workflow/evidence-retention.js';
import { readMetricsGate } from './metrics-gate.js';

/**
 * 只读门禁的**唯一实现**：把「spec 是不是还是唯一根源」变成一组可判定的步骤。
 *
 * CI（`scripts/spec-gates.mjs`）与本地提交门禁（`cometflow gate check`，git hook 调它）
 * 都走这里。之所以要收进 domain 而不是各写一份脚本：H3 那次 bash 回归与实际逻辑分叉，
 * 让一条「应该被阻断」的断言其实从没验证到漂移——门禁最怕的不是漏判，是**两套判定**。
 */
export const BASELINE_FILE = 'metrics-baseline.json';
export const BASELINE_SCHEMA = 'cometflow.metrics-baseline.v1';

/** 默认指标方向（配置可覆盖；语义定义在 `domains/metrics/metric-gates.ts`）。 */
export { METRIC_DIRECTIONS } from '../metrics/metric-gates.js';

export interface GateStepResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SpecGatesResult {
  ok: boolean;
  steps: GateStepResult[];
}

export interface SpecGatesOptions {
  /** 重写指标基线而不是对比（指标变好时显式更新）。 */
  updateBaseline?: boolean;
}

/** 指标在样本为空时是 `null`（「没有数据」≠「表现完美」），基线对比遇到 null 直接跳过。 */
export function flattenMetrics(report: MetricsReport): Record<string, number | null> {
  return {
    acceptance_checkable_rate: report.spec_health.acceptance_checkable_rate,
    anchor_coverage_rate: report.spec_health.anchor_coverage_rate,
    specs: report.spec_health.specs,
    capabilities: report.spec_health.capabilities,
    versions_total: report.spec_health.versions.total_versions,
    drift_count: report.spec_health.drift.count,
  };
}

export function compareToBaseline(
  baseline: Record<string, unknown>,
  current: Record<string, number | null>,
): string[] {
  return evaluateMetricsGate({ thresholds: {}, baseline, current }).failures;
}

function summarize(findings: { severity: string; code: string }[], limit = 3): string {
  const errors = findings.filter((finding) => finding.severity === 'error');
  if (errors.length === 0) return '';
  const codes = errors.slice(0, limit).map((finding) => finding.code).join(', ');
  return errors.length > limit ? errors.length + ' error(s)：' + codes + ' 等' : codes;
}

/** plan 文件名 → goalId；fixture 里 `broken.*` 是故意损坏的样本，跳过它。 */
function listPlanGoalIds(projectRoot: string): string[] {
  const plansDir = path.join(projectRoot, '.cometflow', 'plans');
  if (!existsSync(plansDir)) return [];
  return readdirSync(plansDir)
    .filter((entry) => entry.endsWith('.task-plan.yaml') && !entry.startsWith('broken'))
    .map((entry) => entry.replace(/\.task-plan\.yaml$/u, ''))
    .sort();
}

export async function runSpecGates(
  projectRoot: string,
  options: SpecGatesOptions = {},
): Promise<SpecGatesResult> {
  const steps: GateStepResult[] = [];
  const record = (name: string, ok: boolean, detail = ''): void => {
    steps.push({ name, ok, detail });
  };

  const validation = await validateSpecs(projectRoot);
  record('spec validate', validation.valid, summarize(validation.findings));

  const integrity = await verifySpecIntegrity(projectRoot);
  record('spec verify', integrity.valid, summarize(integrity.findings));

  const doctor = await runDoctor(projectRoot);
  record('doctor', doctor.healthy, summarize(doctor.findings));

  // dry-run：只证明证据回收计划算得出来，不修改任何东西。
  const gcPlan = await planEvidenceGc(projectRoot);
  record(
    'change gc (dry-run)',
    true,
    gcPlan.reclaimableBytes > 0 ? '可回收 ' + gcPlan.reclaimableBytes + ' 字节' : '',
  );

  for (const goalId of listPlanGoalIds(projectRoot)) {
    const plan = await readTaskPlan(projectRoot, goalId);
    const result = await validateTaskPlan(projectRoot, plan);
    record('plan validate ' + goalId, result.valid, summarize(result.findings));
  }

  const report = await collectMetrics(projectRoot);
  const current = flattenMetrics(report);
  const configured = await readMetricsGate(projectRoot);
  // 配置本身有问题（未知指标名、min > max）必须让门禁变红：静默忽略等于给出一条假约束。
  record('metrics thresholds', configured.errors.length === 0, configured.errors.join('; '));
  const baselinePath = path.join(projectRoot, BASELINE_FILE);
  if (options.updateBaseline === true) {
    await atomicWriteText(
      baselinePath,
      JSON.stringify({ schema: BASELINE_SCHEMA, metrics: current }, null, 2) + '\n',
    );
    record('metrics baseline', true, '已更新 ' + baselinePath);
    return { ok: steps.every((step) => step.ok), steps };
  }
  if (!existsSync(baselinePath)) {
    record('metrics baseline', false, '缺少 ' + baselinePath + '；先运行 --update-baseline');
    return { ok: false, steps };
  }
  let baseline: Record<string, unknown>;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).metrics;
  } catch {
    record('metrics baseline', false, baselinePath + ' 无法解析');
    return { ok: false, steps };
  }
  const failures = evaluateMetricsGate({ thresholds: configured.thresholds, baseline, current }).failures;
  record('metrics baseline', failures.length === 0, failures.join('; '));

  return { ok: steps.every((step) => step.ok), steps };
}
