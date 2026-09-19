<template>
  <div class="card">
    <div class="tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        class="tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <KindsTab v-if="activeTab === 'kinds'" />
    <ScaffoldTab v-else-if="activeTab === 'scaffold'" @open="openSpec" />
    <FilesTab v-else-if="activeTab === 'files'" :focus="focusPath" @open="openSpec" @versions="showVersions" />
    <ChecksTab v-else-if="activeTab === 'checks'" />
    <VersionsTab v-else-if="activeTab === 'versions'" ref="versionsTab" />
    <SpecGraphTab v-else-if="activeTab === 'graph'" @open="openSpec" />
    <ImportTab v-else-if="activeTab === 'import'" />
    <IntegrityTab v-else :focus="focusPath" />
  </div>

  <ModalCard v-if="editing !== null" :title="editingPath" wide @close="closeEditor">
    <div v-if="proposals.length > 0" class="finding warning">
      当前有提案版本：<b>{{ proposals.map((entry) => entry.change).join(', ') }}</b>
      —— 提案不改 canonical spec，归档时才会应用。
      <button class="ghost" @click="diffAgainstProposal">与提案对比</button>
    </div>
    <SpecEditor v-model="editing" />
    <p class="muted">
      保存会登记一次 canonical spec 变更并刷新 lock（等价于 CLI 的 spec lock）。
      改动前想先看影响，可以切到「影响与门禁」用 <code>spec diff --impact</code> 预演。
    </p>
    <div class="toolbar">
      <button :disabled="busy" @click="previewChanges">预览变更（相对当前版本）</button>
      <button :disabled="busy" @click="undoToPrevious">撤销到上一版</button>
      <select v-model="proposalChange" :disabled="shapeChanges.length === 0">
        <option value="">{{ shapeChanges.length === 0 ? '没有 shape 阶段的 change' : '存为提案到…' }}</option>
        <option v-for="change in shapeChanges" :key="change" :value="change">{{ change }}</option>
      </select>
      <button :disabled="busy || proposalChange === ''" @click="saveProposal">存为提案</button>
    </div>
    <div v-if="diff" class="diff-view">
      <div class="row">
        <StatusBadge tone="brand" :text="'+' + diffSummary.added + ' / -' + diffSummary.removed" />
        <span class="muted">{{ diffLabel }}</span>
        <span class="grow" />
        <button class="ghost" @click="diff = null">收起</button>
      </div>
      <pre class="diff-body"><span
        v-for="(line, index) in diff"
        :key="index"
        :class="'diff-' + line.kind"
      >{{ (line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  ') + line.text + '\n' }}</span></pre>
    </div>
    <template #footer>
      <button @click="closeEditor">关闭</button>
      <button class="primary" :disabled="saving" @click="saveSpec">保存</button>
    </template>
  </ModalCard>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import ModalCard from '../../components/ModalCard.vue';
import { errorMessage } from '../../api/client';
import { resumeRefresh, suspendRefresh } from '../../composables/useRefresh';
import { useNavigationStore } from '../../stores/navigation';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { PanelTarget } from '../../utils/finding-targets';
import KindsTab from './specs/KindsTab.vue';
import ScaffoldTab from './specs/ScaffoldTab.vue';
import FilesTab from './specs/FilesTab.vue';
import ChecksTab from './specs/ChecksTab.vue';
import VersionsTab from './specs/VersionsTab.vue';
import SpecGraphTab from './specs/SpecGraphTab.vue';
import SpecEditor from './specs/SpecEditor.vue';
import IntegrityTab from './specs/IntegrityTab.vue';
import ImportTab from './specs/ImportTab.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { lineDiff, summarizeDiff, type DiffLine } from '../../utils/diff';
import type { ChangeState, SpecProposal, SpecProposalsResponse, SpecVersionContent, SpecVersionRecord } from '../../api/types';

const TABS = [
  { id: 'kinds', label: '12-kind 状态' },
  { id: 'scaffold', label: '脚手架' },
  { id: 'files', label: 'Spec 文件' },
  { id: 'checks', label: '验收覆盖' },
  { id: 'versions', label: '版本' },
    { id: 'graph', label: '引用图' },
    { id: 'integrity', label: '影响与门禁' },
    { id: 'import', label: '导入' },
] as const;

const project = useProjectStore();
const toasts = useToastStore();
const navigation = useNavigationStore();

const activeTab = ref<(typeof TABS)[number]['id']>('kinds');
/** 问题清单指向的那份 spec：影响与门禁 / 版本页签用它把那条挑出来。 */
const focusPath = ref('');
const editingPath = ref('');
const editing = ref<string | null>(null);
const saving = ref(false);
const versionsTab = ref<{ focus: (specPath: string) => void } | null>(null);
const pendingFocus = ref<string | null>(null);
const busy = ref(false);
const diff = ref<DiffLine[] | null>(null);
const diffLabel = ref('');
const proposals = ref<SpecProposal[]>([]);
const shapeChanges = ref<string[]>([]);
const proposalChange = ref('');
const diffSummary = computed(() => summarizeDiff(diff.value ?? []));

async function openSpec(specPath: string): Promise<void> {
  try {
    const data = await project.projectApi<{ content: string }>('/specs/content', { query: { path: specPath } });
    editingPath.value = specPath;
    editing.value = data.content;
    diff.value = null;
    suspendRefresh();
    void loadProposals(specPath);
  } catch (error) {
    toasts.error('打开失败', errorMessage(error));
  }
}

/** 反查该 spec 是否已有提案，并准备「存为提案」的 change 候选。 */
async function loadProposals(specPath: string): Promise<void> {
  try {
    const [proposalData, changeData] = await Promise.all([
      project.projectApi<SpecProposalsResponse>('/spec/proposals', { query: { path: specPath } }),
      project.projectApi<{ changes: ChangeState[] }>('/changes'),
    ]);
    proposals.value = proposalData.proposals;
    shapeChanges.value = changeData.changes
      .filter((change) => !change.archived && change.phase === 'shape')
      .map((change) => change.name);
    if (proposalChange.value === '' && shapeChanges.value.length > 0) proposalChange.value = shapeChanges.value[0];
  } catch {
    proposals.value = [];
    shapeChanges.value = [];
  }
}

async function latestVersionContent(specPath: string): Promise<{ content: string; record: SpecVersionRecord } | null> {
  const history = await project.projectApi<{ specs: Record<string, SpecVersionRecord[]> }>('/spec/versions', {
    query: { path: specPath },
  });
  const versions = history.specs[specPath] ?? [];
  const latest = versions[versions.length - 1];
  if (latest === undefined) return null;
  const version = await project.projectApi<SpecVersionContent>('/spec/version', {
    query: { ref: specPath + '@' + latest.spec_version },
  });
  return { content: version.content, record: latest };
}

async function previewChanges(): Promise<void> {
  if (editing.value === null) return;
  busy.value = true;
  try {
    const latest = await latestVersionContent(editingPath.value);
    if (latest === null) {
      toasts.error('没有可对比的版本', '该 spec 还没有登记过版本，先建立基线（spec lock）');
      return;
    }
    diff.value = lineDiff(latest.content, editing.value);
    diffLabel.value = '相对 v' + latest.record.spec_version;
  } catch (error) {
    toasts.error('预览失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

function diffAgainstProposal(): void {
  const proposal = proposals.value[0];
  if (proposal?.content === undefined || editing.value === null) {
    toasts.info('提案正文不可用', '刷新后再试');
    return;
  }
  diff.value = lineDiff(editing.value, proposal.content);
  diffLabel.value = '当前草稿 → 提案（change ' + proposal.change + '）';
}

/** 撤销到上一版：复用 ADR 0012 的版本仓（等价 spec restore）。 */
async function undoToPrevious(): Promise<void> {
  busy.value = true;
  try {
    const history = await project.projectApi<{ specs: Record<string, SpecVersionRecord[]> }>('/spec/versions', {
      query: { path: editingPath.value },
    });
    const versions = history.specs[editingPath.value] ?? [];
    const previous = versions[versions.length - 2];
    if (previous === undefined) {
      toasts.error('没有上一版', '该 spec 只有一个版本');
      return;
    }
    const restored = await project.projectApi<{ spec_version: number | null }>('/spec/restore', {
      method: 'POST',
      body: { ref: editingPath.value + '@' + previous.spec_version },
    });
    const data = await project.projectApi<{ content: string }>('/specs/content', { query: { path: editingPath.value } });
    editing.value = data.content;
    diff.value = null;
    toasts.success('已撤销到 v' + previous.spec_version, '当前内容已登记为 v' + (restored.spec_version ?? '?'));
  } catch (error) {
    toasts.error('撤销失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function saveProposal(): Promise<void> {
  if (editing.value === null || proposalChange.value === '') return;
  busy.value = true;
  try {
    await project.projectApi('/spec/proposal', {
      method: 'POST',
      body: { change: proposalChange.value, path: editingPath.value, content: editing.value },
    });
    toasts.success('已存为提案', '不改 canonical spec，归档 change ' + proposalChange.value + ' 时才应用');
    await loadProposals(editingPath.value);
  } catch (error) {
    toasts.error('存提案失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

function closeEditor(): void {
  editing.value = null;
  resumeRefresh();
}

async function saveSpec(): Promise<void> {
  if (editing.value === null) return;
  saving.value = true;
  try {
    await project.projectApi('/specs/content', {
      method: 'PUT',
      query: { path: editingPath.value },
      body: { content: editing.value },
    });
    toasts.success('spec 已保存', editingPath.value + ' 已登记新版本');
    closeEditor();
  } catch (error) {
    toasts.error('保存失败', errorMessage(error));
  } finally {
    saving.value = false;
  }
}

/** 从「Spec 文件」跳到「版本」并锁定这一份 spec。 */
function showVersions(specPath: string): void {
  pendingFocus.value = specPath;
  activeTab.value = 'versions';
}

watch(activeTab, async (tab) => {
  if (tab !== 'versions') return;
  // 等版本页挂载后再套用过滤：从文件页跳过来时只看那一份，手动切页时清空过滤。
  await nextTick();
  versionsTab.value?.focus(pendingFocus.value ?? '');
  pendingFocus.value = null;
});

/**
 * 应用一次「带着意图的跳转」（问题清单的「去处理」）。
 *
 * 页签 id 由这里校验：映射表写错时静默忽略，绝不跳到一个不存在的页签。
 * `focusPath` 交给「影响与门禁」把那条差异挑出来——用户不用在列表里自己找。
 */
function applyTarget(target: PanelTarget): void {
  focusPath.value = target.subject ?? '';
  const tab = TABS.find((entry) => entry.id === target.tab);
  if (tab === undefined) return;
  if (tab.id === 'versions') {
    // 版本页签已有过滤机制（文件页签的「版本」按钮走的就是它）。
    showVersions(focusPath.value);
    return;
  }
  activeTab.value = tab.id;
}

const firstTarget = navigation.consume('specs');
if (firstTarget !== null) applyTarget(firstTarget);
watch(
  () => navigation.pending,
  (value) => {
    if (value === null || value.panel !== 'specs') return;
    const target = navigation.consume('specs');
    if (target !== null) applyTarget(target);
  },
);
</script>
