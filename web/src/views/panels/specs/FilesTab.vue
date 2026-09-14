<template>
  <div>
    <div class="toolbar">
      <input v-model="newSpecPath" placeholder="specs/<cap>/spec.md 或 specs/flows/<name>.md" style="width: 360px" />
      <button class="primary" :disabled="busy" @click="create">+ 新建文件</button>
      <span class="grow" />
      <span class="muted">{{ specs.length }} 个文件</span>
    </div>
    <table>
      <thead><tr><th>路径</th><th>kind</th><th /></tr></thead>
      <tbody>
        <tr v-for="entry in specs" :key="entry.path">
          <td><b>{{ entry.path }}</b></td>
          <td>{{ entry.kind }}</td>
          <td>
            <button class="ghost" @click="emit('open', entry.path)">编辑</button>
            <button class="ghost" @click="emit('versions', entry.path)">版本</button>
          </td>
        </tr>
        <tr v-if="specs.length === 0"><td colspan="3" class="muted">specs/ 目录为空，先在上方向导里生成骨架</td></tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type { SpecEntry } from '../../../api/types';

const emit = defineEmits<{ open: [path: string]; versions: [path: string] }>();

const project = useProjectStore();
const toasts = useToastStore();
const specs = ref<SpecEntry[]>([]);
const newSpecPath = ref('');
const busy = ref(false);

async function load(): Promise<void> {
  try {
    const data = await project.projectApi<{ entries: SpecEntry[] }>('/specs');
    specs.value = data.entries;
  } catch (error) {
    toasts.error('读取 spec 列表失败', errorMessage(error));
  }
}

async function create(): Promise<void> {
  const rel = newSpecPath.value.trim();
  if (rel === '') {
    toasts.error('请输入文件路径', '例如 specs/engine/spec.md 或 specs/flows/build-facility.md');
    return;
  }
  busy.value = true;
  try {
    await project.projectApi('/specs', { method: 'POST', body: { path: rel, content: '' } });
    newSpecPath.value = '';
    await load();
    emit('open', rel);
  } catch (error) {
    toasts.error('新建失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
watch(() => refreshCounter('specs'), () => void load());
</script>
