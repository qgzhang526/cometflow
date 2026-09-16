import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import type {
  AgentInfo,
  DoctorReport,
  ProjectConfigResponse,
  ProjectStatus,
  WorkspaceProject,
} from '../api/types';

export const useProjectStore = defineStore('project', () => {
  const currentId = ref<string | null>(null);
  const current = ref<WorkspaceProject | null>(null);
  const status = ref<ProjectStatus | null>(null);
  const doctor = ref<DoctorReport | null>(null);
  const config = ref<ProjectConfigResponse | null>(null);
  const agents = ref<AgentInfo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const availableAgents = computed(() => agents.value.filter((agent) => agent.available));

  function path(suffix: string): string {
    if (currentId.value === null) throw new Error('no project selected');
    return '/projects/' + encodeURIComponent(currentId.value) + suffix;
  }

  function projectApi<T>(suffix: string, options?: Parameters<typeof api>[1]): Promise<T> {
    return api<T>(path(suffix), options);
  }

  async function open(projectId: string): Promise<void> {
    loading.value = true;
    error.value = null;
    currentId.value = projectId;
    try {
      const data = await api<{ project: WorkspaceProject; status: ProjectStatus | null; error?: string }>(
        '/projects/' + encodeURIComponent(projectId),
      );
      current.value = data.project;
      status.value = data.status;
      if (data.error) error.value = data.error;
      void loadAgents();
    } catch (caught) {
      error.value = errorMessage(caught);
      current.value = null;
      throw caught;
    } finally {
      loading.value = false;
    }
  }

  async function refreshStatus(): Promise<void> {
    status.value = await projectApi<ProjectStatus>('/project/status');
  }

  async function refreshDoctor(): Promise<void> {
    doctor.value = await projectApi<DoctorReport>('/project/doctor');
  }

  async function loadConfig(): Promise<ProjectConfigResponse> {
    const data = await projectApi<ProjectConfigResponse>('/config');
    config.value = data;
    return data;
  }

  async function loadAgents(): Promise<void> {
    try {
      const data = await projectApi<{ agents: AgentInfo[] }>('/agents');
      agents.value = data.agents;
    } catch {
      agents.value = [];
    }
  }

  /**
   * 维护动作（clean-temp / clean-jobs / force-unlock）的响应里带回了执行后的 doctor 报告，
   * 直接采用：界面既得到新结论，又少一次往返回读。
   */
  function applyDoctorReport(report: unknown): void {
    if (report === null || typeof report !== 'object') return;
    const candidate = report as Partial<DoctorReport>;
    if (typeof candidate.healthy !== 'boolean' || !Array.isArray(candidate.findings)) return;
    doctor.value = candidate as DoctorReport;
  }

  function reset(): void {
    currentId.value = null;
    current.value = null;
    status.value = null;
    doctor.value = null;
    config.value = null;
    error.value = null;
  }

  return {
    currentId,
    current,
    status,
    doctor,
    config,
    agents,
    availableAgents,
    loading,
    error,
    open,
    reset,
    projectApi,
    refreshStatus,
    refreshDoctor,
    loadConfig,
    loadAgents,
    applyDoctorReport,
  };
});
