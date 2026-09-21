<template>
  <div>
    <p class="muted">
      12-kind 由项目类型裁剪而来：present 是已生成的骨架（骨架落盘时是草案，要在「Spec 文件」页签批准定稿），
      deferred 表示「需要时再补」，absent 表示本项目不需要。
    </p>
    <table>
      <thead><tr><th>kind</th><th>状态</th><th>原因</th></tr></thead>
      <tbody>
        <tr v-for="(entry, kind) in manifest?.kinds ?? {}" :key="kind">
          <td><b>{{ kind }}</b></td>
          <td>
            <StatusBadge
              :tone="entry.status === 'present' ? 'ok' : entry.status === 'deferred' ? 'warn' : 'gray'"
              :text="entry.status"
            />
          </td>
          <td class="muted">{{ entry.reason }}</td>
        </tr>
        <tr v-if="Object.keys(manifest?.kinds ?? {}).length === 0"><td colspan="3" class="muted">还没有 init-manifest</td></tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import StatusBadge from '../../../components/StatusBadge.vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type { InitManifest } from '../../../api/types';

const project = useProjectStore();
const toasts = useToastStore();
const manifest = ref<InitManifest | null>(null);

async function load(): Promise<void> {
  try {
    manifest.value = await project.projectApi<InitManifest>('/init-manifest');
  } catch (error) {
    toasts.error('读取 kind 状态失败', errorMessage(error));
  }
}

onMounted(load);
watch(() => refreshCounter('specs'), () => void load());
</script>
