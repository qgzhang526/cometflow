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

  <DaemonDecisionCard :daemon="data?.daemon ?? null" :lease="data?.lease ?? null" :live="live" />

  <ScheduleOrderCard :order="data?.order" />

  <div class="card">
    <div class="row">
      <h2>控制</h2>
      <span class="grow" />
      <!--
        ADR 0027：内嵌调度器由 serve 托管，所以页面能「启动」——它起的是一个 daemon job，
        不是 spawn 游离进程；暂停/继续/停止仍然只写控制文件（ADR 0026 的那套语义没变）。
      -->
      <button class="primary" :disabled="controlBusy || data?.embedded?.running === true" @click="startScheduler">
        {{ data?.embedded?.running ? '调度器在跑' : '启动调度器' }}
      </button>
      <button :disabled="controlBusy" @click="control('pause')">暂停</button>
      <button :disabled="controlBusy" @click="control('resume')">继续</button>
      <button :disabled="controlBusy" @click="control('stop')">停止</button>
      <StatusBadge v-if="data?.control && data.control.action !== 'idle'" tone="warn" :text="'已请求 ' + data.control.action" />
      <StatusBadge
        :tone="data?.embedded?.autostart ? 'ok' : 'gray'"
        :text="data?.embedded?.autostart ? '常驻：开' : '常驻：关'"
      />
    </div>
    <p class="muted">
      <b>启动调度器</b> = serve 内嵌一个调度器 job（日志在任务中心）+ 记为常驻（serve 重启会自动恢复）；
      暂停 / 停止在下一轮生效，<b>停止</b>会同时清掉常驻标记。模式（always / idle / schedule / manual）
      读设置页的「调度器默认参数」；单实例由租约保证——CLI 起的调度器在跑时，这里会拒绝并告诉你是谁在跑。
      队列是可以随意重建的派生视图，不需要先停调度器再改。
      <br />
      验收前置检查：<b>{{ data?.preflight ?? 'fail' }}</b>
      <span v-if="(data?.preflight ?? 'fail') === 'fail'">（验收判不出来的任务不执行、直接失败并停机）</span>
      <span v-else-if="data?.preflight === 'warn'">（判不出来照常执行，只在结论里记一笔）</span>
      <span v-else>（不做前置检查）</span>
      —— 改它去<RouterLink :to="'/project/' + (project.currentId ?? '') + '/settings'">设置页的「验收」</RouterLink>。
    </p>
  </div>

  <div class="card">
    <div class="row">
      <h2>下一个待办</h2>
      <span class="grow" />
      <!-- S3 之后待办是合并视图：每行都能回答「从哪来」。 -->
      <StatusBadge
        tone="brand"
        :text="
          '待交付 ' +
          pendingCount +
          (blockedCount > 0 ? '（等依赖 ' + blockedCount + '）' : '') +
          ' · 已交付 ' +
          deliveredCount
        "
      />
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
          <th>顺序</th><th>目标</th><th>任务</th><th>标题</th><th>调度状态</th><th>来源</th>
          <th>交付（change）</th><th>尝试</th><th>恢复</th>
          <th v-if="hasDaemonQueue">更新时间</th>
        </tr>
      </thead>
      <tbody>
        <!-- 顺序列 = 调度器实际会领取的先后（ADR 0029：清单在前，其余按编号）。 -->
        <tr v-for="(task, index) in tasks" :key="task.id">
          <td class="muted">#{{ index + 1 }}</td>
          <td><b>{{ task.goal }}</b></td>
          <td>{{ task.task }}</td>
          <td>{{ task.title }}</td>
          <td>
            <StatusBadge
              :tone="task.status === 'done' ? 'ok' : task.status === 'failed' ? 'err' : task.status === 'running' ? 'brand' : 'warn'"
              :text="task.status"
            />
            <!-- 依赖（C2）：前序没交付就不调度——把"为什么还没轮到它"直接写在行上。 -->
            <span v-if="(task.blocked_by?.length ?? 0) > 0" class="badge warn" style="margin-left: 6px">
              等待 {{ task.blocked_by?.join(', ') }} 交付
            </span>
          </td>
          <!-- 「从哪来」：derived=推导出的待办，overlay=运行时记录，delivered=change 账本。 -->
          <td class="muted">
            {{ task.source === 'delivered' ? '交付账本' : task.source === 'overlay' ? '运行时记录' : '计划推导' }}
          </td>
          <!-- 工作流视角（P4 原文的「status 同时显示调度与工作流状态」）：跑过 ≠ 交付过。 -->
          <td>
            <template v-if="task.workflow">
              <b style="margin-right: 6px">{{ task.workflow.name }}</b>
              <StatusBadge
                :tone="task.workflow.archived ? 'ok' : task.workflow.status === 'blocked' ? 'err' : 'warn'"
                :text="task.workflow.phase + (task.workflow.archived ? ' · 已归档' : '')"
              />
              <span v-if="task.workflow.status === 'blocked'" class="badge err">blocked，需人工</span>
            </template>
            <!-- 结论也翻成人话：`verify-failed` 这类词裸着显示，读者得自己去查词表。 -->
            <template v-else-if="task.verdict">
              <StatusBadge
                :tone="verdictLabel(task.verdict)?.tone ?? 'gray'"
                :text="verdictLabel(task.verdict)?.text ?? task.verdict"
              />
              <span class="muted">（无 change 记录）</span>
            </template>
            <span v-else class="muted">—</span>
          </td>
          <td>{{ task.attempts }}</td>
          <td>
            <!-- 细粒度恢复：只重排这一条，不动其它任务的覆盖与尝试次数。 -->
            <button
              v-if="task.status === 'failed' && !task.delivered"
              class="ghost"
              :disabled="retrying !== ''"
              title="把这一条重新排队（等价 cometflow daemon queue retry <goal:task>）"
              @click="retry(task)"
            >
              {{ retrying === task.id ? '排队中…' : '重新排队' }}
            </button>
          </td>
          <td v-if="hasDaemonQueue" class="muted">{{ relativeTime(task.updated_at) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import StatusBadge from '../../components/StatusBadge.vue';
import { errorMessage } from '../../api/client';
import { usePanelData } from '../../composables/usePanelData';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { SchedulerResponse } from '../../api/types';
import { relativeTime } from '../../utils/format';
import { verdictLabel } from '../../utils/scheduler-labels';
import DaemonDecisionCard from './scheduler/DaemonDecisionCard.vue';
import ScheduleOrderCard from './scheduler/ScheduleOrderCard.vue';

const project = useProjectStore();
const toasts = useToastStore();
// 加载/失败提示/跟着 SSE 重读这一套走公共入口；下面的轮询是本面板特有的（见 live）。
const { data, reload: load, loading } = usePanelData(
  () => project.projectApi<SchedulerResponse>('/scheduler/queue'),
  { errorTitle: '读取调度队列失败', area: 'scheduler' },
);
const controlBusy = ref(false);
const retrying = ref('');

/** S3：面板看的是合并视图（推导 + 运行时覆盖 + 交付账本），不是 `queue.json` 那一份。 */
const tasks = computed(() => data.value?.tasks ?? []);
const pendingCount = computed(() => tasks.value.filter((task) => task.status === 'queued').length);
/** 待交付里有多少条在等前序任务（依赖，C2）：一眼看出是"卡在顺序上"还是"没人做"。 */
const blockedCount = computed(() => tasks.value.filter((task) => (task.blocked_by?.length ?? 0) > 0).length);
const deliveredCount = computed(() => tasks.value.filter((task) => task.delivered).length);

/** 暂停 / 继续 / 停止：写控制文件（ADR 0026），进程仍归启动它的终端。 */
async function control(action: 'pause' | 'resume' | 'stop'): Promise<void> {
  controlBusy.value = true;
  try {
    await project.projectApi('/scheduler/daemon/control', { method: 'POST', body: { action } });
    await load();
    toasts.success('已请求 ' + action, 'daemon 会在下一轮生效（没在跑时下次启动时消费）');
  } catch (error) {
    toasts.error('控制失败', errorMessage(error));
  } finally {
    controlBusy.value = false;
  }
}

/** 重新排队单条任务：daemon 停机交人工之后，把那一条放回待办，其余不动。 */
async function retry(task: { id: string; goal: string; task: string }): Promise<void> {
  retrying.value = task.id;
  try {
    await project.projectApi('/scheduler/queue/retry', {
      method: 'POST',
      body: { task: task.goal + ':' + task.task },
    });
    await load();
    toasts.success('已重新排队', task.goal + ':' + task.task);
  } catch (error) {
    // 已交付/不存在的任务会返回 409 与原因——直接显示它，比"失败"两个字有用。
    toasts.error('重新排队失败', errorMessage(error));
  } finally {
    retrying.value = '';
  }
}

/**
 * 启动内嵌调度器（ADR 0027）：serve 里起一个 `daemon` job。
 *
 * 模式读设置页的调度器默认参数；把它记为常驻（serve 重启自动恢复）由服务端负责。
 */
async function startScheduler(): Promise<void> {
  controlBusy.value = true;
  try {
    const data = await project.projectApi<{ jobId: string }>('/scheduler/daemon/start', {
      method: 'POST',
      body: {},
    });
    await load();
    toasts.success('调度器已启动', 'job ' + data.jobId + '，日志在任务中心');
  } catch (error) {
    // 单实例租约会回 409 并带上持有者：原样显示比"启动失败"有用。
    toasts.error('启动失败', errorMessage(error));
  } finally {
    controlBusy.value = false;
  }
}

/**
 * 只有运行时记录（overlay / 交付账本）的行的 `updated_at` 才是真实时间；
 * 推导行的时间戳是请求时刻现造的，渲染出来会变成「刚刚」，所以那一列对它们没有意义。
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

/** 轮询间隔：本地接口、几 KB 响应，4s 足够跟上无人值守的进度，也不会白烧 CPU。 */
const LIVE_POLL_MS = 4000;
/** 没在跑时每 5 个 tick（20s）探一次：**从终端起的调度器要能被自动发现**，不用手点刷新。 */
const IDLE_POLL_TICKS = 5;
let pollTimer: number | null = null;
let pollTick = 0;

/**
 * 「现在有没有调度器在跑」用**租约**判断，不用状态投影的时间戳。
 *
 * 投影只在决策时写（一个任务能跑几十分钟），拿它当心跳会把"正在跑"当成"停了"；
 * 租约每 10s 心跳、60s 过期，正是这个问题需要的粒度。CLI 起的 daemon 直接写项目文件、
 * 不发 SSE，所以这里必须自己轮询；内嵌调度器虽然发 job 事件，但它跑的是同一个循环，
 * 按同一把尺子处理更简单。
 */
const live = computed(() => data.value?.lease?.fresh === true || data.value?.embedded?.running === true);

/**
 * 常驻轮询：即时刷新由 usePanelData 订阅 'scheduler' 区域完成（页面动作会广播），
 * 但**外部进程**（终端里 `daemon start`）只写项目文件、不发事件，只能靠轮询。
 * 所以这里不停轮询，只是没在跑时降频——停了轮询就永远发现不了"刚刚起了一个调度器"。
 */
function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

onMounted(() => {
  pollTimer = window.setInterval(() => {
    pollTick += 1;
    if (live.value || pollTick % IDLE_POLL_TICKS === 0) void load();
  }, LIVE_POLL_MS);
});
onUnmounted(stopPolling);
</script>
