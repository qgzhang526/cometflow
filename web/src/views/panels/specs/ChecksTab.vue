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
      <br />
      下面按锚点分组，锚点分两类：<strong>契约锚点</strong>（capability spec 里的
      <code>## POST /login</code> 这类标题——要派任务、要独立验收）与<strong>结构标题</strong>
      （flow 的步骤、models 的实体、rules 的规则……只做展示与跨文件引用校验，
      <strong>不参与任务绑定与覆盖率</strong>）。两类用徽章区分，别把结构标题的"没有绑定任务"当成缺口。
    </p>

    <div v-for="group in groups" :key="group.path + '#' + group.anchor" class="check-group">
      <div class="row">
        <b>{{ group.path }}#{{ group.anchor }}</b>
        <StatusBadge
          v-if="group.kind === 'capability'"
          tone="brand"
          text="契约锚点 · 需绑定"
          title="会被 plan generate 派成任务；`未绑定` 才是缺口"
        />
        <StatusBadge v-else tone="gray" :text="group.kind + ' 结构 · 不参与绑定'" />
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

    <h3>可绑定锚点（capability 的契约标题）</h3>
    <p class="muted">
      与 <code>cometflow spec anchors</code> 同一份投影。这里回答上面看不到的两个问题：
      哪些锚点<strong>没有</strong>验收项，以及哪些锚点<strong>没有被冻结任务绑定</strong>
      （anchor 覆盖率只算后者；未绑定的锚点等于「写了契约但没人实现」）。
      <br />
      只列 <strong>capability spec</strong>（<code>specs/&lt;capability&gt;/spec.md</code>）里的契约标题——
      只有它们能被任务用 <code>spec_anchor</code> 绑定。其它 kind 的标题是<strong>文档结构</strong>
      （flow 的 <code>## 前置条件 / ## 步骤 / ## 后置条件</code> 三段式骨架、models 的实体清单、
      rules 的规则表、constraints 的各条约束……），既不参与绑定也不进覆盖率，所以不在这里列。
      flow 的可绑定单位是它的步骤（<code>### 步骤N …</code>），属于 flow 自己的结构，不参与任务绑定。
      换句话说：<strong>这张表里出现的每一条都需要绑定</strong>，
      「未绑定」＝缺口；被排除的结构标题不在这里出现（数量见上方统计）。
    </p>
    <div class="row">
      <StatusBadge
        :tone="(anchors?.totals.unbound ?? 0) === 0 ? 'ok' : 'warn'"
        :text="'未绑定 ' + (anchors?.totals.unbound ?? 0) + ' / ' + (anchors?.totals.anchors ?? 0)"
      />
      <span class="muted">
        验收项 {{ anchors?.totals.acceptance ?? 0 }} · 可执行 {{ anchors?.totals.checked ?? 0 }}
        <template v-if="(anchors?.totals.structural ?? 0) > 0">
          · 另有 {{ anchors?.totals.structural }} 个结构标题<strong>不参与绑定</strong>
        </template>
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
            <!-- 这张表里全是「需要绑定」的锚点，所以「未绑定」就是缺口：写了契约但没人实现。 -->
            <span v-else class="badge warn" title="写了契约但没有任务去实现它——这才是缺口">未绑定</span>
          </td>
        </tr>
        <tr v-if="anchorRows.length === 0">
          <td colspan="5" class="muted">
            {{
              onlyUnbound
                ? '所有锚点都被冻结任务绑定了。'
                : '还没有可绑定锚点：在 capability spec 里写「## &lt;契约标题&gt;」（如 ## POST /login）。'
            }}
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
      // kind 由后端给（前端不重复实现 kind 判定规则）：分组标题据此标「需绑定 / 不参与绑定」。
      kind: entry.kind,
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
