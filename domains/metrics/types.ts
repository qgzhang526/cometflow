export const METRICS_SCHEMA = 'cometflow.metrics.v1';

export type VerdictSource = 'check' | 'document' | 'agent' | 'eval' | 'uncovered';

/** 一个 change 的最终结局（用于分母口径）。 */
export type ChangeOutcome =
  | 'archived'
  | 'passing'
  | 'failing'
  | 'blocked'
  | 'unverified'
  | 'pending';

export interface RebuildSample {
  change: string;
  capability: string | null;
  module: string | null;
  spec_ref: string | null;
  spec_version: number | null;
  outcome: ChangeOutcome;
  verify_runs: number;
  /** 首次通过时累计的修复轮数；未通过为 null。 */
  attempts_to_pass: number | null;
  first_pass: boolean;
  /** 该 change 出现过的结论来源。 */
  sources: VerdictSource[];
  /** 该 change 所有轮次的结论全部来自 check。 */
  check_only: boolean;
  blocked: boolean;
  legacy: boolean;
}

export interface RebuildBucket {
  key: string;
  sample_size: number;
  first_pass_rate: number | null;
  mean_attempts_to_pass: number | null;
  blocked_rate: number | null;
}

export interface RebuildMetrics {
  sample_size: number;
  /** 出现过 verify-result 的 change 数（与 sample_size 同义，显式命名便于阅读）。 */
  verified_changes: number;
  total_changes: number;
  archived_changes: number;
  first_pass_rate: number | null;
  mean_attempts_to_pass: number | null;
  pass_rate: number | null;
  blocked_rate: number | null;
  verdict_sources: Record<VerdictSource, number>;
  check_coverage_rate: number | null;
  /** 独立 Verifier 的调用次数与耗时——回答「引入独立验证要付多少代价」。 */
  verifier: {
    runs: number;
    total_ms: number;
    mean_ms: number | null;
  };
  per_capability: RebuildBucket[];
  per_module: RebuildBucket[];
  samples: RebuildSample[];
}

export interface SpecHealthEntry {
  path: string;
  anchors: number;
  acceptance_total: number;
  acceptance_with_check: number;
  checkable_rate: number | null;
  bound_anchors: number;
  coverage_rate: number | null;
  uncovered_anchors: string[];
  versions: number;
}

export interface SpecHealthMetrics {
  specs: number;
  capabilities: number;
  acceptance_total: number;
  acceptance_with_check: number;
  acceptance_checkable_rate: number | null;
  anchor_total: number;
  anchor_bound: number;
  anchor_coverage_rate: number | null;
  drift: {
    count: number;
    by_kind: Record<string, number>;
    by_severity: Record<string, number>;
    unresolvable: number;
    oldest_spec_change_age_days: number | null;
  };
  versions: {
    specs_tracked: number;
    total_versions: number;
    specs_with_multiple_versions: number;
  };
  entries: SpecHealthEntry[];
}

export interface MetricsReport {
  schema: typeof METRICS_SCHEMA;
  generated_at: string;
  project: {
    changes: number;
    active_changes: number;
    archived_changes: number;
    specs: number;
    capabilities: number;
  };
  rebuild: RebuildMetrics;
  spec_health: SpecHealthMetrics;
  /** 口径提示：样本过小、老数据缺字段等，避免把指标读成它不代表的东西。 */
  notes: string[];
}

export interface CollectMetricsOptions {
  /** 所有时间相关字段都以它为准；测试传入固定值以保证输出可复现。 */
  now?: Date;
}

/** 样本量小于该值时提示「不要据此判断趋势」。 */
export const SMALL_SAMPLE_THRESHOLD = 5;

export function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

export function sortedRecord(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
