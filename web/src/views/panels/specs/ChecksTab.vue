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

    <h3>全部锚点（含没有被验收项覆盖的）</h3>
    <p class="muted">
      与 <code>cometflow spec anchors</code> 同一份投影。这里回答上面看不到的两个问题：
      哪些锚点<strong>没有</strong>验收项，以及哪些锚点<strong>没有被冻结任务绑定</strong>
      （anchor 覆盖率只算后者；未绑定的锚点等于「写了契约但没人实现」）。
    </p>
    <div class="row">
      <StatusBadge
        :tone="(anchors?.totals.unbound ?? 0) === 0 ? 'ok' : 'warn'"
        :text="'未绑定 ' + (anchors?.totals.unbound ?? 0) + ' / ' + (anchors?.totals.anchors ?? 0)"
      />
      <span class="muted">
        验收项 {{ anchors?.totals.acceptance ?? 0 }} · 可执行 {{ anchors?.totals.checked ?? 0 }}
      </span>
      <span class="grow" />
      <label class="muted"><input v-model="onlyUnbound" type="checkbox" /> 只看未绑定</label>
    </div>
    <table style="margin-top: 6px">
      <thead><tr><th>spec</th><th>kind</th><th>anchor</th><th>验收项</th><th>绑定任务</th></tr></thead>
      <tbody>
        <tr v-for="entry in anchorRows" :key="entry.path + '#' + entry.anchor">
          <td class="muted">{{ entry.path }}</td>
          <td>{{ entry.kind }}</td>
          <td><b>{{ entry.anchor }}</b></td>
          <td>
            <span v-if="entry.acceptance === 0" class="badge warn">无验收项</span>
            <span v-else class="muted">{{ entry.checked }} / {{ entry.acceptance }} 可执行</span>
          </td>
          <td>
            <span v-if="entry.bound_tasks.length > 0" class="muted">{{ entry.bound_tasks.join(', ') }}</span>
            <span v-else class="badge warn">未绑定</span>
          </td>
        </tr>
        <tr v-if="anchorRows.length === 0">
          <td colspan="5" class="muted">
            {{ onlyUnbound ? '所有锚点都被冻结任务绑定了。' : '还没有锚点：spec 里写「## &lt;锚点名&gt;」标题。' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import StatusBadge from '../../../components/StatusBadge.vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type { AcceptanceCheckCoverage, SpecAnchorsProjection } from '../../../api/types';

const project = useProjectStore();
const toasts = useToastStore();
const coverage = ref<AcceptanceCheckCoverage | null>(null);
const anchors = ref<SpecAnchorsProjection | null>(null);
const onlyUncovered = ref(false);
const onlyUnbound = ref(false);

const anchorRows = computed(() => {
  const entries = anchors.value?.entries ?? [];
  return onlyUnbound.value ? entries.filter((entry) => entry.bound_tasks.length === 0) : entries;
});

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
    const [coverageData, anchorData] = await Promise.all([
      project.projectApi<AcceptanceCheckCoverage>('/spec/checks'),
      project.projectApi<SpecAnchorsProjection>('/spec/anchors'),
    ]);
    coverage.value = coverageData;
    anchors.value = anchorData;
  } catch (error) {
    toasts.error('读取验收覆盖 / 锚点失败', errorMessage(error));
  }
}

onMounted(load);
watch(() => refreshCounter('specs'), () => void load());
</script>

<style scoped>
.check-group { margin-top: 14px; }
.check-group table { margin-top: 6px; }
</style>
