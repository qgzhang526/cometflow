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
  };
});
