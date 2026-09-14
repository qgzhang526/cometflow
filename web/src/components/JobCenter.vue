<template>
  <div class="job-drawer" :class="{ open: jobs.drawerOpen }">
    <div class="job-drawer-head">
      <strong>任务中心</strong>
      <span class="muted">{{ scoped.length }} 个任务</span>
      <span class="grow" />
      <button class="ghost" :disabled="jobs.finishedCount === 0" title="清理已结束的任务（运行中的保留）" @click="clearFinished">
        清理已完成
      </button>
      <button class="ghost" @click="jobs.load()" title="重新拉取任务列表">↻</button>
      <button class="ghost" @click="jobs.drawerOpen = false">✕</button>
    </div>
    <div class="job-drawer-body">
      <p v-if="jobs.loadedAt === null" class="muted">尚未加载任务列表</p>
      <div v-for="job in scoped" :key="job.id" class="job-item" :class="{ selected: job.id === jobs.trackedId }">
        <div class="job-line" @click="jobs.select(job.id)">
          <StatusBadge :tone="toneFor(job.status)" :text="job.status" />
          <span class="job-kind">{{ job.kind }}</span>
          <span v-if="job.change" class="muted">change={{ job.change }}</span>
          <span v-else-if="job.goal" class="muted">goal={{ job.goal }}</span>
          <span class="grow" />
          <button v-if="job.change" class="ghost" title="在变更面板打开这个 change" @click.stop="openChange(job)">查看 change</button>
          <span class="muted">{{ relativeTime(job.createdAt) }}</span>
        </div>
        <p v-if="job.error" class="job-error">{{ job.error }}</p>
      </div>
      <p v-if="scoped.length === 0" class="empty">还没有任务。运行 Builder / 验收 / 评估时会出现在这里。</p>
    </div>
    <div v-if="jobs.tracked" class="job-log">
      <div class="job-log-head">
        <strong>{{ jobs.tracked.kind }}</strong>
        <span class="muted">{{ jobs.tracked.id }}</span>
        <span class="grow" />
        <StatusBadge :tone="toneFor(jobs.tracked.status)" :text="jobs.tracked.status" />
      </div>
      <pre class="logbox">{{ logText }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useJobsStore } from '../stores/jobs';
import { useProjectStore } from '../stores/project';
import { useToastStore } from '../stores/toasts';
import { errorMessage } from '../api/client';
import { relativeTime } from '../utils/format';
import StatusBadge from './StatusBadge.vue';
import type { JobRecord, JobStatus } from '../api/types';

const jobs = useJobsStore();
const project = useProjectStore();
const toasts = useToastStore();
const router = useRouter();

const scoped = computed<JobRecord[]>(() => jobs.forProject(project.currentId));

const logText = computed(() => {
  const job = jobs.tracked;
  if (job === null) return '';
  const lines = job.logTail.join('\n');
  if (job.status === 'failed') return lines + '\n[failed] ' + (job.error ?? '');
  if (job.status === 'succeeded') return lines + '\n[succeeded]' + (job.exitCode ? ' exit=' + job.exitCode : '');
  return lines === '' ? '等待日志…' : lines;
});

function toneFor(status: JobStatus): 'ok' | 'warn' | 'err' | 'gray' | 'brand' {
  if (status === 'succeeded') return 'ok';
  if (status === 'failed') return 'err';
  if (status === 'running') return 'brand';
  return 'warn';
}

async function clearFinished(): Promise<void> {
  try {
    const removed = await jobs.clearFinished();
    toasts.success('已清理任务', '移除 ' + removed + ' 条已结束记录');
  } catch (error) {
    toasts.error('清理失败', errorMessage(error));
  }
}

function openChange(job: JobRecord): void {
  if (!job.change) return;
  void router.push({
    name: 'project',
    params: { id: job.projectId, panel: 'changes' },
    query: { change: job.change },
  });
}
</script>
