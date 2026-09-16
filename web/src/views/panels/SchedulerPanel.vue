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
    <table v-if="data" style="margin-top: 8px">
      <tbody>
        <tr>
          <th>已用预算</th>
          <td>
            {{ data.budget.used_ms }} ms
            <span v-if="data.scheduler?.budgetMs" class="muted">
              （上限 {{ data.scheduler.budgetMs }} ms）
            </span>
            <div class="muted">
              <template v-if="budgetUnused">跨重启累计，还没有消耗过；</template>
              <template v-else>跨重启累计，最近更新 {{ relativeTime(data.budget.updated_at) }}；</template>
              重置走
              <code>cometflow daemon budget . --reset</code>。
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <div class="row">
      <h2>调度器最近一次决策</h2>
      <span class="grow" />
      <StatusBadge
        v-if="data?.daemon"
        :tone="data.daemon.phase === 'stopped' ? 'warn' : 'ok'"
        :text="'phase ' + data.daemon.phase"
      />
      <StatusBadge v-else tone="gray" text="从未跑过" />
    </div>
    <!--
      这一段是 C5 的落点：在它之前，界面只能显示队列与预算，
      答不出「无人值守到底有没有在工作」。只读投影，不给任何控制按钮。
    -->
    <p v-if="!data?.daemon" class="muted">
      这台机器上还没有 daemon 写过状态投影（<code>.cometflow/runtime/daemon-state.json</code>）：
      下面的队列要么是按冻结计划推导的，要么是别的机器写下的。
      启动无人值守：<code>cometflow daemon start . --mode always</code>。
    </p>
    <template v-else>
      <div class="row" style="margin-bottom: 6px">
        <StatusBadge tone="brand" :text="'mode ' + data.daemon.mode" />
        <StatusBadge tone="gray" :text="'agent ' + data.daemon.agent" />
        <span class="muted">
          轮次 {{ data.daemon.iteration }} · pid {{ data.daemon.pid }} · 最近活动
          {{ relativeTime(data.daemon.updated_at) }}
        </span>
      </div>
      <p class="muted">
        <template v-if="data.daemon.last_decision">
          最近决策：{{ data.daemon.last_decision.ran ? '跑了 agent' : '没跑' }} ·
          {{ data.daemon.last_decision.reason }}
          <template v-if="data.daemon.last_decision.task"> · 任务 {{ data.daemon.last_decision.task }}</template>
        </template>
        <template v-else>最近决策：还没有记录。</template>
        <template v-if="data.daemon.stopped_reason"> · 停止原因 {{ data.daemon.stopped_reason }}</template>
      </p>
      <p v-if="data.daemon.last_task" class="muted">
        上一次任务：<b>{{ data.daemon.last_task.id }}</b> ·
        {{ data.daemon.last_task.result }} · {{ data.daemon.last_task.elapsedMs }} ms
        <template v-if="data.daemon.last_task.timedOut"> · 已超时</template>
      </p>
      <p class="muted">
        队列计数：queued {{ data.daemon.queue.queued }} · running {{ data.daemon.queue.running }} ·
        done {{ data.daemon.queue.done }} · failed {{ data.daemon.queue.failed }}
        <template v-if="data.daemon.budget.total_ms > 0">
          · 预算 {{ data.daemon.budget.used_ms }} / {{ data.daemon.budget.total_ms }} ms
          （本次进程剩余 {{ data.daemon.budget.remaining_ms ?? '—' }} ms）
        </template>
      </p>
      <p class="muted">
        「是不是还在跑」不靠界面猜：上面的时间戳是它最后一次写状态的时间，
        pid 只是线索——进程可能已经退出或换台机器在跑。
      </p>
    </template>
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
    <p v-if="!hasDaemonQueue" class="muted">
      还没有 daemon 写下的队列，下面是按已冻结/已批准任务推导出来的待办
      （推导行没有真实的更新时间，所以不显示「更新时间」列）：
    </p>
    <p v-if="tasks.length === 0" class="empty">
      没有待办任务。先用 <code>plan freeze</code> 冻结任务，这里才会出现队列。
    </p>
    <table v-else>
      <thead>
        <tr>
          <th>目标</th><th>任务</th><th>标题</th><th>状态</th><th>尝试</th>
          <th v-if="hasDaemonQueue">更新时间</th>
        </tr>
      </thead>
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
          <td v-if="hasDaemonQueue" class="muted">{{ relativeTime(task.updated_at) }}</td>
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

/**
 * 只有 daemon 写过 `queue.json`，队列行上的 `updated_at` 才是真实时间。
 * 推导视图（`buildQueueFromPlans`）是按请求时刻现造的行，用它渲染「更新时间」会得到「刚刚」。
 */
const hasDaemonQueue = computed(() => data.value?.queue !== null && data.value?.queue !== undefined);

/**
 * `readBudgetUsage` 在没有 `budget.json` 时把 `updated_at` 置为 epoch 0（那是「从未使用」的哨兵，
 * 不是真实时间），直接渲染会显示「最近更新 1970-01-01」。
 */
const budgetUnused = computed(() => {
  const at = data.value?.budget.updated_at ?? '';
  return at === '' || at.startsWith('1970-01-01');
});

async function load(): Promise<void> {
  try {
    data.value = await project.projectApi<SchedulerResponse>('/scheduler/queue');
  } catch (error) {
    toasts.error('读取调度队列失败', errorMessage(error));
  }
}

onMounted(load);
</script>
