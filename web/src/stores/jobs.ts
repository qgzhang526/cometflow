import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api/client';
import type { JobEvent, JobRecord } from '../api/types';

const MAX_LOG_LINES = 500;

/**
 * Job 中心的数据源。
 *
 * 事件（SSE）负责实时增量，GET /api/jobs 负责「刷新页面后仍然看得见」；
 * 两者写同一份 map，面板只读这里，不再各自轮询。
 */
export const useJobsStore = defineStore('jobs', () => {
  const jobs = ref<Record<string, JobRecord>>({});
  const loadedAt = ref<string | null>(null);
  const trackedId = ref<string | null>(null);
  const drawerOpen = ref(false);

  const list = computed(() => Object.values(jobs.value).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  const running = computed(() => list.value.filter((job) => job.status === 'queued' || job.status === 'running'));
  const tracked = computed(() => (trackedId.value === null ? null : jobs.value[trackedId.value] ?? null));

  function upsert(job: JobRecord): void {
    jobs.value = { ...jobs.value, [job.id]: job };
  }

  function forProject(projectId: string | null): JobRecord[] {
    if (projectId === null) return list.value;
    return list.value.filter((job) => job.projectId === projectId);
  }

  async function load(): Promise<void> {
    const data = await api<{ jobs: JobRecord[] }>('/jobs');
    const next: Record<string, JobRecord> = {};
    for (const job of data.jobs) next[job.id] = job;
    jobs.value = next;
    loadedAt.value = new Date().toISOString();
  }

  /** 把 SSE 事件合并进本地记录；页面上正在看的 job 因此能实时长日志。 */
  function applyEvent(event: JobEvent): void {
    if (event.jobId === undefined) return;
    const current = jobs.value[event.jobId];
    if (event.type === 'job.queued') {
      if (current) return;
      upsert({
        id: event.jobId,
        projectId: event.projectId ?? '',
        kind: 'unknown',
        status: 'queued',
        createdAt: event.at,
        logTail: [],
      });
      return;
    }
    if (!current) return;
    if (event.type === 'job.started') {
      upsert({ ...current, status: 'running', startedAt: event.at });
      return;
    }
    if (event.type === 'job.log' && event.line !== undefined) {
      const logTail = [...current.logTail, event.line];
      upsert({ ...current, logTail: logTail.slice(-MAX_LOG_LINES) });
      return;
    }
    if (event.type === 'job.completed') {
      upsert({ ...current, status: 'succeeded', finishedAt: event.at, result: event.result ?? current.result });
      return;
    }
    if (event.type === 'job.failed') {
      upsert({ ...current, status: 'failed', finishedAt: event.at, error: event.error });
    }
  }

  /** 追踪一个刚创建的 job：先乐观插入，再拉一次详情补齐 kind/goal 等元数据。 */
  async function track(jobId: string): Promise<void> {
    trackedId.value = jobId;
    drawerOpen.value = true;
    try {
      const data = await api<{ job: JobRecord }>('/jobs/' + encodeURIComponent(jobId));
      upsert(data.job);
    } catch {
      // 详情拉取失败不影响事件流；面板会显示「等待日志」。
    }
  }

  function select(jobId: string): void {
    trackedId.value = jobId;
  }

  return {
    jobs,
    list,
    running,
    tracked,
    trackedId,
    drawerOpen,
    loadedAt,
    load,
    applyEvent,
    track,
    select,
    forProject,
  };
});
