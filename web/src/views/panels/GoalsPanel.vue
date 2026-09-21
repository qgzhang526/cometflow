<template>
  <div class="card">
    <div class="toolbar">
      <button class="primary" @click="openMissionEditor">COMETFLOW.md</button>
      <button @click="openGoalForm">＋ 添加目标</button>
      <button :disabled="syncing" @click="sync">{{ syncing ? '同步中…' : '同步' }}</button>
      <span class="grow" />
      <span class="muted">事实源：COMETFLOW.md → 投影：.cometflow/goals/</span>
    </div>
    <div class="tabs">
      <button v-for="tab in TABS" :key="tab.id" class="tab" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
        {{ tab.label }}
      </button>
    </div>
    <div class="tab-panel">
      <pre v-if="activeTab !== 'projection'" class="mdblock">{{ sections[activeTab] || '（空）' }}</pre>
      <table v-else>
        <thead>
          <tr><th>ID</th><th>标题</th><th>范围</th><th>成功标准</th><th>非目标</th></tr>
        </thead>
        <tbody>
          <tr v-for="goal in goals" :key="goal.id">
            <td><b>{{ goal.id }}</b></td>
            <td>{{ goal.title }}</td>
            <td>{{ goal.scope.join(', ') }}</td>
            <td>{{ goal.success_criteria.join('；') }}</td>
            <td>{{ goal.non_goals.join('；') }}</td>
            <td>
              <button class="ghost" @click="startEdit(goal)">编辑</button>
              <button class="ghost" @click="startRemove(goal)">删除</button>
            </td>
          </tr>
          <tr v-if="goals.length === 0">
            <td colspan="6" class="muted">暂无目标，点击「＋ 添加目标」或编辑 COMETFLOW.md 后同步</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <ModalCard v-if="missionEditor" title="COMETFLOW.md" wide @close="closeMissionEditor">
    <textarea v-model="missionDraft" class="modal-textarea" />
    <template #footer>
      <button @click="closeMissionEditor">取消</button>
      <button :disabled="savingMission" @click="saveMission(false)">保存</button>
      <button class="primary" :disabled="savingMission" @click="saveMission(true)">保存并同步</button>
    </template>
  </ModalCard>

  <ModalCard v-if="goalEditorOpen" :title="'添加目标 G' + nextGoalNumber" wide @close="closeGoalForm">
    <div class="form-grid">
      <label>目标标题 <input v-model="goalForm.title" placeholder="一句话描述该目标" /></label>
      <label>范围 capability <input v-model="goalForm.scope" placeholder="auth" /></label>
      <label>成功标准（每行一条）<textarea v-model="goalForm.criteria" rows="4" /></label>
      <label>非目标（每行一条，可空）<textarea v-model="goalForm.nonGoals" rows="3" /></label>
    </div>
    <template #footer>
      <button @click="closeGoalForm">取消</button>
      <button class="primary" @click="addGoal">添加到 COMETFLOW.md</button>
    </template>
  </ModalCard>

  <!-- 单条目标的就地编辑：改的是 COMETFLOW.md 里对应的 `### Gn` 块，不碰其它段落。 -->
  <ModalCard v-if="editingGoal !== null" :title="'编辑目标 ' + editingGoal.id" wide @close="closeGoalEdit">
    <div class="form-grid">
      <label>标题<input v-model="goalEdit.title" /></label>
      <label>范围<input v-model="goalEdit.scope" placeholder="capability" /></label>
      <label>成功标准（每行一条）<textarea v-model="goalEdit.criteria" rows="3" /></label>
      <label>非目标（每行一条）<textarea v-model="goalEdit.nonGoals" rows="3" /></label>
    </div>
    <template #footer>
      <button @click="editingGoal = null">取消</button>
      <button class="primary" :disabled="savingGoal" @click="saveEdit">
        {{ savingGoal ? '保存中…' : '保存并同步' }}
      </button>
    </template>
  </ModalCard>

  <ModalCard v-if="removingGoal !== null" :title="'删除目标 ' + removingGoal.id" @close="removingGoal = null">
    <p>将从 COMETFLOW.md 中删除下面这个目标块：</p>
    <pre class="mdblock">{{ blockPreview }}</pre>
    <p class="muted">
      只删这一段 markdown，其它目标与段落不动；删除后自动 <code>goal sync</code>。
      已经绑定该目标的计划与 change 不会被改动（它们各自有 spec 绑定）。
    </p>
    <template #footer>
      <button @click="removingGoal = null">取消</button>
      <button class="primary" :disabled="savingGoal" @click="confirmRemove">
        {{ savingGoal ? '删除中…' : '删除并同步' }}
      </button>
    </template>
  </ModalCard>

  <ConfirmDialog
    v-if="pendingClose !== null"
    title="有未保存的改动"
    :message="pendingClose.message"
    confirm-text="放弃改动并关闭"
    @cancel="pendingClose = null"
    @confirm="runPendingClose"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import ModalCard from '../../components/ModalCard.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import { errorMessage } from '../../api/client';
import { refreshCounter, resumeRefresh, suspendRefresh } from '../../composables/useRefresh';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { GoalRecord } from '../../api/types';

const project = useProjectStore();
const toasts = useToastStore();

const TABS = [
  { id: 'mission', label: '项目使命' },
  { id: 'tech', label: '技术栈' },
  { id: 'runtime', label: '运行环境' },
  { id: 'objectives', label: '任务目标' },
  { id: 'projection', label: '目标投影' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const activeTab = ref<TabId>('mission');
const mission = ref('');
const missionDraft = ref('');
const missionEditor = ref(false);
const savingMission = ref(false);
const syncing = ref(false);
const goals = ref<GoalRecord[]>([]);
const goalEditorOpen = ref(false);
const goalForm = reactive({ title: '', scope: '', criteria: '', nonGoals: '' });
/**
 * 打开弹窗时的原文快照：用来判断有没有未保存的改动。
 * 遮罩误点已经不再关闭弹窗，但「取消 / ✕」仍然会关——这里补上提示，避免手滑丢内容。
 */
const missionOriginal = ref('');
const goalFormOriginal = ref('');
const goalEditOriginal = ref('');

/** 非 null 时显示站内的「有未保存改动」确认层。 */
const pendingClose = ref<{ message: string; action: () => void } | null>(null);

/** 关闭前统一提示：有未保存的改动就挂起，等用户在确认层里选。 */
function confirmDiscard(dirty: boolean, what: string, action: () => void): void {
  if (!dirty) {
    action();
    return;
  }
  pendingClose.value = { message: what + '有未保存的改动，关闭后不会保留。', action };
}

/** 用户在确认层里点了「放弃改动并关闭」。 */
function runPendingClose(): void {
  const pending = pendingClose.value;
  pendingClose.value = null;
  pending?.action();
}

function closeGoalForm(): void {
  confirmDiscard(
    goalFormOriginal.value !== '' && JSON.stringify(goalForm) !== goalFormOriginal.value,
    '新建目标',
    () => {
      goalEditorOpen.value = false;
    },
  );
}

/** 打开「添加目标」：每次从空表单开始，并记下快照用于未保存提示。 */
function openGoalForm(): void {
  goalForm.title = '';
  goalForm.scope = '';
  goalForm.criteria = '';
  goalForm.nonGoals = '';
  goalFormOriginal.value = JSON.stringify(goalForm);
  goalEditorOpen.value = true;
}

function closeGoalEdit(): void {
  confirmDiscard(
    goalEditOriginal.value !== '' && JSON.stringify(goalEdit) !== goalEditOriginal.value,
    '目标编辑',
    () => {
      editingGoal.value = null;
    },
  );
}

function parseSections(markdown: string): Record<TabId, string> {
  const out: Record<TabId, string> = { mission: '', tech: '', runtime: '', objectives: '', projection: '' };
  let current: TabId = 'mission';
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## 技术栈')) current = 'tech';
    else if (trimmed.startsWith('## 运行环境')) current = 'runtime';
    else if (trimmed.startsWith('## 任务目标')) current = 'objectives';
    else if (trimmed.startsWith('## ')) current = 'mission';
    out[current] += line + '\n';
  }
  return out;
}

const sections = computed(() => parseSections(mission.value));

/** 编号取「已有目标里最大编号 + 1」，避免用 split 计数时遇到 G10 之类编号错位。 */
const nextGoalNumber = computed(() => {
  let max = 0;
  for (const match of mission.value.matchAll(/^###\s*G(\d+)/gmu)) {
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
});

async function load(): Promise<void> {
  try {
    const [missionData, goalData] = await Promise.all([
      project.projectApi<{ content: string }>('/mission.md'),
      project.projectApi<{ goals: GoalRecord[] }>('/goals'),
    ]);
    mission.value = missionData.content;
    goals.value = goalData.goals;
  } catch (error) {
    toasts.error('加载目标失败', errorMessage(error));
  }
}

function openMissionEditor(): void {
  missionDraft.value = mission.value;
  missionOriginal.value = mission.value;
  missionEditor.value = true;
  suspendRefresh();
}

function closeMissionEditor(): void {
  confirmDiscard(missionDraft.value !== missionOriginal.value, 'COMETFLOW.md', () => {
    missionEditor.value = false;
    resumeRefresh();
  });
}

async function saveMission(alsoSync: boolean): Promise<void> {
  savingMission.value = true;
  try {
    await project.projectApi('/mission.md', { method: 'PUT', body: { content: missionDraft.value } });
    if (alsoSync) {
      await project.projectApi('/context/sync', { method: 'POST' });
      await project.projectApi('/goals/sync', { method: 'POST' });
    }
    closeMissionEditor();
    await load();
    await project.refreshStatus();
    toasts.success(alsoSync ? '已保存并同步' : '已保存 COMETFLOW.md');
  } catch (error) {
    toasts.error('保存失败', errorMessage(error));
  } finally {
    savingMission.value = false;
  }
}

async function addGoal(): Promise<void> {
  const title = goalForm.title.trim();
  if (title === '') {
    toasts.error('请填写目标标题');
    return;
  }
  const bullet = (value: string): string =>
    value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => '  - ' + line).join('\n');
  const scope = goalForm.scope.trim() || 'capability';
  const block =
    '\n### G' + nextGoalNumber.value + '：' + title + '\n' +
    '- 目标：' + title + '\n' +
    '- 范围：' + scope + '\n' +
    '- 成功标准：\n' + (bullet(goalForm.criteria) || '  - 待补充') + '\n' +
    '- 非目标：\n' + (bullet(goalForm.nonGoals) || '  - 无') + '\n';
  try {
    await project.projectApi('/mission.md', { method: 'PUT', body: { content: mission.value + block } });
    await project.projectApi('/goals/sync', { method: 'POST' });
    goalEditorOpen.value = false;
    Object.assign(goalForm, { title: '', scope: '', criteria: '', nonGoals: '' });
    await load();
    toasts.success('已添加并同步目标');
  } catch (error) {
    toasts.error('添加失败', errorMessage(error));
  }
}

async function sync(): Promise<void> {
  syncing.value = true;
  try {
    await project.projectApi('/context/sync', { method: 'POST' });
    await project.projectApi('/goals/sync', { method: 'POST' });
    await load();
    toasts.success('已同步 context 与 goals');
  } catch (error) {
    toasts.error('同步失败', errorMessage(error));
  } finally {
    syncing.value = false;
  }
}

const editingGoal = ref<GoalRecord | null>(null);
const removingGoal = ref<GoalRecord | null>(null);
const savingGoal = ref(false);
const goalEdit = reactive({ title: '', scope: '', criteria: '', nonGoals: '' });

/**
 * 目标块在 COMETFLOW.md 里的范围：从 `### Gn` 到下一个 `### G` / `## ` 标题（或文末）。
 *
 * 用 `\b` 收尾是必要的：否则 `G1` 会匹配到 `G10`。找不到就返回 null——宁可什么都不动，
 * 也不要在定位失败时改错段落（markdown 是唯一事实源）。
 */
function goalBlockRange(markdown: string, id: string): { start: number; end: number } | null {
  const match = new RegExp('^###\\s*' + id + '\\b', 'mu').exec(markdown);
  if (match === null) return null;
  const headingEnd = match.index + match[0].length;
  const nextHeading = /^(?:###\s*G\d+|##\s)/mu.exec(markdown.slice(headingEnd));
  const end = nextHeading === null ? markdown.length : headingEnd + nextHeading.index;
  return { start: match.index, end };
}

function goalsToBullets(value: string, fallback: string): string {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => '  - ' + line)
    .join('\n');
  return lines === '' ? '  - ' + fallback : lines;
}

function goalBlock(id: string, title: string, scope: string, criteria: string, nonGoals: string): string {
  return (
    '### ' + id + '：' + title + '\n' +
    '- 目标：' + title + '\n' +
    '- 范围：' + (scope.trim() || 'capability') + '\n' +
    '- 成功标准：\n' + goalsToBullets(criteria, '待补充') + '\n' +
    '- 非目标：\n' + goalsToBullets(nonGoals, '无') + '\n'
  );
}

const blockPreview = computed(() => {
  const goal = removingGoal.value;
  if (goal === null) return '';
  const range = goalBlockRange(mission.value, goal.id);
  return range === null ? '(未在 COMETFLOW.md 里找到该目标块)' : mission.value.slice(range.start, range.end).trimEnd();
});

function startEdit(goal: GoalRecord): void {
  editingGoal.value = goal;
  goalEdit.title = goal.title;
  goalEdit.scope = goal.scope.join(', ');
  goalEdit.criteria = goal.success_criteria.join('\n');
  goalEdit.nonGoals = goal.non_goals.join('\n');
  // 快照要在填完之后取：否则 fields 一填，就会被当成「有未保存改动」。
  goalEditOriginal.value = JSON.stringify(goalEdit);
}

function startRemove(goal: GoalRecord): void {
  removingGoal.value = goal;
}

/** 就地替换目标块：写入后立刻 sync，让投影跟上（否则界面会显示旧目标）。 */
async function saveEdit(): Promise<void> {
  const goal = editingGoal.value;
  if (goal === null) return;
  if (goalEdit.title.trim() === '') {
    toasts.error('标题不能为空');
    return;
  }
  const range = goalBlockRange(mission.value, goal.id);
  if (range === null) {
    toasts.error('定位失败', 'COMETFLOW.md 里没有找到 ' + goal.id + ' 的目标块，未做任何修改');
    return;
  }
  const next =
    mission.value.slice(0, range.start) +
    goalBlock(goal.id, goalEdit.title.trim(), goalEdit.scope, goalEdit.criteria, goalEdit.nonGoals) +
    mission.value.slice(range.end);
  savingGoal.value = true;
  try {
    await project.projectApi('/mission.md', { method: 'PUT', body: { content: next } });
    await project.projectApi('/goals/sync', { method: 'POST' });
    editingGoal.value = null;
    await load();
    toasts.success('已保存并同步', goal.id);
  } catch (error) {
    toasts.error('保存失败', errorMessage(error));
  } finally {
    savingGoal.value = false;
  }
}

async function confirmRemove(): Promise<void> {
  const goal = removingGoal.value;
  if (goal === null) return;
  const range = goalBlockRange(mission.value, goal.id);
  if (range === null) {
    toasts.error('定位失败', 'COMETFLOW.md 里没有找到 ' + goal.id + ' 的目标块，未做任何修改');
    return;
  }
  // 连同块前的空行一起删掉，避免留下连续空行。
  const start = mission.value.slice(0, range.start).replace(/\n+$/u, '\n');
  const next = start + mission.value.slice(range.end).replace(/^\n+/u, '');
  savingGoal.value = true;
  try {
    await project.projectApi('/mission.md', { method: 'PUT', body: { content: next } });
    await project.projectApi('/goals/sync', { method: 'POST' });
    removingGoal.value = null;
    await load();
    toasts.success('已删除并同步', goal.id);
  } catch (error) {
    toasts.error('删除失败', errorMessage(error));
  } finally {
    savingGoal.value = false;
  }
}

onMounted(load);
watch(() => refreshCounter('goals'), () => {
  if (!missionEditor.value) void load();
});
</script>
