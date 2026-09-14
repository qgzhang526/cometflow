<template>
  <div class="card">
    <div class="row">
      <h2>变更 Changes</h2>
      <span class="grow" />
      <label class="muted"><input v-model="showArchived" type="checkbox" /> 显示已归档</label>
      <button @click="reload">刷新</button>
    </div>

    <div class="toolbar">
      <input v-model="draft.name" placeholder="change 名称（如 auth-login）" />
      <select v-model="draft.goal" @change="onGoalChange">
        <option value="">选择 goal…</option>
        <option v-for="goal in goals" :key="goal.id" :value="goal.id">{{ goal.id }} · {{ goal.title }}</option>
      </select>
      <select v-model="draft.task" :disabled="tasks.length === 0">
        <option value="">{{ tasks.length === 0 ? '该目标无 frozen 任务' : '选择 task…' }}</option>
        <option v-for="task in tasks" :key="task.id" :value="task.id">{{ task.id }} · {{ task.title }}</option>
      </select>
      <button class="primary" :disabled="creating" @click="createChange">新建</button>
    </div>

    <table>
      <thead><tr><th>名称</th><th>phase</th><th>status</th><th /></tr></thead>
      <tbody>
        <tr v-for="change in visibleChanges" :key="change.name" :class="{ selected: change.name === selectedName }">
          <td><b>{{ change.name }}</b></td>
          <td><StatusBadge :tone="change.archived ? 'gray' : 'ok'" :text="change.phase + (change.archived ? ' · archived' : '')" /></td>
          <td><StatusBadge :tone="statusTone(change.status)" :text="change.status" /></td>
          <td><button class="ghost" @click="select(change.name)">打开</button></td>
        </tr>
        <tr v-if="visibleChanges.length === 0"><td colspan="4" class="muted">{{ emptyHint }}</td></tr>
      </tbody>
    </table>
  </div>

  <div v-if="selected" class="card">
    <div class="row">
      <h3 style="margin: 0">{{ selected.name }}</h3>
      <StatusBadge :tone="statusTone(selected.status)" :text="selected.status" />
      <StatusBadge v-if="selected.archived" tone="gray" text="archived" />
      <span class="grow" />
      <button @click="loadDetail">刷新详情</button>
    </div>

    <PhaseSteps :phase="selected.phase" :status="selected.status" />

    <table>
      <tbody>
        <tr><th>goal / task</th><td>{{ selected.goal }} / {{ selected.task }}</td></tr>
        <tr><th>spec 绑定</th><td>{{ selected.spec_ref ?? '—' }}#{{ selected.spec_anchor ?? '—' }}</td></tr>
        <tr><th>spec 版本</th><td>v{{ selected.spec_version ?? '—' }} · hash {{ shortHash(selected.spec_hash) }}</td></tr>
        <tr><th>模块边界</th><td>{{ selected.module ?? '(unbounded)' }}</td></tr>
        <tr><th>anchor hash</th><td>{{ shortHash(selected.anchor_hash) }}</td></tr>
        <tr><th>验收项</th><td>{{ selected.acceptance_ids.join(', ') || '—' }}</td></tr>
        <tr><th>状态哈希</th><td>{{ shortHash(selected.state_hash) }}</td></tr>
        <tr><th>创建时间</th><td>{{ selected.created_at }}</td></tr>
      </tbody>
    </table>

    <div class="toolbar" style="margin-top: 12px">
      <button :disabled="busy || selected.archived || selected.phase !== 'shape'" @click="transition('confirm-acceptance')">
        确认验收
      </button>
      <select v-model="runAgent" :disabled="selected.phase !== 'build'">
        <option v-for="agent in agentOptions" :key="agent" :value="agent">{{ agent }}</option>
      </select>
      <button class="primary" :disabled="busy || selected.archived || selected.phase !== 'build'" @click="runBuilder">
        运行 Builder
      </button>
      <button :disabled="busy || selected.archived || selected.phase !== 'verify'" @click="verify">验收</button>
      <button :disabled="busy || selected.archived || selected.phase !== 'archive'" @click="archive">归档</button>
    </div>

    <p v-if="resume" class="muted">下一步：{{ resume.message }}<span v-if="resume.nextEvent">（{{ resume.nextEvent }}）</span></p>

    <div v-if="activeJob" class="job-inline">
      <div class="row">
        <StatusBadge :tone="activeJob.status === 'succeeded' ? 'ok' : activeJob.status === 'failed' ? 'err' : 'brand'" :text="'job ' + activeJob.status" />
        <span class="muted">{{ activeJob.id }} · {{ activeJob.kind }}</span>
        <span class="grow" />
        <button class="ghost" @click="jobs.drawerOpen = true">在任务中心查看</button>
      </div>
      <pre class="logbox">{{ jobLog }}</pre>
    </div>

    <div v-if="verifyOutcome" class="verify-result">
      <h3>
        验收结论
        <StatusBadge :tone="verifyOutcome.reportPassed ? 'ok' : 'err'" :text="verifyOutcome.reportPassed ? 'pass' : 'fail'" />
        <span class="muted">verifier: {{ verifyOutcome.verifierAgent ?? '(none)' }}</span>
      </h3>
      <table>
        <thead><tr><th>acceptance</th><th>结论</th><th>来源</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="verdict in verifyOutcome.verdicts" :key="verdict.id">
            <td><b>{{ verdict.id }}</b></td>
            <td><StatusBadge :tone="verdict.result === 'passed' ? 'ok' : verdict.result === 'failed' ? 'err' : 'warn'" :text="verdict.result" /></td>
            <td>{{ verdict.source }}</td>
            <td class="muted">{{ verdict.reason }}</td>
          </tr>
        </tbody>
      </table>

      <template v-if="verifyOutcome.checks">
        <h3>可执行检查</h3>
        <table>
          <thead><tr><th>acceptance</th><th>命令</th><th>结果</th><th>说明</th><th /></tr></thead>
          <tbody>
            <template v-for="check in verifyOutcome.checks.results" :key="check.id">
              <tr>
                <td><b>{{ check.id }}</b></td>
                <td><code>{{ check.check ?? '(未声明 check)' }}</code></td>
                <td>
                  <StatusBadge
                    :tone="check.passed === true ? 'ok' : check.passed === false ? 'err' : 'warn'"
                    :text="check.passed === true ? 'passed' : check.passed === false ? 'failed' : 'uncovered'"
                  />
                  <span v-if="check.exitCode !== null" class="muted"> exit={{ check.exitCode }}</span>
                  <span v-if="check.timedOut" class="muted"> timeout</span>
                </td>
                <td class="muted">{{ check.reason }}</td>
                <td><button v-if="check.stdout || check.stderr" class="ghost" @click="toggleOutput(check.id)">{{ openOutput === check.id ? '收起' : '输出' }}</button></td>
              </tr>
              <tr v-if="openOutput === check.id">
                <td colspan="5"><pre class="logbox">{{ (check.stdout + '\n' + check.stderr).trim() || '(无输出)' }}</pre></td>
              </tr>
            </template>
          </tbody>
        </table>
      </template>

      <template v-if="verifyOutcome.scope">
        <h3>实现范围</h3>
        <p class="muted">
          module: {{ verifyOutcome.scope.module ?? '(unbounded)' }} · baseline:
          {{ verifyOutcome.scope.baseline_captured_at ?? '(missing)' }} · 变更文件 {{ verifyOutcome.scope.changes.length }} 个
        </p>
        <div v-if="verifyOutcome.scope.unattributed.length > 0" class="finding">
          越界改动（不在模块边界或 allow 列表内）：{{ verifyOutcome.scope.unattributed.join(', ') }}
        </div>
        <p v-else class="badge ok">无越界改动</p>
      </template>
    </div>

    <div v-if="archiveOutcome" class="verify-result">
      <h3>归档结果</h3>
      <p v-if="archiveOutcome.appliedSpecs.length > 0" class="muted">应用的 spec：{{ archiveOutcome.appliedSpecs.join(', ') }}</p>
      <p v-else class="muted">本次归档没有需要应用的 spec 变更。</p>
      <p v-for="version in archiveOutcome.specVersions ?? []" :key="version.path" class="muted">
        versioned {{ version.path }} @v{{ version.spec_version }} {{ shortHash(version.hash) }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import PhaseSteps from '../../components/PhaseSteps.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { errorMessage } from '../../api/client';
import { refreshCounter } from '../../composables/useRefresh';
import { useJobsStore } from '../../stores/jobs';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type {
  ChangeArchiveOutcome,
  ChangeResume,
  ChangeState,
  ChangeVerifyOutcome,
  GoalRecord,
  TaskPlan,
} from '../../api/types';
import { shortHash } from '../../utils/format';

const project = useProjectStore();
const jobs = useJobsStore();
const toasts = useToastStore();

const changes = ref<ChangeState[]>([]);
const goals = ref<GoalRecord[]>([]);
const tasks = ref<Array<{ id: string; title: string }>>([]);
const selectedName = ref('');
const selected = ref<ChangeState | null>(null);
const resume = ref<ChangeResume | null>(null);
const verifyOutcome = ref<ChangeVerifyOutcome | null>(null);
const archiveOutcome = ref<ChangeArchiveOutcome | null>(null);
const showArchived = ref(false);
const busy = ref(false);
const creating = ref(false);
const openOutput = ref('');
const runAgent = ref('opencode');
const activeJobId = ref<string | null>(null);
const draft = reactive({ name: '', goal: '', task: '' });

const visibleChanges = computed(() => (showArchived.value ? changes.value : changes.value.filter((change) => !change.archived)));
const archivedCount = computed(() => changes.value.filter((change) => change.archived).length);
/** 只有已归档 change 时不要报「暂无变更」，否则用户会以为记录丢了。 */
const emptyHint = computed(() =>
  archivedCount.value > 0
    ? '没有进行中的变更；该项目有 ' + archivedCount.value + ' 个已归档变更，勾选「显示已归档」查看'
    : '暂无变更',
);
const agentOptions = computed(() => {
  const available = project.availableAgents.map((agent) => agent.id);
  const configured = project.config?.config.agent;
  const set = new Set(available);
  if (configured) set.add(configured);
  if (set.size === 0) set.add('opencode');
  return [...set];
});
const activeJob = computed(() => (activeJobId.value === null ? null : jobs.jobs[activeJobId.value] ?? null));
const jobLog = computed(() => {
  const job = activeJob.value;
  if (job === null) return '';
  const lines = job.logTail.join('\n');
  if (job.status === 'failed') return lines + '\n[failed] ' + (job.error ?? '');
  if (job.status === 'succeeded') return lines + '\n[succeeded]';
  return lines === '' ? '等待日志…' : lines;
});

function statusTone(status: ChangeState['status']): 'ok' | 'warn' | 'err' | 'gray' | 'brand' {
  if (status === 'done') return 'ok';
  if (status === 'blocked') return 'err';
  if (status === 'await-user') return 'warn';
  return 'brand';
}

async function reload(): Promise<void> {
  try {
    const [changeData, goalData, configData] = await Promise.all([
      project.projectApi<{ changes: ChangeState[] }>('/changes'),
      project.projectApi<{ goals: GoalRecord[] }>('/goals'),
      project.config === null ? project.loadConfig() : Promise.resolve(project.config),
    ]);
    changes.value = changeData.changes;
    goals.value = goalData.goals;
    const configured = configData.config.agent;
    if (configured) runAgent.value = configured;
    if (selectedName.value !== '') await loadDetail();
  } catch (error) {
    toasts.error('加载变更失败', errorMessage(error));
  }
}

async function loadDetail(): Promise<void> {
  if (selectedName.value === '') return;
  try {
    const [state, resumeData] = await Promise.all([
      project.projectApi<ChangeState>('/changes/' + encodeURIComponent(selectedName.value)),
      project
        .projectApi<ChangeResume>('/changes/' + encodeURIComponent(selectedName.value) + '/resume', { method: 'POST' })
        .catch(() => null),
    ]);
    selected.value = state;
    resume.value = resumeData;
  } catch (error) {
    toasts.error('读取变更失败', errorMessage(error));
    selected.value = null;
  }
}

async function select(name: string): Promise<void> {
  selectedName.value = name;
  verifyOutcome.value = null;
  archiveOutcome.value = null;
  activeJobId.value = null;
  openOutput.value = '';
  await loadDetail();
}

async function onGoalChange(): Promise<void> {
  draft.task = '';
  tasks.value = [];
  if (draft.goal === '') return;
  try {
    const plan = await project.projectApi<TaskPlan>('/plans/' + encodeURIComponent(draft.goal));
    tasks.value = plan.tasks.filter((task) => task.status === 'frozen').map((task) => ({ id: task.id, title: task.title }));
  } catch {
    tasks.value = [];
  }
}

async function createChange(): Promise<void> {
  if (draft.name.trim() === '' || draft.goal === '' || draft.task === '') {
    toasts.error('请填写完整', 'change 名称、goal、task 都是必填项');
    return;
  }
  creating.value = true;
  try {
    const data = await project.projectApi<{ change: ChangeState }>('/changes', { method: 'POST', body: { ...draft } });
    Object.assign(draft, { name: '', task: '' });
    await reload();
    await select(data.change.name);
    toasts.success('已创建 change', data.change.name);
  } catch (error) {
    toasts.error('创建失败', errorMessage(error));
  } finally {
    creating.value = false;
  }
}

async function transition(event: string): Promise<void> {
  busy.value = true;
  try {
    await project.projectApi('/changes/' + encodeURIComponent(selectedName.value) + '/transition', {
      method: 'POST',
      body: { event },
    });
    await reload();
    toasts.success('已应用迁移 ' + event);
  } catch (error) {
    toasts.error('迁移失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function runBuilder(): Promise<void> {
  busy.value = true;
  try {
    const data = await project.projectApi<{ jobId: string }>(
      '/changes/' + encodeURIComponent(selectedName.value) + '/run',
      { method: 'POST', body: { agent: runAgent.value } },
    );
    activeJobId.value = data.jobId;
    await jobs.track(data.jobId);
    toasts.info('Builder 已启动', '日志在「任务中心」，离开本面板也不会丢');
  } catch (error) {
    toasts.error('启动失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function verify(): Promise<void> {
  busy.value = true;
  try {
    verifyOutcome.value = await project.projectApi<ChangeVerifyOutcome>(
      '/changes/' + encodeURIComponent(selectedName.value) + '/verify',
      { method: 'POST' },
    );
    archiveOutcome.value = null;
    await reloadList();
    toasts.success('验收完成', verifyOutcome.value.reportPassed ? '全部通过' : '存在未通过项');
  } catch (error) {
    toasts.error('验收失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function archive(): Promise<void> {
  busy.value = true;
  try {
    archiveOutcome.value = await project.projectApi<ChangeArchiveOutcome>(
      '/changes/' + encodeURIComponent(selectedName.value) + '/archive',
      { method: 'POST' },
    );
    verifyOutcome.value = null;
    await reloadList();
    selected.value = archiveOutcome.value.change;
    toasts.success('已归档', selectedName.value);
  } catch (error) {
    toasts.error('归档失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

/** 只刷新列表，不覆盖正在展示的详情与结论。 */
async function reloadList(): Promise<void> {
  const data = await project.projectApi<{ changes: ChangeState[] }>('/changes');
  changes.value = data.changes;
}

function toggleOutput(id: string): void {
  openOutput.value = openOutput.value === id ? '' : id;
}

onMounted(reload);

watch(
  () => activeJob.value?.status,
  async (status) => {
    if (status === 'succeeded' || status === 'failed') await reload();
  },
);

watch(() => refreshCounter('changes'), () => {
  void reload();
});
</script>
