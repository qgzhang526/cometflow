<template>
  <ChangeListCard
    v-model:show-archived="showArchived"
    v-model:draft-name="draft.name"
    v-model:draft-goal="draft.goal"
    v-model:draft-task="draft.task"
    :visible-changes="visibleChanges"
    :goals="goals"
    :tasks="tasks"
    :pointer="pointer"
    :pointer-resolved="pointerResolved"
    :active-count="activeCount"
    :empty-hint="emptyHint"
    :selected-name="selectedName"
    :busy="busy"
    :creating="creating"
    @reload="reload"
    @select="select"
    @set-current="setCurrent"
    @clear-current="clearCurrent"
    @change-goal="onGoalChange"
    @create="createChange"
  />

  <div v-if="selected" class="card">
    <div class="row">
      <h3 style="margin: 0">{{ selected.name }}</h3>
      <StatusBadge :tone="statusTone(selected.status)" :text="selected.status" />
      <StatusBadge v-if="selected.archived" tone="gray" text="archived" />
      <span class="grow" />
      <button @click="loadDetail">刷新详情</button>
    </div>

    <PhaseSteps :phase="selected.phase" :status="selected.status" />

    <div v-if="selected.status === 'blocked'" class="finding">
      连续得到相同失败结论，已停机等待人工介入（repair_attempts={{ selected.repair_attempts ?? 0 }}，
      verdict {{ shortHash(selected.last_verdict_hash) }}）。改完方向后需要显式解封，计数才会清零。
      <div class="row" style="margin-top: 8px">
        <input v-model="unblockNote" placeholder="解封说明（可空）" class="grow" />
        <button class="primary" :disabled="busy" @click="unblock">解除停机</button>
      </div>
    </div>

    <div class="tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        class="tab"
        :class="{ active: detailTab === tab.id }"
        @click="detailTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="detailTab === 'overview'">
      <div v-if="conflict.length > 0" class="finding">
        <b>归档被拦下：canonical spec 在这个 change 存续期间被改动过。</b>
        <ul>
          <li v-for="entry in conflict" :key="entry.path">
            <code>{{ entry.path }}</code>（{{ entry.kind }}）：期望 {{ shortHash(entry.expected) }}，实际
            {{ entry.actual === null ? '(文件已删除)' : shortHash(entry.actual) }}
          </li>
        </ul>
        <p class="muted">两条正确路径，选哪条取决于「这次 spec 改动是否影响本 change 的验收」：</p>
        <div class="toolbar">
          <button class="primary" :disabled="busy" @click="askRebase">路径 A：rebase 到当前基线</button>
          <button :disabled="busy" @click="startReconciliation">路径 B：按 ADR 0004 建 reconciliation change</button>
        </div>
        <p class="muted">
          A：把 change 重新冻结到当前 spec 版本，旧的验收记录改名作废（旧结论不给新版本背书）。<br />
          B：spec 语义真变了，就另开一个 change 承载这次契约变更，本 change 保持原有基线。
        </p>
      </div>

      <table>
        <tbody>
          <tr><th>goal / task</th><td>{{ selected.goal }} / {{ selected.task }}</td></tr>
          <tr><th>spec 绑定</th><td>{{ selected.spec_ref ?? '—' }}#{{ selected.spec_anchor ?? '—' }}</td></tr>
          <tr><th>spec 版本</th><td>v{{ selected.spec_version ?? '—' }} · hash {{ shortHash(selected.spec_hash) }}</td></tr>
          <tr v-if="selected.spec_base_hash !== undefined">
            <th>基线 hash</th><td>{{ shortHash(selected.spec_base_hash) }}</td>
          </tr>
          <tr><th>模块边界</th><td>{{ selected.module ?? '(unbounded)' }}</td></tr>
          <tr><th>anchor hash</th><td>{{ shortHash(selected.anchor_hash) }}</td></tr>
          <tr><th>验收项</th><td>{{ selected.acceptance_ids.join(', ') || '—' }}</td></tr>
          <tr v-if="selected.repair_attempts !== undefined">
            <th>修复轮次</th><td>{{ selected.repair_attempts ?? 0 }}</td>
          </tr>
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
        <span class="grow" />
        <button :disabled="busy || selected.archived" @click="askRebase">重新冻结基线（rebase）</button>
      </div>

      <p v-if="resume" class="muted">
        下一步：{{ resume.message }}<span v-if="resume.nextEvent">（{{ resume.nextEvent }}）</span>
      </p>

      <div v-if="activeJob" class="job-inline">
        <div class="row">
          <StatusBadge
            :tone="activeJob.status === 'succeeded' ? 'ok' : activeJob.status === 'failed' ? 'err' : 'brand'"
            :text="'job ' + activeJob.status"
          />
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
              <td>
                <StatusBadge :tone="verdict.result === 'passed' ? 'ok' : verdict.result === 'failed' ? 'err' : 'warn'" :text="verdict.result" />
              </td>
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
                  <td>
                    <button v-if="check.stdout || check.stderr" class="ghost" @click="toggleOutput(check.id)">
                      {{ openOutput === check.id ? '收起' : '输出' }}
                    </button>
                  </td>
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
            越界改动：{{ verifyOutcome.scope.unattributed.join(', ') }}
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

    <ChangeScopeTab v-else-if="detailTab === 'scope'" :change="selected.name" />
    <ChangeJournalTab v-else-if="detailTab === 'journal'" :change="selected.name" />
    <ChangeEvidenceTab v-else :change="selected.name" />
  </div>

  <ModalCard v-if="rebaseConfirm" title="重新冻结基线（rebase）" @close="rebaseConfirm = false">
    <p>把 <b>{{ selected?.name }}</b> 重新冻结到当前 canonical spec 版本？</p>
    <ul class="muted">
      <li>spec 版本、正文哈希与验收项按当前 spec 重取（等价于「升级契约后重做」）。</li>
      <li>若已进入 verify/archive，阶段退回 build，旧验收记录改名留档，避免旧结论给新版本背书。</li>
      <li>若 spec 的语义变化影响到本 change 的验收，正确做法是按 ADR 0004 另建 reconciliation change。</li>
    </ul>
    <template #footer>
      <button @click="rebaseConfirm = false">取消</button>
      <button class="primary" :disabled="busy" @click="rebase">确认 rebase</button>
    </template>
  </ModalCard>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import ModalCard from '../../components/ModalCard.vue';
import PhaseSteps from '../../components/PhaseSteps.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { ApiError, errorMessage } from '../../api/client';
import { refreshCounter } from '../../composables/useRefresh';
import { useJobsStore } from '../../stores/jobs';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import ChangeEvidenceTab from './changes/ChangeEvidenceTab.vue';
import ChangeJournalTab from './changes/ChangeJournalTab.vue';
import ChangeListCard from './changes/ChangeListCard.vue';
import ChangeScopeTab from './changes/ChangeScopeTab.vue';
import type {
  ChangeArchiveOutcome,
  ChangeRebaseOutcome,
  ChangeResume,
  ChangeState,
  ChangeUnblockOutcome,
  ChangeVerifyOutcome,
  CurrentChangePointer,
  CurrentChangeResponse,
  GoalRecord,
  SpecConflictDetail,
  TaskPlan,
} from '../../api/types';
import { shortHash } from '../../utils/format';

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'scope', label: '范围' },
  { id: 'journal', label: '流水' },
  { id: 'evidence', label: '证据' },
] as const;

const project = useProjectStore();
const jobs = useJobsStore();
const toasts = useToastStore();
const route = useRoute();

const changes = ref<ChangeState[]>([]);
const goals = ref<GoalRecord[]>([]);
const tasks = ref<Array<{ id: string; title: string }>>([]);
const selectedName = ref('');
const selected = ref<ChangeState | null>(null);
const pointer = ref<CurrentChangePointer | null>(null);
const pointerResolved = ref(false);
const resume = ref<ChangeResume | null>(null);
const verifyOutcome = ref<ChangeVerifyOutcome | null>(null);
const archiveOutcome = ref<ChangeArchiveOutcome | null>(null);
const conflict = ref<SpecConflictDetail[]>([]);
const showArchived = ref(false);
const busy = ref(false);
const creating = ref(false);
const openOutput = ref('');
const runAgent = ref('opencode');
const activeJobId = ref<string | null>(null);
const detailTab = ref<(typeof TABS)[number]['id']>('overview');
const rebaseConfirm = ref(false);
const unblockNote = ref('');
const draft = reactive({ name: '', goal: '', task: '' });

const visibleChanges = computed(() =>
  showArchived.value ? changes.value : changes.value.filter((change) => !change.archived),
);
const activeCount = computed(() => changes.value.filter((change) => !change.archived).length);
const archivedCount = computed(() => changes.value.filter((change) => change.archived).length);
/** 只有已归档 change 时不要报「暂无变更」，否则用户会以为记录丢了。 */
const emptyHint = computed(() =>
  archivedCount.value > 0
    ? '没有进行中的变更；该项目有 ' + archivedCount.value + ' 个已归档变更，勾选「显示已归档」查看'
    : '暂无变更',
);
const agentOptions = computed(() => {
  const set = new Set(project.availableAgents.map((agent) => agent.id));
  const configured = project.config?.config.agent;
  if (configured) set.add(configured);
  if (set.size === 0) set.add('opencode');
  return [...set];
});
/**
 * 正在展示的 job。
 *
 * 优先用本次会话启动的那个；否则回退到任务列表里这个 change 最近的一次运行——
 * 刷新页面后（甚至别的会话跑的）日志也能自动补上，而不是等用户重新跑一遍。
 */
const activeJob = computed(() => {
  if (activeJobId.value !== null) {
    const explicit = jobs.jobs[activeJobId.value];
    if (explicit) return explicit;
  }
  if (selectedName.value === '') return null;
  return jobs.latestFor('change-run', { change: selectedName.value });
});
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
    const [changeData, goalData, configData, pointerData] = await Promise.all([
      project.projectApi<{ changes: ChangeState[] }>('/changes'),
      project.projectApi<{ goals: GoalRecord[] }>('/goals'),
      project.config === null ? project.loadConfig() : Promise.resolve(project.config),
      project.projectApi<CurrentChangeResponse>('/current-change'),
    ]);
    changes.value = changeData.changes;
    goals.value = goalData.goals;
    pointer.value = pointerData.pointer;
    pointerResolved.value = pointerData.resolved;
    const configured = configData.config.agent;
    if (configured) runAgent.value = configured;
    if (selectedName.value !== '') await loadDetail();
  } catch (error) {
    toasts.error('加载变更失败', errorMessage(error));
  }
}

/** 设定当前 change：这是多活跃 change 时唯一能解除写入门禁 fail closed 的动作。 */
async function setCurrent(name: string): Promise<void> {
  busy.value = true;
  try {
    await project.projectApi('/current-change', { method: 'POST', body: { name } });
    await reload();
    toasts.success('已设为当前 change', name + '：写入门禁将按它的模块边界判定');
  } catch (error) {
    toasts.error('设置失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function clearCurrent(): Promise<void> {
  busy.value = true;
  try {
    await project.projectApi('/current-change', { method: 'POST', body: { name: null } });
    await reload();
    toasts.success('已清除当前 change', '之后多个活跃 change 的写入会被 fail closed');
  } catch (error) {
    toasts.error('清除失败', errorMessage(error));
  } finally {
    busy.value = false;
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
  conflict.value = [];
  activeJobId.value = null;
  openOutput.value = '';
  detailTab.value = 'overview';
  unblockNote.value = '';
  await loadDetail();
}

async function onGoalChange(): Promise<void> {
  draft.task = '';
  tasks.value = [];
  if (draft.goal === '') return;
  try {
    const plan = await project.projectApi<TaskPlan>('/plans/' + encodeURIComponent(draft.goal));
    tasks.value = plan.tasks
      .filter((task) => task.status === 'frozen')
      .map((task) => ({ id: task.id, title: task.title }));
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
    conflict.value = [];
    await reloadList();
    selected.value = archiveOutcome.value.change;
    toasts.success('已归档', selectedName.value);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'spec-base-conflict') {
      conflict.value = (error.details as { conflicts?: SpecConflictDetail[] } | undefined)?.conflicts ?? [];
      detailTab.value = 'overview';
      toasts.error('归档被拦下', 'canonical spec 在 change 存续期间被改动，请选择 rebase 或 reconciliation');
    } else {
      toasts.error('归档失败', errorMessage(error));
    }
  } finally {
    busy.value = false;
  }
}

function askRebase(): void {
  rebaseConfirm.value = true;
}

async function rebase(): Promise<void> {
  busy.value = true;
  try {
    const outcome = await project.projectApi<ChangeRebaseOutcome>(
      '/changes/' + encodeURIComponent(selectedName.value) + '/rebase',
      { method: 'POST' },
    );
    rebaseConfirm.value = false;
    conflict.value = [];
    verifyOutcome.value = null;
    await reload();
    toasts.success(
      '已重新冻结基线',
      'spec v' + (outcome.specVersion ?? '—') + ' · 验收项 ' + (outcome.acceptanceIds.join(', ') || '(none)'),
    );
  } catch (error) {
    toasts.error('rebase 失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function unblock(): Promise<void> {
  busy.value = true;
  try {
    const outcome = await project.projectApi<ChangeUnblockOutcome>(
      '/changes/' + encodeURIComponent(selectedName.value) + '/unblock',
      { method: 'POST', body: { note: unblockNote.value } },
    );
    unblockNote.value = '';
    await reload();
    toasts.success('已解除停机', '此前累计失败 ' + outcome.previousAttempts + ' 轮，计数已清零');
  } catch (error) {
    toasts.error('解除停机失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

/** 路径 B：不在原 change 上改历史，而是另开一个 change 承载契约变更（ADR 0004）。 */
function startReconciliation(): void {
  draft.name = selectedName.value + '-reconcile';
  draft.goal = selected.value?.goal ?? '';
  void onGoalChange().then(() => {
    draft.task = selected.value?.task ?? '';
    document.getElementById('change-list-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toasts.info('已预填 reconciliation change', '确认 task 后点「新建」');
  });
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

// 任务中心可以深链到某个 change：`#/project/<id>/changes?change=<name>`。
watch(
  () => route.query.change,
  (value) => {
    if (typeof value !== 'string' || value === '' || value === selectedName.value) return;
    void select(value);
  },
  { immediate: true },
);

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
