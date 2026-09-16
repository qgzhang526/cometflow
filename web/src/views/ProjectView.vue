<template>
  <div class="topbar">
    <RouterLink to="/" class="logo">CometFlow</RouterLink>
    <span>{{ project.current?.name ?? '…' }}</span>
    <span class="muted">{{ project.current?.path }}</span>
    <RouterLink to="/">切换项目</RouterLink>
    <span class="grow" />
    <StatusBadge
      v-for="agent in project.agents"
      :key="agent.id"
      :tone="agent.available ? 'ok' : 'err'"
      :text="agent.id + (agent.available ? '' : ' missing')"
    />
    <button class="ghost" @click="jobs.drawerOpen = !jobs.drawerOpen">
      <span v-if="jobs.running.length > 0" class="spinner" />
      任务 {{ runningCount }}
    </button>
  </div>

  <div class="shell" :class="{ 'drawer-open': jobs.drawerOpen }">
    <nav class="sidebar">
      <div class="nav-label">工作台</div>
      <RouterLink
        v-for="entry in PANELS"
        :key="entry.id"
        :to="'/project/' + projectId + '/' + entry.id"
        :class="{ active: entry.id === activePanel }"
      >
        <span class="icon">{{ entry.icon }}</span><span>{{ entry.label }}</span>
      </RouterLink>
    </nav>
    <main class="content">
      <div v-if="project.error" class="card finding">[error] {{ project.error }}</div>
      <PanelBoundary @retry="panelEpoch += 1">
        <!-- key 里带 projectId：切换项目时面板必须重新挂载，否则面板自己取的数据（findings/metrics/
             维护预告、变更列表……）会停在上一个项目的快照上，而 store 里的 status/doctor 已经换了。 -->
        <component :is="activeComponent" :key="projectId + ':' + activePanel + ':' + panelEpoch" />
      </PanelBoundary>
    </main>
  </div>

  <JobCenter />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import JobCenter from '../components/JobCenter.vue';
import StatusBadge from '../components/StatusBadge.vue';
import PanelBoundary from '../components/PanelBoundary.vue';
import { PANELS, type PanelId } from '../router';
import { useJobsStore } from '../stores/jobs';
import { useProjectStore } from '../stores/project';
import { useToastStore } from '../stores/toasts';
import { errorMessage } from '../api/client';
import OverviewPanel from './panels/OverviewPanel.vue';
import GoalsPanel from './panels/GoalsPanel.vue';
import SpecsPanel from './panels/SpecsPanel.vue';
import PlansPanel from './panels/PlansPanel.vue';
import ChangesPanel from './panels/ChangesPanel.vue';
import EvolvePanel from './panels/EvolvePanel.vue';
import EvalPanel from './panels/EvalPanel.vue';
import SchedulerPanel from './panels/SchedulerPanel.vue';
import AssetsPanel from './panels/AssetsPanel.vue';
import SettingsPanel from './panels/SettingsPanel.vue';
import type { Component } from 'vue';

const props = defineProps<{ id: string; panel?: string }>();

const route = useRoute();
const project = useProjectStore();
const jobs = useJobsStore();
const toasts = useToastStore();

const COMPONENTS: Record<PanelId, Component> = {
  overview: OverviewPanel,
  goals: GoalsPanel,
  specs: SpecsPanel,
  plans: PlansPanel,
  changes: ChangesPanel,
  evolve: EvolvePanel,
  eval: EvalPanel,
  scheduler: SchedulerPanel,
  assets: AssetsPanel,
  settings: SettingsPanel,
};

const projectId = computed(() => props.id);
const panelEpoch = ref(0);
const activePanel = computed<PanelId>(() => {
  const candidate = (props.panel ?? route.params.panel ?? 'overview') as PanelId;
  return PANELS.some((entry) => entry.id === candidate) ? candidate : 'overview';
});
const activeComponent = computed(() => COMPONENTS[activePanel.value]);
const runningCount = computed(() => jobs.forProject(project.currentId).filter((job) => job.status === 'running' || job.status === 'queued').length);

watch(
  projectId,
  async (id) => {
    try {
      await project.open(id);
      await jobs.load();
    } catch (error) {
      toasts.error('打开项目失败', errorMessage(error));
    }
  },
  { immediate: true },
);
</script>
