<template>
  <div class="card">
    <div class="toolbar">
      <label>
        目标
        <select v-model="selectedGoal" @change="loadPlan">
          <option v-for="goal in goals" :key="goal.id" :value="goal.id">{{ goal.id }} · {{ goal.title }}</option>
        </select>
      </label>
      <span v-if="plan" class="badge brand">{{ plan.status }}</span>
      <span class="grow" />
      <button class="primary" :disabled="busy || selectedGoal === ''" @click="action('generate')">生成</button>
      <button :disabled="busy || !canValidate" @click="validatePlan">校验</button>
      <button :disabled="busy || plan?.status !== 'draft'" @click="action('review')">评审</button>
      <button :disabled="busy || !canApprove" @click="action('approve')">批准</button>
      <button :disabled="busy || !canFreeze" @click="action('freeze')">冻结</button>
      <button :disabled="busy || !canRegenerate" @click="regenerate">重新生成</button>
    </div>
    <p class="muted">
      状态流转：draft → validated → approved → frozen。冻结会把「任务 ↔ spec」固化成可校验的版本引用。
    </p>
  </div>

  <div class="card">
    <h2>任务列表</h2>
    <p v-if="plan === null" class="empty">该目标尚无计划，点击「生成」开始拆解。</p>
    <table v-else>
      <thead>
        <tr><th>ID</th><th>标题</th><th>kind</th><th>capability</th><th>spec 绑定</th><th>依赖</th><th>状态</th></tr>
      </thead>
      <tbody>
        <tr v-for="task in plan.tasks" :key="task.id">
          <td><b>{{ task.id }}</b></td>
          <td>{{ task.title }}</td>
          <td>{{ task.kind }}</td>
          <td>{{ task.capability }}</td>
          <td>
            <span v-if="task.spec_ref" class="muted">{{ task.spec_ref }}#{{ task.spec_anchor }}</span>
            <span v-else class="muted">—</span>
            <div class="muted">
              v{{ task.spec_version ?? '—' }} · {{ shortHash(task.spec_hash) }}
              <template v-if="task.module"> · module {{ task.module }}</template>
            </div>
          </td>
          <td>{{ task.depends_on.join(', ') || '—' }}</td>
          <td><StatusBadge :tone="task.status === 'frozen' ? 'ok' : task.status === 'cancelled' ? 'gray' : 'warn'" :text="task.status" /></td>
        </tr>
      </tbody>
    </table>
    <p v-if="plan" class="muted">
      plan_hash {{ shortHash(plan.plan_hash) }} · acceptance 覆盖：
      {{ plan.tasks.reduce((total, task) => total + task.acceptance_ids.length, 0) }} 项
    </p>
  </div>

  <div v-if="validation" class="card">
    <h2>校验结果</h2>
    <p class="badge" :class="validation.valid ? 'ok' : 'err'">
      {{ validation.valid ? '0 error' : 'has error' }} · {{ validation.findings.length }} findings
    </p>
    <div
      v-for="(finding, position) in validation.findings"
      :key="position"
      class="finding"
      :class="{ warning: finding.severity === 'warning' }"
    >
      [{{ finding.severity }}] {{ finding.code }}<span v-if="finding.taskId" class="muted"> {{ finding.taskId }}</span>
      {{ finding.message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { ApiError, errorMessage } from '../../api/client';
import { refreshCounter } from '../../composables/useRefresh';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { GoalRecord, PlanValidationResult, TaskPlan } from '../../api/types';
import { shortHash } from '../../utils/format';

const project = useProjectStore();
const toasts = useToastStore();

const goals = ref<GoalRecord[]>([]);
const selectedGoal = ref('');
const plan = ref<TaskPlan | null>(null);
const validation = ref<PlanValidationResult | null>(null);
const summaries = ref<Array<{ goal: string; status: string; tasks: number }>>([]);
const busy = ref(false);

const canValidate = computed(() => plan.value !== null);
const canApprove = computed(() => plan.value?.status === 'draft' || plan.value?.status === 'validated');
const canFreeze = computed(() => plan.value?.status === 'approved');
const canRegenerate = computed(() => plan.value !== null && plan.value.status !== 'frozen');

async function loadGoals(): Promise<void> {
  const [goalData, planData] = await Promise.all([
    project.projectApi<{ goals: GoalRecord[] }>('/goals'),
    project.projectApi<{ plans: Array<{ goal: string; status: string; tasks: number }> }>('/plans'),
  ]);
  goals.value = goalData.goals;
  summaries.value = planData.plans;
  if (selectedGoal.value === '' && goals.value.length > 0) selectedGoal.value = goals.value[0].id;
}

async function loadPlan(): Promise<void> {
  validation.value = null;
  if (selectedGoal.value === '') return;
  try {
    plan.value = await project.projectApi<TaskPlan>('/plans/' + encodeURIComponent(selectedGoal.value));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      plan.value = null;
      return;
    }
    toasts.error('读取计划失败', errorMessage(error));
  }
}

async function action(kind: 'generate' | 'review' | 'approve' | 'freeze'): Promise<void> {
  if (selectedGoal.value === '') return;
  busy.value = true;
  try {
    const suffix = kind === 'generate' ? '/plans/generate' : '/plans/' + encodeURIComponent(selectedGoal.value) + '/' + kind;
    const body = kind === 'generate' ? { goal: selectedGoal.value } : {};
    await project.projectApi(suffix, { method: 'POST', body });
    await loadPlan();
    await loadSummaries();
    toasts.success('已执行 ' + kind);
  } catch (error) {
    toasts.error(kind + ' 失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function regenerate(): Promise<void> {
  if (selectedGoal.value === '') return;
  busy.value = true;
  try {
    await project.projectApi('/plans/regenerate', {
      method: 'POST',
      body: { goal: selectedGoal.value, preserveApproved: true },
    });
    await loadPlan();
    await loadSummaries();
    toasts.success('已重新生成', '未受影响的 approved/frozen 任务被保留');
  } catch (error) {
    toasts.error('重新生成失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function validatePlan(): Promise<void> {
  if (selectedGoal.value === '') return;
  busy.value = true;
  try {
    validation.value = await project.projectApi<PlanValidationResult>(
      '/plans/' + encodeURIComponent(selectedGoal.value) + '/validate',
      { method: 'POST' },
    );
  } catch (error) {
    toasts.error('校验失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function loadSummaries(): Promise<void> {
  const data = await project.projectApi<{ plans: Array<{ goal: string; status: string; tasks: number }> }>('/plans');
  summaries.value = data.plans;
}

onMounted(async () => {
  try {
    await loadGoals();
    await loadPlan();
  } catch (error) {
    toasts.error('加载失败', errorMessage(error));
  }
});

watch(() => refreshCounter('plans'), () => {
  void loadSummaries();
  void loadPlan();
});
</script>
