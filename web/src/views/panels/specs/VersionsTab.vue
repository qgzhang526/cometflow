<template>
  <div>
    <div class="row">
      <p class="muted" style="margin: 0">
        版本仓在 <code>.cometflow-history/</code>：每次 spec lock、plan freeze、change archive 与 UI 编辑都会登记一版。
        历史版本可以随时回放，必要时一键恢复正文。
      </p>
      <span class="grow" />
      <button class="ghost" @click="load">刷新</button>
    </div>

    <p v-if="specPaths.length === 0" class="empty">还没有登记过版本：先运行一次「建立基线」，或编辑一份 spec。</p>

    <div v-for="specPath in specPaths" :key="specPath" class="version-group">
      <div class="row">
        <b>{{ specPath }}</b>
        <StatusBadge tone="gray" :text="versions(specPath).length + ' 版'" />
        <span class="grow" />
        <span class="muted">最新 v{{ versions(specPath)[versions(specPath).length - 1]?.spec_version }}</span>
      </div>
      <table>
        <thead><tr><th>版本</th><th>hash</th><th>登记时间</th><th>来源</th><th /></tr></thead>
        <tbody>
          <tr v-for="record in [...versions(specPath)].reverse()" :key="record.hash + record.spec_version">
            <td><b>v{{ record.spec_version }}</b></td>
            <td><code>{{ shortHash(record.hash) }}</code></td>
            <td class="muted">{{ relativeTime(record.recorded_at) }}</td>
            <td class="muted">{{ record.change ? 'change ' + record.change : record.note ?? '—' }}</td>
            <td>
              <button class="ghost" @click="preview(specPath, record)">查看</button>
              <button class="ghost" @click="askRestore(specPath, record)">恢复</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ModalCard
      v-if="previewing"
      :title="previewing.path + ' @v' + previewing.record.spec_version"
      wide
      @close="previewing = null"
    >
      <p class="muted">
        hash {{ previewing.record.hash }} · 登记于 {{ previewing.record.recorded_at }}
        <template v-if="previewing.record.change"> · change {{ previewing.record.change }}</template>
        <template v-if="previewing.record.note"> · {{ previewing.record.note }}</template>
      </p>
      <pre class="mdblock">{{ previewing.content }}</pre>
      <template #footer>
        <button @click="previewing = null">关闭</button>
        <button class="primary" @click="askRestore(previewing.path, previewing.record)">恢复此版本</button>
      </template>
    </ModalCard>

    <ModalCard v-if="confirming" title="恢复历史版本" @close="confirming = null">
      <p>
        用 <b>{{ confirming.path }}</b> 的 <b>v{{ confirming.record.spec_version }}</b> 覆盖当前正文？
      </p>
      <p class="muted">
        当前内容会先被登记为一版（pre-restore snapshot），之后仍可从本页回放，因此这次覆盖是可逆的。
      </p>
      <template #footer>
        <button @click="confirming = null">取消</button>
        <button class="primary" :disabled="restoring" @click="confirmRestore">确认恢复</button>
      </template>
    </ModalCard>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import ModalCard from '../../../components/ModalCard.vue';
import StatusBadge from '../../../components/StatusBadge.vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type { SpecHistoryResponse, SpecRestoreResult, SpecVersionContent, SpecVersionRecord } from '../../../api/types';
import { relativeTime, shortHash } from '../../../utils/format';

const project = useProjectStore();
const toasts = useToastStore();
const history = ref<SpecHistoryResponse | null>(null);
const previewing = ref<SpecVersionContent | null>(null);
const confirming = ref<{ path: string; record: SpecVersionRecord } | null>(null);
const restoring = ref(false);
const focusPath = ref('');

const specPaths = computed(() => {
  const paths = Object.keys(history.value?.specs ?? {}).sort();
  return focusPath.value === '' ? paths : paths.filter((entry) => entry === focusPath.value);
});

function versions(specPath: string): SpecVersionRecord[] {
  return history.value?.specs[specPath] ?? [];
}

async function load(): Promise<void> {
  try {
    history.value = await project.projectApi<SpecHistoryResponse>('/spec/versions');
  } catch (error) {
    toasts.error('读取版本历史失败', errorMessage(error));
  }
}

async function preview(specPath: string, record: SpecVersionRecord): Promise<void> {
  try {
    previewing.value = await project.projectApi<SpecVersionContent>('/spec/version', {
      query: { ref: specPath + '@' + record.spec_version },
    });
  } catch (error) {
    toasts.error('读取版本内容失败', errorMessage(error));
  }
}

/** 恢复会改写 canonical spec，因此用应用内确认弹窗而不是浏览器 confirm（也更可测）。 */
function askRestore(specPath: string, record: SpecVersionRecord): void {
  previewing.value = null;
  confirming.value = { path: specPath, record };
}

async function confirmRestore(): Promise<void> {
  const target = confirming.value;
  if (target === null) return;
  restoring.value = true;
  try {
    const result = await project.projectApi<SpecRestoreResult>('/spec/restore', {
      method: 'POST',
      body: { ref: target.path + '@' + target.record.spec_version },
    });
    confirming.value = null;
    await load();
    toasts.success('已恢复', result.path + ' → v' + (result.spec_version ?? result.restoredFrom));
  } catch (error) {
    toasts.error('恢复失败', errorMessage(error));
  } finally {
    restoring.value = false;
  }
}

/** 从文件页签跳转过来时只看这一份 spec。 */
function focus(specPath: string): void {
  focusPath.value = specPath;
}

onMounted(load);
watch(() => refreshCounter('specs'), () => void load());
defineExpose({ focus });
</script>

<style scoped>
.version-group { margin-top: 16px; }
.version-group table { margin-top: 6px; }
</style>
