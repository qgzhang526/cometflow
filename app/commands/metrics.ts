import path from 'node:path';
import { collectMetrics, formatMetrics } from '../../domains/metrics/metrics-service.js';

export async function metricsCommand(
  targetPath: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const report = await collectMetrics(projectRoot);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const line of formatMetrics(report)) console.log(line);
}
