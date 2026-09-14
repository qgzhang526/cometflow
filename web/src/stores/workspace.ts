import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, errorMessage } from '../api/client';
import type { ProjectSummary, ScaffoldAnswers, WorkspaceProject } from '../api/types';

export interface CreateProjectPayload {
  name: string;
  path: string;
  frontend: string;
  backend: string;
  database: string;
  answers: ScaffoldAnswers;
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const projects = ref<ProjectSummary[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const data = await api<{ projects: ProjectSummary[] }>('/workspace');
      projects.value = data.projects;
    } catch (caught) {
      error.value = errorMessage(caught);
    } finally {
      loading.value = false;
    }
  }

  async function create(payload: CreateProjectPayload): Promise<WorkspaceProject> {
    const data = await api<{ project: WorkspaceProject }>('/projects', { method: 'POST', body: payload });
    await load();
    return data.project;
  }

  async function importExisting(path: string): Promise<WorkspaceProject> {
    const data = await api<{ project: WorkspaceProject }>('/projects/import', { method: 'POST', body: { path } });
    await load();
    return data.project;
  }

  /** 只从工作区移除登记，不动磁盘上的项目文件。 */
  async function remove(projectId: string): Promise<void> {
    await api('/projects/' + encodeURIComponent(projectId), { method: 'DELETE' });
    await load();
  }

  return { projects, loading, error, load, create, importExisting, remove };
});
