<template>
  <div class="card">
    <div class="row">
      <h2>质量与健康度</h2>
      <span class="grow" />
      <span v-if="report" class="muted">{{ generatedAt }}</span>
      <button class="ghost" @click="open = !open">{{ open ? '收起' : '展开' }}</button>
    </div>
    <p class="muted">
      与 <code>cometflow metrics . --json</code> 同一组指标；数值口径见
      <code>docs/plan/metrics-plan.md</code>。样本不足时域层会给 <code>null</code>，这里显示 <code>—</code>。
    </p>

    <p v-if="report === null" class="muted">加载中…</p>
    <template v-else-if="open">
      <div class="stat-grid">
        <div class="stat">
          <div class="num">{{ formatRate(report.rebuild.first_pass_rate) }}</div>
          <div class="label">首次通过率</div>
        </div>
        <div class="stat">
          <div class="num">{{ formatRate(report.rebuild.check_coverage_rate) }}</div>
          <div class="label">结论全来自 check</div>
        </div>
        <div class="stat">
          <div class="num">{{ formatRate(report.spec_health.acceptance_checkable_rate) }}</div>
          <div class="label">验收项可执行率</div>
        </div>
        <div class="stat">
          <div class="num">{{ formatRate(report.spec_health.anchor_coverage_rate) }}</div>
          <div class="label">anchor 覆盖率</div>
        </div>
      </div>

      <table>
        <tbody>
          <tr><th>样本量（有 verify 结论的 change）</th><td>{{ report.rebuild.sample_size }} / {{ report.rebuild.total_changes }}</td></tr>
          <tr><th>通过率（已归档口径）</th><td>{{ formatRate(report.rebuild.pass_rate) }}</td></tr>
          <tr><th>阻塞率</th><td>{{ formatRate(report.rebuild.blocked_rate) }}</td></tr>
          <tr><th>平均修复轮次</th><td>{{ report.rebuild.mean_attempts_to_pass ?? '—' }}</td></tr>
          <tr>
            <th>独立 Verifier</th>
            <td>{{ report.rebuild.verifier.runs }} 次 · 平均 {{ report.rebuild.verifier.mean_ms ?? '—' }} ms</td>
          </tr>
          <tr><th>spec 漂移</th><td>{{ report.spec_health.drift.count }} 处 · 无法判定 {{ report.spec_health.drift.unresolvable }}</td></tr>
          <tr>
            <th>版本链</th>
            <td>
              {{ report.spec_health.versions.specs_tracked }} 份被跟踪 ·
              {{ report.spec_health.versions.total_versions }} 个版本
            </td>
          </tr>
        </tbody>
      </table>

      <h3>门禁阈值（当前生效）</h3>
      <p class="muted">
        来自 <code>.cometflow/config.yaml</code> 的 <code>gates.metrics</code>；
        不配置就不新增约束，此时按内置方向表「只许持平或变好」。
      </p>
      <pre v-if="gates" class="logbox">{{ gates.lines.join('\n') }}</pre>
      <div v-for="(error, index) in gates?.errors ?? []" :key="index" class="finding">[error] {{ error }}</div>

      <template v-if="report.notes.length > 0">
        <h3>口径提示</h3>
        <div v-for="(note, index) in report.notes" :key="index" class="finding warning">{{ note }}</div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { MetricsGateInfo, MetricsReport } from '../api/types';
import { formatRate, relativeTime } from '../utils/format';

const props = defineProps<{ report: MetricsReport | null; gates: MetricsGateInfo | null }>();
const open = ref(false);
const generatedAt = computed(() => (props.report === null ? '' : '生成于 ' + relativeTime(props.report.generated_at)));
</script>
