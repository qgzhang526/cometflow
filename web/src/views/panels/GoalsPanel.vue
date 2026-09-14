<template>
  <div class="card">
    <div class="toolbar">
      <button class="primary" @click="openMissionEditor">COMETFLOW.md</button>
      <button @click="goalEditorOpen = true">＋ 添加目标</button>
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
          </tr>
          <tr v-if="goals.length === 0">
            <td colspan="5" class="muted">暂无目标，点击「＋ 添加目标」或编辑 COMETFLOW.md 后同步</td>
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

  <ModalCard v-if="goalEditorOpen" :title="'添加目标 G' + nextGoalNumber" wide @close="goalEditorOpen = false">
    <div class="form-grid">
      <label>目标标题 <input v-model="goalForm.title" placeholder="一句话描述该目标" /></label>
      <label>范围 capability <input v-model="goalForm.scope" placeholder="auth" /></label>
      <label>成功标准（每行一条）<textarea v-model="goalForm.criteria" rows="4" /></label>
      <label>非目标（每行一条，可空）<textarea v-model="goalForm.nonGoals" rows="3" /></label>
    </div>
    <template #footer>
      <button @click="goalEditorOpen = false">取消</button>
      <button class="primary" @click="addGoal">添加到 COMETFLOW.md</button>
    </template>
  </ModalCard>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import ModalCard from '../../components/ModalCard.vue';
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
  missionEditor.value = true;
  suspendRefresh();
}

function closeMissionEditor(): void {
  missionEditor.value = false;
  resumeRefresh();
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

onMounted(load);
watch(() => refreshCounter('goals'), () => {
  if (!missionEditor.value) void load();
});
</script>
