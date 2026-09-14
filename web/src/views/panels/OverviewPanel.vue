<template>
  <div class="card">
    <div class="row">
      <h2>项目状态</h2>
      <span class="grow" />
      <StatusBadge :tone="doctor?.healthy ? 'ok' : doctor ? 'err' : 'gray'" :text="doctor ? (doctor.healthy ? 'doctor OK' : 'needs attention') : 'doctor …'" />
      <button @click="reload">刷新</button>
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

  <div class="card">
    <h2>Doctor</h2>
    <p v-if="doctor === null" class="muted">加载中…</p>
    <template v-else>
      <div
        v-for="(finding, index) in doctor.findings"
        :key="index"
        class="finding"
        :class="{ warning: finding.severity === 'warning', info: finding.severity === 'info' }"
      >
        [{{ finding.severity }}] {{ finding.code }} {{ finding.message }}
      </div>
      <p v-if="doctor.findings.length === 0" class="badge ok">0 finding</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { refreshCounter } from '../../composables/useRefresh';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import { errorMessage } from '../../api/client';

const project = useProjectStore();
const toasts = useToastStore();

const status = computed(() => project.status);
const doctor = computed(() => project.doctor);
const activeChanges = computed(() => (status.value?.changes ?? []).filter((change) => !change.archived).length);

async function reload(): Promise<void> {
  try {
    await Promise.all([project.refreshStatus(), project.refreshDoctor()]);
  } catch (error) {
    toasts.error('刷新失败', errorMessage(error));
  }
}

onMounted(reload);
watch(() => refreshCounter('overview'), () => void reload());
</script>
