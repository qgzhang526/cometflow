<template>
  <div>
    <div class="row">
      <StatusBadge :tone="coverage && coverage.unchecked === 0 ? 'ok' : 'warn'" :text="'未覆盖 ' + (coverage?.unchecked ?? 0)" />
      <span class="muted">验收项 {{ coverage?.total ?? 0 }} · 可执行 check {{ coverage?.checked ?? 0 }}</span>
      <span class="grow" />
      <label class="muted"><input v-model="onlyUncovered" type="checkbox" /> 只看未覆盖</label>
      <button class="ghost" @click="load">刷新</button>
    </div>
    <p class="muted">
      验收项必须可执行（ADR 0013）。没有 check 的项只能靠独立 Verifier 或人工判定——
      在 spec 的验收项下加一行 <code>- check: &lt;command&gt;</code> 即可纳入自动判定。
    </p>

    <div v-for="group in groups" :key="group.path + '#' + group.anchor" class="check-group">
      <div class="row">
        <b>{{ group.path }}#{{ group.anchor }}</b>
        <span class="grow" />
        <span class="muted">{{ group.items.length }} 项</span>
      </div>
      <table>
        <thead><tr><th>acceptance</th><th>内容</th><th>可执行 check</th></tr></thead>
        <tbody>
          <tr v-for="item in group.items" :key="item.id">
            <td><b>{{ item.id }}</b></td>
            <td>{{ item.text }}</td>
            <td>
              <code v-if="item.check">{{ item.check }}</code>
              <StatusBadge v-else tone="warn" text="未声明 check" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="groups.length === 0" class="empty">
      {{ onlyUncovered ? '所有验收项都有可执行 check。' : '还没有验收项：spec 里写「## Acceptance」并列出条目。' }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import StatusBadge from '../../../components/StatusBadge.vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type { AcceptanceCheckCoverage } from '../../../api/types';

const project = useProjectStore();
const toasts = useToastStore();
const coverage = ref<AcceptanceCheckCoverage | null>(null);
const onlyUncovered = ref(false);

const groups = computed(() => {
  const anchors = coverage.value?.anchors ?? [];
  return anchors
    .map((entry) => ({
      path: entry.path,
      anchor: entry.anchor,
      items: onlyUncovered.value ? entry.acceptance.filter((item) => !item.check) : entry.acceptance,
    }))
    .filter((group) => group.items.length > 0);
});

async function load(): Promise<void> {
  try {
    coverage.value = await project.projectApi<AcceptanceCheckCoverage>('/spec/checks');
  } catch (error) {
    toasts.error('读取验收覆盖失败', errorMessage(error));
  }
}

onMounted(load);
watch(() => refreshCounter('specs'), () => void load());
</script>

<style scoped>
.check-group { margin-top: 14px; }
.check-group table { margin-top: 6px; }
</style>
