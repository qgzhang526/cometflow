<template>
  <div class="card">
    <div class="row">
      <h2>调度器最近一次决策</h2>
      <span class="grow" />
      <!-- 「在不在跑」的判据是**租约**（10s 心跳 / 60s 过期），不是投影的时间戳。 -->
      <StatusBadge :tone="live ? 'ok' : 'gray'" :text="live ? '调度器在跑' : '没有调度器在跑'" />
      <StatusBadge
        v-if="daemon"
        :tone="daemon.phase === 'stopped' ? 'warn' : 'ok'"
        :text="'phase ' + daemon.phase"
      />
      <StatusBadge v-else tone="gray" text="从未跑过" />
    </div>
    <!--
      这一段是 C5 的落点：在它之前，界面只能显示队列与预算，
      答不出「无人值守到底有没有在工作」。只读投影，不给任何控制按钮。
    -->
    <p v-if="!daemon" class="muted">
      这台机器上还没有 daemon 写过状态投影（<code>.cometflow/runtime/daemon-state.json</code>）：
      下面的队列要么是按冻结计划推导的，要么是别的机器写下的。
      启动无人值守：<code>cometflow daemon start . --mode always</code>。
    </p>
    <template v-else>
      <div class="row" style="margin-bottom: 6px">
        <StatusBadge tone="brand" :text="'mode ' + daemon.mode" />
        <StatusBadge tone="gray" :text="'agent ' + daemon.agent" />
        <span class="muted">
          轮次 {{ daemon.iteration }} · pid {{ daemon.pid }} · 最近活动 {{ relativeTime(daemon.updated_at) }}
        </span>
      </div>
      <p class="muted">
        <template v-if="daemon.last_decision">
          最近决策：{{ daemon.last_decision.ran ? '跑了 agent' : '没跑' }} ·
          <span :title="lastDecision?.hint ?? ''">{{ lastDecision?.text ?? daemon.last_decision.reason }}</span>
          <template v-if="daemon.last_decision.task"> · 任务 {{ daemon.last_decision.task }}</template>
        </template>
        <template v-else>最近决策：还没有记录。</template>
        <template v-if="stopped">
          · 停止原因
          <StatusBadge :tone="stopped.tone" :text="stopped.text" />
          <span v-if="stopped.hint" class="muted">{{ stopped.hint }}</span>
        </template>
      </p>
      <p v-if="daemon.last_task" class="muted">
        上一次任务：<b>{{ daemon.last_task.id }}</b> ·
        {{ daemon.last_task.result }}
        <template v-if="lastVerdict">
          · <StatusBadge :tone="lastVerdict.tone" :text="lastVerdict.text" />
          <span v-if="lastVerdict.hint">{{ lastVerdict.hint }}</span>
        </template>
        · {{ daemon.last_task.elapsedMs }} ms
        <template v-if="daemon.last_task.timedOut"> · 已超时</template>
      </p>
      <!--
        「为什么这条没被领」：并发单元占用与 module 归属冲突过去只出现在 daemon 的 stdout 里，
        无人值守时没人盯终端，面板上就只看到"队列里还有 queued"。
      -->
      <div v-if="skips.length > 0" class="muted">
        本轮跳过的候选（并发 / 归属，不是依赖）：
        <ul>
          <li v-for="skip in skips" :key="skip.task">
            <b>{{ skip.task }}</b>
            <template v-if="skip.reason === 'unit-busy'">
              ：并发单元已被 {{ skip.holder ?? '另一个槽' }} 占用
            </template>
            <template v-else>
              ：module 与在飞 change {{ skip.holder ?? '?' }} 冲突（
              {{ skip.module ?? '未声明' }} vs {{ skip.occupier_module ?? '未声明' }}）
            </template>
          </li>
        </ul>
      </div>
      <p class="muted">
        队列计数：queued {{ daemon.queue.queued }} · running {{ daemon.queue.running }} ·
        done {{ daemon.queue.done }} · failed {{ daemon.queue.failed }}
        <template v-if="daemon.budget.total_ms > 0">
          · 预算 {{ daemon.budget.used_ms }} / {{ daemon.budget.total_ms }} ms
          （本次进程剩余 {{ daemon.budget.remaining_ms ?? '—' }} ms）
        </template>
      </p>
      <p class="muted">
        在不在跑看 <b>租约</b>而不是时间戳：上面的时间戳是它最后一次写状态的时间，一个任务能跑几十分钟，
        拿它当心跳会把"正在跑"误判成"停了"。
        <template v-if="lease">
          当前租约：{{ lease.fresh ? '活着' : '已过期' }} ·
          {{ lease.owner }}（mode={{ lease.mode }}，心跳 {{ relativeTime(lease.heartbeat_at) }}）。
        </template>
        <template v-else>这台机器上没有调度器持有租约。</template>
        租约活着时本面板每 4s 自动刷新（CLI 起的调度器直接写项目文件、不发事件流）；过期后自动停止轮询。
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import StatusBadge from '../../../components/StatusBadge.vue';
import { relativeTime } from '../../../utils/format';
import { decisionReasonLabel, stopReasonLabel, verdictLabel } from '../../../utils/scheduler-labels';
import type { SchedulerResponse } from '../../../api/types';

const props = defineProps<{
  daemon: SchedulerResponse['daemon'];
  lease: SchedulerResponse['lease'];
  /** 租约活着 / 内嵌调度器在跑：决定这个卡片顶部说"在跑"还是"没有在跑"。 */
  live: boolean;
}>();

/** 机器词翻译：`waiting-on-active-change` 这类原因不能只甩原始字符串给读者。 */
const stopped = computed(() => stopReasonLabel(props.daemon?.stopped_reason));
const lastDecision = computed(() => decisionReasonLabel(props.daemon?.last_decision?.reason));
const lastVerdict = computed(() => verdictLabel(props.daemon?.last_task?.verdict));
const skips = computed(() => props.daemon?.last_skips ?? []);
</script>
