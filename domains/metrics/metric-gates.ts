/**
 * 指标门禁的**判定语义**（叶子模块：不 import 任何东西，避免 config ↔ gates 循环引用）。
 *
 * 默认（不配置）行为就是这一批之前的行为：六个指标各自有方向，只许持平或变好。
 * 配置（`.cometflow/config.yaml` 的 `gates.metrics`）**只做加法**：
 *
 * - `min` / `max`：绝对阈值，直接判当前值；
 * - `direction` + `tolerance`：覆盖默认方向，并允许噪声范围内波动（例如 `tolerance: 1`）。
 *
 * 「不配就不新增约束」是硬要求：升级版本不应该让任何项目突然变红。
 */
export const METRIC_DIRECTIONS: Readonly<Record<string, 'up' | 'down'>> = {
  acceptance_checkable_rate: 'up',
  anchor_coverage_rate: 'up',
  specs: 'up',
  capabilities: 'up',
  versions_total: 'up',
  drift_count: 'down',
};

export const METRIC_NAMES: readonly string[] = Object.keys(METRIC_DIRECTIONS);

export interface MetricsGateThreshold {
  min?: number;
  max?: number;
  direction?: 'up' | 'down';
  tolerance?: number;
}

export type MetricsGateThresholds = Record<string, MetricsGateThreshold>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 解析并校验 `gates.metrics`。返回的问题必须让门禁变红，不能静默忽略。 */
export function parseMetricsGateConfig(raw: unknown): {
  thresholds: MetricsGateThresholds;
  errors: string[];
} {
  const errors: string[] = [];
  const thresholds: MetricsGateThresholds = {};
  if (raw === undefined || raw === null) return { thresholds, errors };
  if (!isPlainObject(raw)) {
    return { thresholds, errors: ['gates.metrics must be a mapping of metric name → { min | max | direction | tolerance }'] };
  }
  for (const [metric, value] of Object.entries(raw)) {
    if (!METRIC_NAMES.includes(metric)) {
      errors.push('gates.metrics.' + metric + ' 不是已知指标；可用：' + METRIC_NAMES.join(', '));
      continue;
    }
    if (!isPlainObject(value)) {
      errors.push('gates.metrics.' + metric + ' must be a mapping');
      continue;
    }
    const threshold: MetricsGateThreshold = {};
    for (const key of ['min', 'max', 'tolerance'] as const) {
      const entry = value[key];
      if (entry === undefined) continue;
      if (typeof entry !== 'number' || Number.isNaN(entry)) {
        errors.push('gates.metrics.' + metric + '.' + key + ' must be a number');
        continue;
      }
      if (key === 'tolerance' && entry < 0) {
        errors.push('gates.metrics.' + metric + '.tolerance must be >= 0');
        continue;
      }
      threshold[key] = entry;
    }
    if (value.direction !== undefined) {
      if (value.direction !== 'up' && value.direction !== 'down') {
        errors.push('gates.metrics.' + metric + '.direction must be one of: up, down');
      } else {
        threshold.direction = value.direction;
      }
    }
    if (
      threshold.min !== undefined &&
      threshold.max !== undefined &&
      threshold.min > threshold.max
    ) {
      errors.push('gates.metrics.' + metric + ': min (' + threshold.min + ') 不能大于 max (' + threshold.max + ')');
    }
    thresholds[metric] = threshold;
  }
  return { thresholds, errors };
}

export interface MetricsGateEvaluation {
  /** 失败原因（人类可读，逐条） */
  failures: string[];
}

/**
 * 判定当前指标是否通过门禁。
 *
 * 两类判定互不替代：
 * - 绝对阈值（min/max）看**当前值本身**；
 * - 相对基线看**变化方向**（方向取配置，缺省用内置表；容差取配置，缺省 0）。
 */
export function evaluateMetricsGate(options: {
  thresholds: MetricsGateThresholds;
  baseline: Record<string, unknown> | null;
  current: Record<string, number | null>;
}): MetricsGateEvaluation {
  const failures: string[] = [];
  const metrics = new Set<string>([
    ...Object.keys(options.thresholds),
    ...Object.keys(options.baseline ?? {}),
    ...Object.keys(options.current),
  ]);

  for (const metric of [...metrics].sort()) {
    const threshold = options.thresholds[metric] ?? {};
    const current = options.current[metric];
    if (typeof current !== 'number') continue; // null / 缺数据不判：与 metrics 的「空即 null」口径一致

    if (threshold.min !== undefined && current < threshold.min) {
      failures.push(metric + ' 低于下限：' + current + ' < ' + threshold.min);
    }
    if (threshold.max !== undefined && current > threshold.max) {
      failures.push(metric + ' 超过上限：' + current + ' > ' + threshold.max);
    }

    const baselineValue = options.baseline?.[metric];
    if (typeof baselineValue !== 'number') continue;
    const direction = threshold.direction ?? METRIC_DIRECTIONS[metric];
    if (direction === undefined) continue;
    const tolerance = threshold.tolerance ?? 0;
    if (direction === 'up' && current < baselineValue - tolerance) {
      failures.push(
        metric + ' 退化：' + baselineValue + ' → ' + current + (tolerance > 0 ? '（容差 ' + tolerance + '）' : ''),
      );
    }
    if (direction === 'down' && current > baselineValue + tolerance) {
      failures.push(
        metric + ' 升高：' + baselineValue + ' → ' + current + (tolerance > 0 ? '（容差 ' + tolerance + '）' : ''),
      );
    }
  }
  return { failures };
}

/** 人类可读的「当前生效阈值」——看不见的约束等于没有约束。 */
export function describeMetricsGate(thresholds: MetricsGateThresholds): string[] {
  const lines: string[] = [];
  for (const metric of METRIC_NAMES) {
    const threshold = thresholds[metric];
    const direction = threshold?.direction ?? METRIC_DIRECTIONS[metric];
    const parts: string[] = [];
    if (threshold?.min !== undefined) parts.push('min ' + threshold.min);
    if (threshold?.max !== undefined) parts.push('max ' + threshold.max);
    parts.push('相对基线 ' + (direction === 'up' ? '只许持平或变好' : '只许持平或变小'));
    if (threshold?.tolerance !== undefined && threshold.tolerance > 0) parts.push('容差 ' + threshold.tolerance);
    if (threshold === undefined) parts.push('（默认）');
    lines.push('  ' + metric + ': ' + parts.join(' / '));
  }
  return lines;
}
