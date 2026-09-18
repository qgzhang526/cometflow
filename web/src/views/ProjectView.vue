<template>
  <div class="topbar">
    <RouterLink to="/" class="logo">CometFlow</RouterLink>
    <span>{{ project.current?.name ?? '…' }}</span>
    <span class="muted">{{ project.current?.path }}</span>
    <RouterLink to="/">切换项目</RouterLink>
    <span class="grow" />
    <!-- 项目健康徽章（008 §5.1）：数据来自与总览同一份 findings，不另拉一次。 -->
    <RouterLink :to="'/project/' + projectId + '/overview'">
      <StatusBadge
        :tone="findings.errorCount > 0 ? 'err' : findings.warningCount > 0 ? 'warn' : 'ok'"
        :text="findings.errorCount + ' error / ' + findings.warningCount + ' warning'"
      />
    </RouterLink>
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
        <!-- 带着意图跳过来的落地说明（问题清单的「去处理」）：任何面板都该有一句"到了该干嘛"。 -->
        <ArrivalBanner />
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
import ArrivalBanner from '../components/ArrivalBanner.vue';
import { PANELS, type PanelId } from '../router';
import { useJobsStore } from '../stores/jobs';
import { useFindingsStore } from '../stores/findings';
import { useNavigationStore } from '../stores/navigation';
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
const findings = useFindingsStore();
const toasts = useToastStore();
const navigation = useNavigationStore();

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

/**
 * 离开目标面板就收掉落地横幅：它是"这一次跳转"的说明，不是常驻提示。
 * （留在别的面板上会比没有更让人困惑。）
 */
watch(activePanel, (panel) => {
  const arrival = navigation.arrival;
  if (arrival !== null && arrival.panel !== panel) navigation.dismissArrival();
});

watch(
  projectId,
  async (id) => {
    try {
      await project.open(id);
      await Promise.all([jobs.load(), findings.load(id)]);
    } catch (error) {
      findings.reset();
      toasts.error('打开项目失败', errorMessage(error));
    }
  },
  { immediate: true },
);
</script>
