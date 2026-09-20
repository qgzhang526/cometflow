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
      <button :disabled="busy || selectedGoal === ''" @click="toggleTrace">
        {{ trace === null ? '追溯' : '收起追溯' }}
      </button>
    </div>
    <p class="muted">
      状态流转：draft → validated → approved → frozen。冻结会把「任务 ↔ spec」固化成可校验的版本引用。
      拆解审核策略 <code>plan_review</code>：<b>{{ policyLabel }}</b>{{ policyHint }}
    </p>
    <p v-if="review !== null" class="muted">上次拆解：{{ review.note }}</p>
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

  <div v-if="trace !== null" class="card">
    <div class="row">
      <h2>任务追溯（{{ trace.goal }}）</h2>
      <span class="grow" />
      <span class="muted">与 cometflow plan trace 同一份投影（含文本清单）</span>
    </div>
    <table>
      <thead><tr><th>任务</th><th>capability</th><th>spec 绑定</th><th>验收项</th><th>状态</th></tr></thead>
      <tbody>
        <tr v-for="task in trace.tasks" :key="task.id">
          <td><b>{{ task.id }}</b><div class="muted">{{ task.title }}</div></td>
          <td>{{ task.capability }}</td>
          <td>
            <template v-if="task.spec_ref && task.spec_anchor">
              {{ task.spec_ref }}#{{ task.spec_anchor }}
              <span class="muted"> · v{{ task.spec_version ?? '—' }}</span>
            </template>
            <span v-else class="badge warn">未绑定 spec</span>
          </td>
          <td>
            <span v-if="task.acceptance_ids.length > 0" class="muted">{{ task.acceptance_ids.join(', ') }}</span>
            <span v-else class="badge warn">无验收项</span>
          </td>
          <td><StatusBadge :tone="task.status === 'frozen' ? 'ok' : task.status === 'cancelled' ? 'gray' : 'warn'" :text="task.status" /></td>
        </tr>
      </tbody>
    </table>
    <details style="margin-top: 8px">
      <summary class="muted">文本清单（等同 <code>cometflow plan trace &lt;goal&gt;</code> 的输出）</summary>
      <pre class="logbox">{{ trace.lines.join('\n') }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { ApiError, errorMessage } from '../../api/client';
import { refreshCounter } from '../../composables/useRefresh';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { GoalRecord, PlanTraceResponse, PlanValidationResult, TaskPlan } from '../../api/types';
import { shortHash } from '../../utils/format';

const project = useProjectStore();
const toasts = useToastStore();

const goals = ref<GoalRecord[]>([]);
const selectedGoal = ref('');
const plan = ref<TaskPlan | null>(null);
const validation = ref<PlanValidationResult | null>(null);
const summaries = ref<Array<{ goal: string; status: string; tasks: number }>>([]);
const trace = ref<PlanTraceResponse | null>(null);
const busy = ref(false);

/** 拆解审核策略（ADR 0003）：策略本身在配置里，界面的职责是把它摊开说清楚。 */
interface PlanReviewNote {
  policy: string;
  declared: string | null;
  applied: boolean;
  note: string;
}

const review = ref<PlanReviewNote | null>(null);
const policy = ref<string | null>(null);

const policyLabel = computed(() => policy.value ?? '未配置');
const policyHint = computed(() => {
  if (policy.value === 'auto') return '——生成后机器校验，通过就直接 review + approve';
  if (policy.value === 'high-risk') return '——高风险识别规则尚未实现，当前按 human 处理（停在 draft）';
  if (policy.value === 'human') return '——生成后停在 draft，等人评审 / 批准';
  return '——未配置或值不认识时按 human 处理（停在 draft）';
});

const canValidate = computed(() => plan.value !== null);
const canApprove = computed(() => plan.value?.status === 'draft' || plan.value?.status === 'validated');
const canFreeze = computed(() => plan.value?.status === 'approved');
// 冻结计划也要能重生成：规格改了之后，路径就是「重新生成（保留未受影响的冻结任务）→ 校验 → 批准 → 冻结」，
// 这与 `plan regenerate --preserve-approved` 是同一份实现（受影响的退回 draft，没变的原样保留）。
// 之前的 `status !== 'frozen'` 把这条路堵死了，而「生成」在任何状态下都可用——两个按钮自相矛盾。
const canRegenerate = computed(() => plan.value !== null);

async function toggleTrace(): Promise<void> {
  if (trace.value !== null) {
    trace.value = null;
    return;
  }
  try {
    trace.value = await project.projectApi<PlanTraceResponse>(
      '/plans/' + encodeURIComponent(selectedGoal.value) + '/trace',
    );
  } catch (error) {
    toasts.error('读取追溯失败', errorMessage(error));
  }
}

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
    const data = await project.projectApi<{ review?: PlanReviewNote }>(suffix, { method: 'POST', body });
    if (data.review) review.value = data.review;
    await loadPlan();
    await loadSummaries();
    // 策略介入过就把结论原样说出来：不然「生了但停在 draft」看起来像没生效。
    if (data.review) toasts.success('已执行 ' + kind, data.review.note);
    else toasts.success('已执行 ' + kind);
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
    const data = await project.projectApi<{ review?: PlanReviewNote }>('/plans/regenerate', {
      method: 'POST',
      body: { goal: selectedGoal.value, preserveApproved: true },
    });
    if (data.review) review.value = data.review;
    await loadPlan();
    await loadSummaries();
    toasts.success('已重新生成', data.review?.note ?? '未受影响的 approved/frozen 任务被保留');
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
    const config = await project.loadConfig();
    policy.value = config.config.plan_review ?? null;
  } catch (error) {
    toasts.error('加载失败', errorMessage(error));
  }
});

watch(() => refreshCounter('plans'), () => {
  void loadSummaries();
  void loadPlan();
});
</script>
