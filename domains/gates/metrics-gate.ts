import { readProjectConfig } from '../project/config.js';
import {
  parseMetricsGateConfig,
  type MetricsGateThresholds,
} from '../metrics/metric-gates.js';

export interface ProjectMetricsGate {
  thresholds: MetricsGateThresholds;
  /** 配置本身的问题（未知指标名、min > max 等）。非空即门禁失败，不静默忽略。 */
  errors: string[];
}

/** 从项目配置里取 `gates.metrics`（含全局配置合并与校验）。 */
export async function readMetricsGate(projectRoot: string): Promise<ProjectMetricsGate> {
  const config = await readProjectConfig(projectRoot);
  return parseMetricsGateConfig((config as { gates?: { metrics?: unknown } }).gates?.metrics);
}
