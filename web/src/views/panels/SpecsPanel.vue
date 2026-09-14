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
    <ScaffoldTab v-else-if="activeTab === 'scaffold'" />
    <FilesTab v-else-if="activeTab === 'files'" @open="openSpec" @versions="showVersions" />
    <ChecksTab v-else-if="activeTab === 'checks'" />
    <VersionsTab v-else-if="activeTab === 'versions'" ref="versionsTab" />
    <SpecGraphTab v-else-if="activeTab === 'graph'" @open="openSpec" />
    <IntegrityTab v-else />
  </div>

  <ModalCard v-if="editing !== null" :title="editingPath" wide @close="closeEditor">
    <SpecEditor v-model="editing" />
    <p class="muted">
      保存会登记一次 canonical spec 变更并刷新 lock（等价于 CLI 的 spec lock）。
      改动前想先看影响，可以切到「影响与门禁」用 <code>spec diff --impact</code> 预演。
    </p>
    <template #footer>
      <button @click="closeEditor">关闭</button>
      <button class="primary" :disabled="saving" @click="saveSpec">保存</button>
    </template>
  </ModalCard>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import ModalCard from '../../components/ModalCard.vue';
import { errorMessage } from '../../api/client';
import { resumeRefresh, suspendRefresh } from '../../composables/useRefresh';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import KindsTab from './specs/KindsTab.vue';
import ScaffoldTab from './specs/ScaffoldTab.vue';
import FilesTab from './specs/FilesTab.vue';
import ChecksTab from './specs/ChecksTab.vue';
import VersionsTab from './specs/VersionsTab.vue';
import SpecGraphTab from './specs/SpecGraphTab.vue';
import SpecEditor from './specs/SpecEditor.vue';
import IntegrityTab from './specs/IntegrityTab.vue';

const TABS = [
  { id: 'kinds', label: '12-kind 状态' },
  { id: 'scaffold', label: '脚手架' },
  { id: 'files', label: 'Spec 文件' },
  { id: 'checks', label: '验收覆盖' },
  { id: 'versions', label: '版本' },
  { id: 'graph', label: '引用图' },
  { id: 'integrity', label: '影响与门禁' },
] as const;

const project = useProjectStore();
const toasts = useToastStore();

const activeTab = ref<(typeof TABS)[number]['id']>('kinds');
const editingPath = ref('');
const editing = ref<string | null>(null);
const saving = ref(false);
const versionsTab = ref<{ focus: (specPath: string) => void } | null>(null);
const pendingFocus = ref<string | null>(null);

async function openSpec(specPath: string): Promise<void> {
  try {
    const data = await project.projectApi<{ content: string }>('/specs/content', { query: { path: specPath } });
    editingPath.value = specPath;
    editing.value = data.content;
    suspendRefresh();
  } catch (error) {
    toasts.error('打开失败', errorMessage(error));
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
</script>
