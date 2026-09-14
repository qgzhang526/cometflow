<template>
  <div class="card">
    <h2>进化提案</h2>
    <div class="toolbar">
      <input v-model="form.name" placeholder="name" />
      <input v-model="form.summary" placeholder="summary" class="grow" />
      <input v-model="form.risk" placeholder="风险与门禁计划（可选）" class="grow" />
      <button class="primary" :disabled="creating" @click="propose">提出</button>
    </div>
    <p class="muted">状态：draft → verifying → verified → ready-for-review → approved / rejected（终态）。</p>
  </div>

  <div class="card">
    <p v-if="proposals.length === 0" class="empty">暂无提案</p>
    <div v-for="proposal in proposals" :key="proposal.name" class="proposal">
      <div class="row">
        <b>{{ proposal.name }}</b>
        <StatusBadge :tone="toneFor(proposal.status)" :text="proposal.status" />
        <span class="grow" />
        <span class="muted">更新于 {{ relativeTime(proposal.updated_at) }}</span>
      </div>
      <p>{{ proposal.summary }}</p>
      <p v-if="proposal.risk_plan" class="muted">风险计划：{{ proposal.risk_plan }}</p>
      <div v-if="proposal.gates.length > 0" class="muted">
        门禁：
        <span v-for="gate in proposal.gates" :key="gate.name">{{ gate.name }}({{ [gate.command, ...gate.args].join(' ') }}) </span>
      </div>
      <p v-if="proposal.eval" class="muted">
        eval: {{ proposal.eval.passed ? 'PASS' : 'FAIL' }} · pass@k {{ proposal.eval.passAtKRate.toFixed(2) }} · pass^k
        {{ proposal.eval.passAllKRate.toFixed(2) }} · sampling {{ proposal.eval.sampling }}
      </p>
      <p v-if="proposal.review_note" class="muted">评审意见：{{ proposal.review_note }}</p>
      <p v-if="proposal.merged_commits?.length" class="muted">合并提交：{{ proposal.merged_commits.join(', ') }}</p>
      <p v-if="proposal.rejected_reason" class="muted">驳回原因：{{ proposal.rejected_reason }}</p>

      <div class="toolbar">
        <button
          :disabled="busy || proposal.status === 'approved' || proposal.status === 'rejected'"
          @click="verify(proposal.name)"
        >
          门禁验证
        </button>
        <label v-if="verifyingName === proposal.name" class="muted">
          <input v-model="includeEval" type="checkbox" /> 同时跑本地 eval
        </label>
        <button :disabled="busy || proposal.status !== 'verified'" @click="submit(proposal.name)">提交评审</button>
        <button class="primary" :disabled="busy || proposal.status !== 'ready-for-review'" @click="startReview(proposal.name, 'approve')">
          批准
        </button>
        <button :disabled="busy || proposal.status !== 'ready-for-review'" @click="startReview(proposal.name, 'reject')">驳回</button>
      </div>
    </div>
  </div>

  <ModalCard v-if="review !== null" :title="review.action === 'approve' ? '批准 ' + review.name : '驳回 ' + review.name" @close="review = null">
    <div class="form-grid">
      <label v-if="review.action === 'approve'">
        评审意见
        <textarea v-model="review.note" rows="3" placeholder="可空" />
      </label>
      <label v-if="review.action === 'approve'">合并提交（逗号分隔）<input v-model="review.commits" placeholder="abc123, def456" /></label>
      <label v-if="review.action === 'reject'">驳回原因（必填）<textarea v-model="review.reason" rows="3" /></label>
    </div>
    <template #footer>
      <button @click="review = null">取消</button>
      <button class="primary" :disabled="busy" @click="confirmReview">确认</button>
    </template>
  </ModalCard>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import ModalCard from '../../components/ModalCard.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { errorMessage } from '../../api/client';
import { refreshCounter } from '../../composables/useRefresh';
import { useJobsStore } from '../../stores/jobs';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { EvolutionProposal, EvolutionStatus, JobRecord } from '../../api/types';
import { relativeTime } from '../../utils/format';

const project = useProjectStore();
const jobs = useJobsStore();
const toasts = useToastStore();

const proposals = ref<EvolutionProposal[]>([]);
const form = reactive({ name: '', summary: '', risk: '' });
const creating = ref(false);
const busy = ref(false);
const verifyingName = ref('');
const includeEval = ref(false);
const review = ref<{ name: string; action: 'approve' | 'reject'; note: string; commits: string; reason: string } | null>(null);

function toneFor(status: EvolutionStatus): 'ok' | 'warn' | 'err' | 'gray' | 'brand' {
  if (status === 'approved') return 'ok';
  if (status === 'rejected') return 'err';
  if (status === 'ready-for-review') return 'brand';
  return 'warn';
}

async function load(): Promise<void> {
  try {
    const data = await project.projectApi<{ evolutions: EvolutionProposal[] }>('/evolutions');
    proposals.value = data.evolutions;
  } catch (error) {
    toasts.error('加载提案失败', errorMessage(error));
  }
}

async function propose(): Promise<void> {
  if (form.name.trim() === '') {
    toasts.error('请填写提案名称');
    return;
  }
  creating.value = true;
  try {
    await project.projectApi('/evolutions', { method: 'POST', body: { ...form } });
    Object.assign(form, { name: '', summary: '', risk: '' });
    await load();
    toasts.success('提案已创建');
  } catch (error) {
    toasts.error('创建失败', errorMessage(error));
  } finally {
    creating.value = false;
  }
}

async function verify(name: string): Promise<void> {
  verifyingName.value = name;
  busy.value = true;
  try {
    const data = await project.projectApi<{ jobId: string }>('/evolutions/' + encodeURIComponent(name) + '/verify', {
      method: 'POST',
      body: { eval: includeEval.value },
    });
    await jobs.track(data.jobId);
    toasts.info('门禁验证已启动', '进度见「任务中心」');
  } catch (error) {
    toasts.error('启动失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function submit(name: string): Promise<void> {
  busy.value = true;
  try {
    await project.projectApi('/evolutions/' + encodeURIComponent(name) + '/submit', { method: 'POST' });
    await load();
    toasts.success('已提交评审');
  } catch (error) {
    toasts.error('提交失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

function startReview(name: string, action: 'approve' | 'reject'): void {
  review.value = { name, action, note: '', commits: '', reason: '' };
}

async function confirmReview(): Promise<void> {
  const current = review.value;
  if (current === null) return;
  if (current.action === 'reject' && current.reason.trim() === '') {
    toasts.error('请填写驳回原因');
    return;
  }
  busy.value = true;
  try {
    if (current.action === 'approve') {
      await project.projectApi('/evolutions/' + encodeURIComponent(current.name) + '/approve', {
        method: 'POST',
        body: { note: current.note, commits: current.commits },
      });
      toasts.success('已批准', current.name);
    } else {
      await project.projectApi('/evolutions/' + encodeURIComponent(current.name) + '/reject', {
        method: 'POST',
        body: { reason: current.reason },
      });
      toasts.success('已驳回', current.name);
    }
    review.value = null;
    await load();
  } catch (error) {
    toasts.error('评审失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

onMounted(load);

watch(
  () => jobs.list.filter((job: JobRecord) => job.kind === 'evolve-verify').map((job) => job.status).join(','),
  () => void load(),
);

watch(() => refreshCounter('evolve'), () => void load());
</script>
