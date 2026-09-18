<template>
  <div>
    <div class="toolbar">
      <input v-model="newSpecPath" placeholder="specs/<cap>/spec.md 或 specs/flows/<name>.md" style="width: 360px" />
      <button class="primary" :disabled="busy" @click="create">+ 新建文件</button>
      <span class="grow" />
      <span class="muted">{{ specs.length }} 个文件</span>
    </div>
    <table>
      <thead><tr><th>路径</th><th>kind</th><th>状态</th><th /></tr></thead>
      <tbody>
        <tr v-for="entry in orderedSpecs" :key="entry.path">
          <td>
            <b>{{ entry.path }}</b>
            <!-- 从问题清单跳过来时指名的那一份：先摆到最前，免得在一堆 spec 里自己找。 -->
            <span v-if="entry.path === focus" class="badge err" style="margin-left: 6px">问题清单指向</span>
          </td>
          <td>{{ entry.kind }}</td>
          <td>
            <StatusBadge
              :tone="entry.status === 'draft' ? 'warn' : 'ok'"
              :text="entry.status === 'draft' ? '草案' : '已定稿'"
            />
          </td>
          <td>
            <button class="ghost" @click="emit('open', entry.path)">编辑</button>
            <button class="ghost" @click="emit('versions', entry.path)">版本</button>
            <button
              v-if="entry.status === 'draft'"
              class="ghost"
              :disabled="busy"
              title="草案不能参与 plan freeze；确认内容无误后批准"
              @click="approve(entry.path)"
            >
              批准定稿
            </button>
          </td>
        </tr>
        <tr v-if="specs.length === 0"><td colspan="4" class="muted">specs/ 目录为空，先在上方向导里生成骨架</td></tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import StatusBadge from '../../../components/StatusBadge.vue';
import type { SpecEntry } from '../../../api/types';

const emit = defineEmits<{ open: [path: string]; versions: [path: string] }>();

/** 问题清单指向的那份 spec（空 = 没指定）：排最前并加标记。 */
const props = defineProps<{ focus?: string }>();

const project = useProjectStore();
const toasts = useToastStore();
const specs = ref<SpecEntry[]>([]);
const newSpecPath = ref('');
const busy = ref(false);

const orderedSpecs = computed(() => {
  const focus = props.focus;
  if (focus === undefined || focus === '') return specs.value;
  const hit = specs.value.find((entry) => entry.path === focus);
  if (hit === undefined) return specs.value;
  return [hit, ...specs.value.filter((entry) => entry.path !== focus)];
});

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

/**
 * 批准定稿（G1）：脚手架骨架 / 表格导入 / Agent 起草的 spec 都是草案，
 * 草案不能参与 `plan freeze`——这里是那个「人点头」的入口。
 */
async function approve(path: string): Promise<void> {
  if (!window.confirm('把 ' + path + ' 标记为已定稿？\n\n它随后可以被 plan freeze 绑定为契约。')) return;
  busy.value = true;
  try {
    const data = await project.projectApi<{ changed: boolean; spec_version: number | null }>('/spec/approve', {
      method: 'POST',
      body: { path },
    });
    await load();
    await project.refreshStatus();
    toasts.success(
      data.changed ? '已定稿' : '无需改动',
      data.changed ? path + '（版本 v' + (data.spec_version ?? '?') + '）' : path + ' 已经是 approved',
    );
  } catch (error) {
    toasts.error('批准失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
watch(() => refreshCounter('specs'), () => void load());
</script>
