import { collectRebuildMetrics } from './rebuild-metrics.js';
import { collectSpecHealthMetrics } from './spec-health.js';
import {
  METRICS_SCHEMA,
  SMALL_SAMPLE_THRESHOLD,
  type CollectMetricsOptions,
  type MetricsReport,
} from './types.js';

/**
 * 聚合度量报告。
 *
 * 纯只读：不写任何文件、不修改任何状态。所有时间字段以 `options.now` 为准，
 * 因此传入同一个 now 时输出逐字可复现。
 */
export async function collectMetrics(
  projectRoot: string,
  options: CollectMetricsOptions = {},
): Promise<MetricsReport> {
  const now = options.now ?? new Date();
  const [rebuild, specHealth] = await Promise.all([
    collectRebuildMetrics(projectRoot),
    collectSpecHealthMetrics(projectRoot, { now }),
  ]);

  const notes = [...specHealth.legacyNotes];
  if (rebuild.metrics.sample_size === 0) {
    notes.push('还没有任何 change 走到过验证，重建质量指标为空');
  } else if (rebuild.metrics.sample_size < SMALL_SAMPLE_THRESHOLD) {
    notes.push(
      '样本量仅 ' +
        rebuild.metrics.sample_size +
        '，低于 ' +
        SMALL_SAMPLE_THRESHOLD +
        '；比率类指标波动很大，不要据此判断趋势',
    );
  }
  if (rebuild.legacyChanges.length > 0) {
    notes.push(
      rebuild.legacyChanges.length +
        ' 个 change 的验证记录没有 repair_attempts（机制之前创建），其轮数按 0 计：' +
        rebuild.legacyChanges.slice(0, 5).join(', ') +
        (rebuild.legacyChanges.length > 5 ? ' 等' : ''),
    );
  }
  if (specHealth.metrics.acceptance_total > 0 && specHealth.metrics.acceptance_with_check === 0) {
    notes.push('所有验收项都还没有可执行 check，重建质量只能靠独立 Verifier 或人工判定');
  }

  return {
    schema: METRICS_SCHEMA,
    generated_at: now.toISOString(),
    project: {
      changes: rebuild.metrics.total_changes,
      active_changes: rebuild.metrics.total_changes - rebuild.metrics.archived_changes,
      archived_changes: rebuild.metrics.archived_changes,
      specs: specHealth.metrics.specs,
      capabilities: specHealth.metrics.capabilities,
    },
    rebuild: rebuild.metrics,
    spec_health: specHealth.metrics,
    notes,
  };
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : (value * 100).toFixed(1) + '%';
}

export function formatMetrics(report: MetricsReport): string[] {
  const lines: string[] = [];
  const { rebuild, spec_health: health } = report;

  lines.push(
    'project: ' +
      report.project.changes +
      ' changes (' +
      report.project.active_changes +
      ' active / ' +
      report.project.archived_changes +
      ' archived), ' +
      report.project.specs +
      ' specs (' +
      report.project.capabilities +
      ' capabilities)',
  );
  lines.push('');
  lines.push('rebuild quality (sample=' + rebuild.sample_size + ' verified changes)');
  lines.push('  first_pass_rate        ' + percent(rebuild.first_pass_rate));
  lines.push('  mean_attempts_to_pass  ' + (rebuild.mean_attempts_to_pass ?? 'n/a'));
  lines.push('  pass_rate (archived)   ' + percent(rebuild.pass_rate));
  lines.push('  blocked_rate           ' + percent(rebuild.blocked_rate));
  lines.push('  check_coverage_rate    ' + percent(rebuild.check_coverage_rate));
  const sources = Object.entries(rebuild.verdict_sources)
    .filter(([, count]) => count > 0)
    .map(([source, count]) => source + '=' + count)
    .join(' ');
  lines.push('  verdict_sources        ' + (sources || '(none)'));
  for (const bucket of rebuild.per_capability) {
    lines.push(
      '  capability ' +
        bucket.key +
        ': n=' +
        bucket.sample_size +
        ' first_pass=' +
        percent(bucket.first_pass_rate) +
        ' attempts=' +
        (bucket.mean_attempts_to_pass ?? 'n/a') +
        ' blocked=' +
        percent(bucket.blocked_rate),
    );
  }

  lines.push('');
  lines.push('spec health');
  lines.push(
    '  acceptance_checkable   ' +
      health.acceptance_with_check +
      '/' +
      health.acceptance_total +
      ' (' +
      percent(health.acceptance_checkable_rate) +
      ')',
  );
  lines.push(
    '  anchor_coverage        ' +
      health.anchor_bound +
      '/' +
      health.anchor_total +
      ' (' +
      percent(health.anchor_coverage_rate) +
      ')',
  );
  lines.push(
    '  drift                  ' +
      health.drift.count +
      ' (unresolvable ' +
      health.drift.unresolvable +
      ', oldest spec change ' +
      (health.drift.oldest_spec_change_age_days ?? 'n/a') +
      ' days ago)',
  );
  lines.push(
    '  versions               ' +
      health.versions.total_versions +
      ' across ' +
      health.versions.specs_tracked +
      ' specs (' +
      health.versions.specs_with_multiple_versions +
      ' with >1 version)',
  );

  if (report.notes.length > 0) {
    lines.push('');
    for (const note of report.notes) lines.push('note: ' + note);
  }
  return lines;
}
