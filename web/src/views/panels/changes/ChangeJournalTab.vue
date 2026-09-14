<template>
  <div>
    <div class="row">
      <span class="muted">{{ events.length }} 条事件（新→旧）</span>
      <span class="grow" />
      <button class="ghost" @click="load">刷新</button>
    </div>

    <p v-if="events.length === 0" class="empty">
      还没有流水记录。创建 change、阶段迁移、运行 Builder、验收与归档都会在这里留痕（含崩溃后的收敛记录）。
    </p>

    <div v-for="(event, index) in ordered" :key="event.at + index" class="journal-row">
      <div class="row">
        <StatusBadge :tone="toneFor(event)" :text="event.event" />
        <span v-if="event.phase" class="muted">phase {{ event.phase }}</span>
        <span class="grow" />
        <span class="muted" :title="event.at">{{ relativeTime(event.at) }}</span>
      </div>
      <pre v-if="event.data && Object.keys(event.data).length > 0" class="journal-data">{{ jsonPreview(event.data) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import StatusBadge from '../../../components/StatusBadge.vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type { ChangeJournalEvent } from '../../../api/types';
import { jsonPreview, relativeTime } from '../../../utils/format';

const props = defineProps<{ change: string }>();

const project = useProjectStore();
const toasts = useToastStore();
const events = ref<ChangeJournalEvent[]>([]);

const ordered = computed(() => [...events.value].reverse());

function toneFor(event: ChangeJournalEvent): 'ok' | 'warn' | 'err' | 'gray' | 'brand' {
  if (event.event === 'verify-result') return event.data?.passed === true ? 'ok' : 'err';
  if (event.event === 'archive-completed' || event.event === 'spec-applied') return 'ok';
  if (event.event === 'archive-rolled-back' || event.event === 'journal-rotated') return 'warn';
  if (event.event === 'rebase' || event.event === 'unblocked') return 'brand';
  if (event.event === 'git-drift-overridden') return 'warn';
  return 'gray';
}

async function load(): Promise<void> {
  try {
    const data = await project.projectApi<{ events: ChangeJournalEvent[] }>(
      '/changes/' + encodeURIComponent(props.change) + '/journal',
    );
    events.value = data.events;
  } catch (error) {
    toasts.error('读取流水失败', errorMessage(error));
  }
}

onMounted(load);
watch(() => props.change, () => void load());
watch(() => refreshCounter('changes'), () => void load());
</script>

<style scoped>
.journal-row { border-bottom: 1px solid var(--border); padding: 8px 0; }
.journal-row:last-child { border-bottom: none; }
.journal-data { background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; margin: 6px 0 0; font-size: 12px; overflow: auto; }
</style>
