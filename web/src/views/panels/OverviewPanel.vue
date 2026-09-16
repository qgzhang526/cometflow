<template>
  <div class="card">
    <div class="row">
      <h2>项目状态</h2>
      <span class="grow" />
      <StatusBadge
        :tone="errorCount > 0 ? 'err' : warningCount > 0 ? 'warn' : 'ok'"
        :text="errorCount + ' error / ' + warningCount + ' warning'"
      />
      <button :disabled="loading" @click="reload">{{ loading ? '刷新中…' : '刷新' }}</button>
    </div>
    <div class="stat-grid">
      <div class="stat">
        <div class="num">{{ status?.goals.length ?? 0 }}</div>
        <div class="label">目标 Goals</div>
      </div>
      <div class="stat">
        <div class="num">{{ status?.plans.length ?? 0 }}</div>
        <div class="label">计划 Plans</div>
      </div>
      <div class="stat">
        <div class="num">{{ activeChanges }}</div>
        <div class="label">进行中变更</div>
      </div>
      <div class="stat">
        <div class="num">{{ status?.evolutions.length ?? 0 }}</div>
        <div class="label">进化提案</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>计划与变更</h2>
    <table>
      <thead>
        <tr><th>goal</th><th>plan 状态</th><th>任务数</th><th>change</th><th>phase</th></tr>
      </thead>
      <tbody>
        <tr v-for="plan in status?.plans ?? []" :key="plan.goal">
          <td><b>{{ plan.goal }}</b></td>
          <td>{{ plan.status }}</td>
          <td>{{ plan.tasks }}</td>
          <td colspan="2" class="muted">—</td>
        </tr>
        <tr v-for="change in status?.changes ?? []" :key="'c-' + change.name">
          <td class="muted">—</td>
          <td class="muted">—</td>
          <td class="muted">—</td>
          <td>{{ change.name }}</td>
          <td>
            <StatusBadge :tone="change.archived ? 'gray' : 'ok'" :text="change.phase + (change.archived ? ' archived' : '')" />
          </td>
        </tr>
        <tr v-if="(status?.plans.length ?? 0) === 0 && (status?.changes.length ?? 0) === 0">
          <td colspan="5" class="muted">暂无计划与变更</td>
        </tr>
      </tbody>
    </table>
  </div>

  <FindingsCard :findings="findings" @refresh="reload" @jump="jump" />
  <GateCard :gate="gate" @refresh="reload" />
  <MetricsCard :report="metrics?.report ?? null" :gates="metrics?.gates ?? null" />
  <MaintenanceCard :plan="maintenance" @refresh="reload" @changed="onMaintenanceChanged" />
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import FindingsCard from '../../components/FindingsCard.vue';
import GateCard from '../../components/GateCard.vue';
import MaintenanceCard from '../../components/MaintenanceCard.vue';
import MetricsCard from '../../components/MetricsCard.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { errorMessage } from '../../api/client';
import { refreshCounter } from '../../composables/useRefresh';
import type { PanelId } from '../../router';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { Finding, FindingsResponse, GateResponse, MaintenancePlan, MetricsResponse } from '../../api/types';

const project = useProjectStore();
const toasts = useToastStore();
const router = useRouter();

const status = computed(() => project.status);
const activeChanges = computed(() => (status.value?.changes ?? []).filter((change) => !change.archived).length);

const findings = ref<Finding[]>([]);
const metrics = ref<MetricsResponse | null>(null);
const maintenance = ref<MaintenancePlan | null>(null);
const gate = ref<GateResponse | null>(null);
const loading = ref(false);

const errorCount = computed(() => findings.value.filter((finding) => finding.severity === 'error').length);
const warningCount = computed(() => findings.value.filter((finding) => finding.severity === 'warning').length);

// 三个只读投影一次取齐：放在一起取而不是各卡片自己取，是为了让「问题数」「指标」「待清理量」
// 来自同一次快照——否则会出现「问题清单说没有残留文件、维护卡说还有 3 个」这种自相矛盾的画面。
async function loadVisibility(): Promise<void> {
  const [findingsData, metricsData, maintenanceData, gateData] = await Promise.all([
    project.projectApi<FindingsResponse>('/findings'),
    project.projectApi<MetricsResponse>('/metrics'),
    project.projectApi<MaintenancePlan>('/maintenance'),
    project.projectApi<GateResponse>('/gate'),
  ]);
  findings.value = findingsData.findings;
  metrics.value = metricsData;
  maintenance.value = maintenanceData;
  gate.value = gateData;
}

async function reload(): Promise<void> {
  loading.value = true;
  try {
    await Promise.all([project.refreshStatus(), project.refreshDoctor(), loadVisibility()]);
  } catch (error) {
    toasts.error('刷新失败', errorMessage(error));
  } finally {
    loading.value = false;
  }
}

// 维护动作执行后服务端会带回新的 doctor 报告：直接采用，省掉一次往返。
function onMaintenanceChanged(report: unknown): void {
  project.applyDoctorReport(report);
}

function jump(panel: PanelId): void {
  void router.push('/project/' + (project.currentId ?? '') + '/' + panel);
}

onMounted(reload);
watch(() => refreshCounter('overview'), () => void reload());
</script>
