import { describe, expect, it } from 'vitest';
import {
  describeMetricsGate,
  evaluateMetricsGate,
  parseMetricsGateConfig,
} from '../../domains/metrics/metric-gates.js';

describe('parseMetricsGateConfig', () => {
  it('没配置就没有约束、也没有错误', () => {
    expect(parseMetricsGateConfig(undefined)).toEqual({ thresholds: {}, errors: [] });
  });

  it('解析 min / max / direction / tolerance', () => {
    const { thresholds, errors } = parseMetricsGateConfig({
      anchor_coverage_rate: { min: 0.8 },
      drift_count: { max: 0 },
      specs: { direction: 'up', tolerance: 1 },
    });

    expect(errors).toEqual([]);
    expect(thresholds.anchor_coverage_rate).toEqual({ min: 0.8 });
    expect(thresholds.drift_count).toEqual({ max: 0 });
    expect(thresholds.specs).toEqual({ direction: 'up', tolerance: 1 });
  });

  it('未知指标名要报错并列出可用指标——静默忽略等于给出一条假约束', () => {
    const { errors } = parseMetricsGateConfig({ coverage_rate: { min: 1 } });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('不是已知指标');
    expect(errors[0]).toContain('anchor_coverage_rate');
  });

  it('min > max、非数字、非法方向、负容差都要报错', () => {
    const { errors } = parseMetricsGateConfig({
      specs: { min: 5, max: 1 },
      drift_count: { max: 'zero' },
      capabilities: { direction: 'sideways' },
      versions_total: { tolerance: -1 },
    });

    expect(errors).toHaveLength(4);
    expect(errors.join('\n')).toContain('不能大于 max');
    expect(errors.join('\n')).toContain('must be a number');
    expect(errors.join('\n')).toContain('direction must be one of');
    expect(errors.join('\n')).toContain('tolerance must be >= 0');
  });
});

describe('evaluateMetricsGate', () => {
  it('绝对阈值直接判当前值', () => {
    const result = evaluateMetricsGate({
      thresholds: { anchor_coverage_rate: { min: 0.8 }, drift_count: { max: 0 } },
      baseline: null,
      current: { anchor_coverage_rate: 0.75, drift_count: 2 },
    });

    expect(result.failures).toEqual([
      'anchor_coverage_rate 低于下限：0.75 < 0.8',
      'drift_count 超过上限：2 > 0',
    ]);
  });

  it('没有基线时只判绝对阈值（相对比较需要基线）', () => {
    expect(
      evaluateMetricsGate({ thresholds: {}, baseline: null, current: { specs: 1 } }).failures,
    ).toEqual([]);
  });

  it('缺省方向来自内置表：越大越好的下降即失败', () => {
    const result = evaluateMetricsGate({
      thresholds: {},
      baseline: { specs: 5, drift_count: 0 },
      current: { specs: 4, drift_count: 1 },
    });

    expect(result.failures).toEqual(['drift_count 升高：0 → 1', 'specs 退化：5 → 4']);
  });

  it('容差允许噪声范围内波动', () => {
    const tolerated = evaluateMetricsGate({
      thresholds: { specs: { tolerance: 1 } },
      baseline: { specs: 5 },
      current: { specs: 4 },
    });
    const exceeded = evaluateMetricsGate({
      thresholds: { specs: { tolerance: 1 } },
      baseline: { specs: 5 },
      current: { specs: 3 },
    });

    expect(tolerated.failures).toEqual([]);
    expect(exceeded.failures[0]).toContain('容差 1');
  });

  it('配置可以覆盖内置方向', () => {
    const result = evaluateMetricsGate({
      thresholds: { specs: { direction: 'down' } },
      baseline: { specs: 5 },
      current: { specs: 6 },
    });

    expect(result.failures).toEqual(['specs 升高：5 → 6']);
  });

  it('null（没有数据）不判，避免把「没测过」读成退化', () => {
    const result = evaluateMetricsGate({
      thresholds: { specs: { min: 10 } },
      baseline: { specs: 5 },
      current: { specs: null },
    });

    expect(result.failures).toEqual([]);
  });
});

describe('describeMetricsGate', () => {
  it('标明哪些是默认、哪些被显式配置', () => {
    const lines = describeMetricsGate({ anchor_coverage_rate: { min: 0.8 } });

    expect(lines.find((line) => line.includes('anchor_coverage_rate'))).toContain('min 0.8');
    expect(lines.find((line) => line.includes('anchor_coverage_rate'))).not.toContain('默认');
    expect(lines.find((line) => line.includes('drift_count'))).toContain('默认');
  });
});
