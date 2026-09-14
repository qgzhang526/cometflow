<template>
  <div class="card">
    <div class="row">
      <h2>调度队列</h2>
      <span class="grow" />
      <button @click="load">刷新</button>
      <RouterLink :to="'/project/' + (project.currentId ?? '') + '/settings'"><button>调度器默认参数</button></RouterLink>
    </div>
    <p class="muted">
      队列由 <code>cometflow daemon start</code> 写入 <code>.cometflow/runtime/queue.json</code>；这里只读展示，
      不在界面上改队列状态（改状态等于替调度器做决定）。
    </p>
    <div v-if="data?.scheduler" class="row">
      <StatusBadge tone="brand" :text="'mode ' + (data.scheduler.mode ?? '(未设置)')" />
      <span class="muted">
        间隔 {{ data.scheduler.intervalMs ?? '—' }} ms · 预算 {{ data.scheduler.budgetMs ?? '—' }} ms ·
        空闲阈值 {{ data.scheduler.idleCpuThreshold ?? '—' }}
      </span>
    </div>
  </div>

  <div class="card">
    <div class="row">
      <h2>下一个待办</h2>
      <span class="grow" />
      <StatusBadge :tone="data?.queue ? 'ok' : 'warn'" :text="data?.queue ? 'daemon 队列' : '推导视图'" />
    </div>
    <p v-if="data?.next === null" class="muted">没有排队中的任务。</p>
    <table v-else>
      <thead><tr><th>目标</th><th>任务</th><th>标题</th><th>状态</th><th>尝试</th></tr></thead>
      <tbody>
        <tr>
          <td><b>{{ data?.next?.goal }}</b></td>
          <td>{{ data?.next?.task }}</td>
          <td>{{ data?.next?.title }}</td>
          <td><StatusBadge tone="warn" :text="data?.next?.status ?? ''" /></td>
          <td>{{ data?.next?.attempts ?? 0 }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2>队列内容</h2>
    <p v-if="!data?.queue" class="muted">
      还没有 daemon 写下的队列，下面是按已冻结/已批准任务推导出来的待办：
    </p>
    <p v-if="tasks.length === 0" class="empty">
      没有待办任务。先用 <code>plan freeze</code> 冻结任务，这里才会出现队列。
    </p>
    <table v-else>
      <thead><tr><th>目标</th><th>任务</th><th>标题</th><th>状态</th><th>尝试</th><th>更新时间</th></tr></thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.id">
          <td><b>{{ task.goal }}</b></td>
          <td>{{ task.task }}</td>
          <td>{{ task.title }}</td>
          <td>
            <StatusBadge
              :tone="task.status === 'done' ? 'ok' : task.status === 'failed' ? 'err' : task.status === 'running' ? 'brand' : 'warn'"
              :text="task.status"
            />
          </td>
          <td>{{ task.attempts }}</td>
          <td class="muted">{{ relativeTime(task.updated_at) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import StatusBadge from '../../components/StatusBadge.vue';
import { errorMessage } from '../../api/client';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { SchedulerResponse } from '../../api/types';
import { relativeTime } from '../../utils/format';

const project = useProjectStore();
const toasts = useToastStore();
const data = ref<SchedulerResponse | null>(null);

const tasks = computed(() => data.value?.queue?.tasks ?? data.value?.derived.tasks ?? []);

async function load(): Promise<void> {
  try {
    data.value = await project.projectApi<SchedulerResponse>('/scheduler/queue');
  } catch (error) {
    toasts.error('读取调度队列失败', errorMessage(error));
  }
}

onMounted(load);
</script>
