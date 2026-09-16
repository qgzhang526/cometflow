<template>
  <div class="card">
    <div class="row">
      <h2>维护动作</h2>
      <span class="grow" />
      <StatusBadge
        :tone="nothingToDo ? 'ok' : 'warn'"
        :text="nothingToDo ? '无需清理' : '有待处理项'"
      />
      <button class="ghost" @click="emit('refresh')">刷新</button>
    </div>
    <p class="muted">
      三个动作都会<strong>删东西</strong>，所以流程固定为「先看预告 → 二次确认 → 执行」：
      确认框里的数字会原样回传，服务端在执行前重新核对——不一致就拒绝，且一个字节都不删。
    </p>

    <p v-if="plan === null" class="muted">加载中…</p>
    <template v-else>
      <table>
        <tbody>
          <tr>
            <th>残留写入临时文件</th>
            <td>
              {{ plan.temp.count }} 个 · {{ formatBytes(plan.temp.totalBytes) }}
              <div v-for="file in plan.temp.sample" :key="file.path" class="muted">{{ file.path }}</div>
            </td>
            <td>
              <button
                :disabled="busy !== null || plan.temp.count === 0"
                @click="pending = 'clean-temp'"
              >清理临时文件</button>
            </td>
          </tr>
          <tr>
            <th>任务证据</th>
            <td>
              {{ plan.jobs.files }} 个文件 · {{ formatBytes(plan.jobs.bytes) }}
              <div class="muted">
                已结束 {{ plan.jobs.finished }} · 运行中 {{ plan.jobs.running }}（永不回收）·
                超出保留窗口可回收 {{ plan.jobs.candidates }} 个（{{ formatBytes(plan.jobs.reclaimableBytes) }}）
              </div>
            </td>
            <td>
              <button
                :disabled="busy !== null || plan.jobs.candidates === 0"
                @click="pending = 'clean-jobs'"
              >回收任务证据</button>
            </td>
          </tr>
          <tr>
            <th>事务锁</th>
            <td>
              <template v-if="plan.lock.held">
                <StatusBadge :tone="plan.lock.stale ? 'err' : 'warn'" :text="plan.lock.stale ? '滞留（超过 TTL）' : '被持有'" />
                <div class="muted">
                  pid {{ plan.lock.record?.pid }} @ {{ plan.lock.record?.host }} ·
                  {{ plan.lock.record?.action }} · 起始 {{ relativeTime(plan.lock.record?.startedAt) }}
                </div>
                <div v-if="plan.lock.reason" class="muted">{{ plan.lock.reason }}</div>
              </template>
              <span v-else class="muted">没有锁</span>
            </td>
            <td>
              <button
                :disabled="busy !== null || !plan.lock.held"
                @click="pending = 'force-unlock'"
              >强制解锁</button>
            </td>
          </tr>
          <tr>
            <th>change 运行证据</th>
            <td>
              {{ plan.evidence.changes.length }} 个 change · {{ formatBytes(plan.evidence.totalBytes) }}
              <div v-for="entry in plan.evidence.changes.slice(0, 3)" :key="entry.change" class="muted">
                {{ entry.change }}{{ entry.archived ? '（已归档）' : '' }} · {{ formatBytes(entry.bytes) }}
              </div>
              <div class="muted">
                可回收 {{ plan.evidence.candidates.length }} 项（{{ formatBytes(plan.evidence.reclaimableBytes) }}）——
                只含「可重新推导」的部分（归档事务中间产物、已归档 change 的实现范围基线）；
                超过阈值的 journal 只轮转不删除。
              </div>
            </td>
            <td>
              <button
                :disabled="busy !== null || plan.evidence.reclaimableBytes === 0"
                @click="pending = 'clean-evidence'"
              >回收运行证据</button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="plan.lock.held" class="finding warning">
        强制解锁是三个人工判断里最危险的一个：<strong>确认持有进程已退出</strong>之后再点，
        否则两个进程会同时写同一个项目。
      </p>
    </template>

    <ModalCard v-if="pending !== null" :title="confirmation.title" @close="pending = null">
      <p>{{ confirmation.summary }}</p>
      <ul>
        <li v-for="(line, index) in confirmation.details" :key="index" class="muted">{{ line }}</li>
      </ul>
      <p class="muted">{{ confirmation.warning }}</p>
      <template #footer>
        <button :disabled="busy !== null" @click="pending = null">取消</button>
        <button class="primary" :disabled="busy !== null" @click="confirm">
          {{ busy !== null ? '执行中…' : confirmation.action }}
        </button>
      </template>
    </ModalCard>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import ModalCard from './ModalCard.vue';
import StatusBadge from './StatusBadge.vue';
import { errorMessage } from '../api/client';
import { useProjectStore } from '../stores/project';
import { useToastStore } from '../stores/toasts';
import type { MaintenancePlan } from '../api/types';
import { formatBytes, relativeTime } from '../utils/format';

const props = defineProps<{ plan: MaintenancePlan | null }>();
const emit = defineEmits<{ refresh: []; changed: [report: unknown] }>();

const project = useProjectStore();
const toasts = useToastStore();

type Action = 'clean-temp' | 'clean-jobs' | 'force-unlock' | 'clean-evidence';

const pending = ref<Action | null>(null);
const busy = ref<Action | null>(null);

const nothingToDo = computed(
  () =>
    props.plan !== null &&
    props.plan.temp.count === 0 &&
    props.plan.jobs.candidates === 0 &&
    props.plan.evidence.reclaimableBytes === 0 &&
    !props.plan.lock.held,
);

/** 确认框内容完全来自预告：人看到的数字就是即将回传的数字。 */
const confirmation = computed(() => {
  const plan = props.plan;
  if (pending.value === 'clean-temp') {
    return {
      title: '清理残留写入临时文件',
      action: '删除 ' + (plan?.temp.count ?? 0) + ' 个文件',
      summary: '将删除以下残留的原子写临时文件（上次写入被中断留下的），共 ' + formatBytes(plan?.temp.totalBytes ?? 0) + '：',
      details: plan?.temp.sample.map((file) => file.path) ?? [],
      warning: '这些文件是半成品，删除后不会影响已提交的内容。',
    };
  }
  if (pending.value === 'clean-jobs') {
    return {
      title: '回收任务证据',
      action: '回收 ' + (plan?.jobs.candidates ?? 0) + ' 个任务',
      summary:
        '将回收 ' + (plan?.jobs.candidates ?? 0) + ' 个超出保留窗口（最近 200 条 + 30 天）的已结束任务，' +
        '释放约 ' + formatBytes(plan?.jobs.reclaimableBytes ?? 0) + '：',
      details: [
        '当前共 ' + (plan?.jobs.files ?? 0) + ' 个文件 / ' + formatBytes(plan?.jobs.bytes ?? 0),
        '运行中的 ' + (plan?.jobs.running ?? 0) + ' 个任务永不回收',
      ],
      warning: '回收后这些任务的日志与结果无法再查看。',
    };
  }
  if (pending.value === 'clean-evidence') {
    return {
      title: '回收 change 运行证据',
      action: '回收 ' + formatBytes(plan?.evidence.reclaimableBytes ?? 0),
      summary:
        '将回收 ' + (plan?.evidence.candidates.length ?? 0) + ' 项可重新推导的证据，' +
        '释放约 ' + formatBytes(plan?.evidence.reclaimableBytes ?? 0) + '：',
      details: (plan?.evidence.candidates ?? []).slice(0, 5).map((candidate) => candidate.path),
      warning:
        '只删 .cometflow/runtime 下的中间产物（归档事务的 staged/backup、已归档 change 的实现范围基线）；' +
        'changes/、specs/、.cometflow-history/ 一律不动。',
    };
  }
  return {
    title: '强制解锁（确认持有进程已退出）',
    action: '清除滞留锁',
    summary: '将清除下面这个事务锁：',
    details: [
      'pid ' + (plan?.lock.record?.pid ?? '?') + ' @ ' + (plan?.lock.record?.host ?? '?'),
      'action ' + (plan?.lock.record?.action ?? '?'),
      '起始 ' + (plan?.lock.record?.startedAt ?? '?'),
    ],
    warning:
      '只有在确认该进程确实已经退出时才继续：锁被清掉意味着别的进程可以立刻开始写同一个项目，' +
      '两个写者同时提交会让 spec 基线与 change 状态互相覆盖。',
  };
});

async function confirm(): Promise<void> {
  const action = pending.value;
  const plan = props.plan;
  if (action === null || plan === null) return;
  busy.value = action;
  try {
    const body =
      action === 'clean-temp'
        ? { expectedFiles: plan.temp.count }
        : action === 'clean-jobs'
          ? { expectedCandidates: plan.jobs.candidates }
          : action === 'clean-evidence'
            ? { expectedReclaimableBytes: plan.evidence.reclaimableBytes }
            : { expectedHolder: plan.lock.holder };
    // 证据回收走 `change gc` 的入口，另外三个走 doctor。
    const path = action === 'clean-evidence' ? '/project/evidence/clean' : '/project/doctor/' + action;
    const result = await project.projectApi<{ cleaned: unknown; report: unknown }>(
      path,
      { method: 'POST', body },
    );
    // 服务端返回的是执行后的新 doctor 结论：直接交给总览刷新，不用再点一次。
    emit('changed', result.report);
    emit('refresh');
    toasts.success('已完成', JSON.stringify(result.cleaned));
    pending.value = null;
  } catch (error) {
    // 预告值不匹配（409）是最需要说清楚的一种失败：什么都没删，重新看一眼再点。
    toasts.error('未执行', errorMessage(error));
    emit('refresh');
  } finally {
    busy.value = null;
  }
}
</script>
