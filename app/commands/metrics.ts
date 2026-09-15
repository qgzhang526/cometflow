import path from 'node:path';
import { collectMetrics, formatMetrics } from '../../domains/metrics/metrics-service.js';
import { describeMetricsGate } from '../../domains/metrics/metric-gates.js';
import { readMetricsGate } from '../../domains/gates/metrics-gate.js';

export async function metricsCommand(
  targetPath: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const report = await collectMetrics(projectRoot);
  const gate = await readMetricsGate(projectRoot);
  if (options.json) {
    // 阈值只影响门禁结论，不参与指标本身；有配置时才附加，避免给没有配置的项目改 schema。
    const payload =
      Object.keys(gate.thresholds).length > 0 || gate.errors.length > 0
        ? { ...report, gates: { metrics: gate.thresholds, errors: gate.errors } }
        : report;
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  for (const line of formatMetrics(report)) console.log(line);
  // 生效阈值要看得见：看不见的约束等于没有约束。
  console.log('');
  console.log('门禁阈值（cometflow gate check，配置见 .cometflow/config.yaml 的 gates.metrics）：');
  for (const line of describeMetricsGate(gate.thresholds)) console.log(line);
  for (const error of gate.errors) console.log('  ERROR ' + error);
}
