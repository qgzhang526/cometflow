<template>
  <ModalCard title="选择目录" @close="emit('close')">
    <div class="breadcrumb">
      <button data-root @click="goRoot">此电脑</button>
      <button data-up :disabled="parent === null" @click="goUp">↑ 上一级</button>
      <span class="muted">当前：{{ resolvedPath || '此电脑' }}</span>
    </div>
    <div class="dir-list">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="error" class="empty">{{ error }}</div>
      <template v-else>
        <div v-for="entry in entries" :key="entry.path" class="dir-item" @click="enter(entry.path)">
          <span class="folder">📁</span><span>{{ entry.name }}</span>
        </div>
        <div v-if="entries.length === 0" class="empty">此目录为空</div>
      </template>
    </div>
    <template #footer>
      <button @click="emit('close')">取消</button>
      <button class="primary" :disabled="resolvedPath === ''" @click="emit('select', resolvedPath)">选择此目录</button>
    </template>
  </ModalCard>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import type { FsListing } from '../api/types';
import ModalCard from './ModalCard.vue';

const props = defineProps<{ initialPath?: string }>();
const emit = defineEmits<{ select: [path: string]; close: [] }>();

const current = ref(props.initialPath ?? '');
const resolvedPath = ref('');
const parent = ref<string | null>(null);
const entries = ref<FsListing['entries']>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function browse(target: string): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const data = await api<FsListing>('/fs/list', { query: { path: target } });
    resolvedPath.value = data.path;
    parent.value = data.parent;
    entries.value = data.entries;
  } catch (caught) {
    error.value = errorMessage(caught);
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

function enter(path: string): void {
  current.value = path;
  void browse(path);
}

function goRoot(): void {
  current.value = '';
  void browse('');
}

function goUp(): void {
  if (parent.value === null) return;
  enter(parent.value);
}

watch(current, (value) => void browse(value), { immediate: true });
</script>
