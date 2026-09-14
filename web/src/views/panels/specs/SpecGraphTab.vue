<template>
  <div>
    <div class="row">
      <span class="muted">
        文件 {{ graph?.summary.files ?? 0 }} · 锚点 {{ graph?.summary.anchors ?? 0 }} · 引用目标
        {{ graph?.summary.targets ?? 0 }} · 引用边 {{ graph?.summary.edges ?? 0 }}
      </span>
      <StatusBadge
        :tone="unresolvedCount === 0 ? 'ok' : 'err'"
        :text="unresolvedCount === 0 ? '引用全部可解析' : unresolvedCount + ' 条未解析'"
      />
      <span class="grow" />
      <button class="ghost" @click="load">刷新</button>
    </div>
    <p class="muted">
      边按 009 的引用方向表（行为层 → 数据/契约层）聚合；红色虚线表示目标 kind 缺失。
      解析规则与 <code>spec validate</code> 同源，所以图上的红边就是门禁会报的那条错。
    </p>

    <svg class="spec-graph" :viewBox="'0 0 ' + width + ' ' + height" role="img" aria-label="spec 引用关系图">
      <defs>
        <marker id="spec-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
        </marker>
      </defs>
      <g v-for="edge in kindEdges" :key="edge.from + '->' + edge.to">
        <path
          :d="curve(edge)"
          fill="none"
          :stroke="edge.resolved ? '#94a3b8' : '#dc2626'"
          :stroke-dasharray="edge.resolved ? '0' : '4 3'"
          stroke-width="1.4"
          marker-end="url(#spec-graph-arrow)"
        >
          <title>{{ edge.from.replace('kind:', '') }} → {{ edge.to.replace('kind:', '') }} · 引用 {{ edge.count ?? 0 }} 条{{ edge.resolved ? '' : '（目标 kind 缺失）' }}</title>
        </path>
      </g>
      <g v-for="node in kindNodes" :key="node.id" class="spec-graph-node" @click="selectedKind = node.kind">
        <rect
          :x="position(node).x"
          :y="position(node).y"
          :width="BOX_WIDTH"
          :height="BOX_HEIGHT"
          rx="8"
          :fill="node.kind === selectedKind ? '#6366f1' : node.status === 'present' ? '#eef2ff' : node.status === 'deferred' ? '#fff7e6' : '#f1f2f4'"
          :stroke="node.kind === selectedKind ? '#4338ca' : '#e6e8ec'"
        />
        <text
          :x="position(node).x + BOX_WIDTH / 2"
          :y="position(node).y + BOX_HEIGHT / 2 + 4"
          text-anchor="middle"
          :fill="node.kind === selectedKind ? '#ffffff' : '#111827'"
          font-size="12"
        >
          {{ node.label }}
        </text>
      </g>
    </svg>

    <div v-if="selectedKind" class="row" style="margin-top: 10px">
      <h3 style="margin: 0">{{ selectedKind }}</h3>
      <span class="muted">{{ filesOfSelectedKind.length }} 个文件</span>
      <span class="grow" />
      <button class="ghost" @click="selectedKind = ''; selectedFile = ''">收起</button>
    </div>

    <div v-if="selectedKind" class="row" style="margin-top: 8px">
      <button
        v-for="file in filesOfSelectedKind"
        :key="file.path"
        class="ghost"
        :class="{ primary: file.path === selectedFile }"
        @click="toggleFile(file.path)"
      >
        {{ file.label }} · {{ file.anchors }} 锚点
      </button>
    </div>

    <div v-if="selectedFile" class="row" style="margin-top: 8px">
      <button
        v-for="anchor in anchorsOfSelectedFile"
        :key="anchor.id"
        class="ghost"
        @click="scrollToAnchor(anchor)"
      >
        {{ anchor.label }}
        <span class="muted">({{ anchor.acceptance }} 验收{{ anchor.hasCheck ? '' : ' · 无 check' }})</span>
      </button>
    </div>

    <table v-if="visibleEdges.length > 0">
      <thead><tr><th>来源</th><th>引用</th><th>位置</th></tr></thead>
      <tbody>
        <tr v-for="edge in visibleEdges" :key="edge.from + edge.to + (edge.site?.line ?? '')">
          <td class="muted">{{ edge.from.replace(/^anchor:|^file:/u, '') }}</td>
          <td>
            <StatusBadge :tone="edge.resolved ? 'ok' : 'err'" :text="edge.refKind ?? 'ref'" />
            {{ labelOf(edge.to) }}
          </td>
          <td class="muted">{{ edge.site ? edge.site.path + ':' + edge.site.line : '—' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="selectedFile" class="muted">该文件没有跨文件引用。</p>

    <div v-if="unresolved.length > 0" style="margin-top: 12px">
      <h3>未解析引用（与 spec validate 同源）</h3>
      <div v-for="entry in unresolved" :key="entry.path + entry.line + entry.value" class="finding" :class="{ warning: entry.severity === 'warning' }">
        [{{ entry.severity }}] {{ entry.code }} · {{ entry.path }}:{{ entry.line }} · {{ entry.refKind }} = {{ entry.value }}
      </div>
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
import type { SpecGraphEdge, SpecGraphNode, SpecGraphProjection } from '../../../api/types';

const emit = defineEmits<{ open: [specPath: string, line: number] }>();

const project = useProjectStore();
const toasts = useToastStore();
const graph = ref<SpecGraphProjection | null>(null);
const selectedKind = ref('');
const selectedFile = ref('');

const BOX_WIDTH = 118;
const BOX_HEIGHT = 30;
const COLUMNS = 4;
const GAP_X = 26;
const GAP_Y = 26;
const width = COLUMNS * BOX_WIDTH + (COLUMNS - 1) * GAP_X + 20;
const height = 3 * BOX_HEIGHT + 2 * GAP_Y + 20;

const kindNodes = computed(() => (graph.value?.nodes ?? []).filter((node) => node.level === 'kind'));
const kindEdges = computed(() =>
  (graph.value?.edges ?? []).filter((edge) => edge.level === 'reference' && edge.from.startsWith('kind:')),
);
const unresolved = computed(() => graph.value?.unresolved ?? []);
const unresolvedCount = computed(() => unresolved.value.length);

const nodeById = computed(() => new Map((graph.value?.nodes ?? []).map((node) => [node.id, node])));

const filesOfSelectedKind = computed(() =>
  (graph.value?.nodes ?? [])
    .filter((node) => node.level === 'file' && node.kind === selectedKind.value)
    .map((node) => ({
      path: node.path ?? '',
      label: node.label,
      anchors: (graph.value?.nodes ?? []).filter((entry) => entry.level === 'anchor' && entry.path === node.path).length,
    })),
);

const anchorsOfSelectedFile = computed(() =>
  (graph.value?.nodes ?? []).filter((node) => node.level === 'anchor' && node.path === selectedFile.value),
);

/** 只看当前选中文件/kind 的引用边，避免一次把整份图铺开。 */
const visibleEdges = computed(() => {
  const edges = graph.value?.edges ?? [];
  if (selectedKind.value === '') return [];
  const allowedFrom = new Set<string>();
  for (const node of graph.value?.nodes ?? []) {
    if (selectedFile.value !== '' && node.path === selectedFile.value) allowedFrom.add(node.id);
    else if (selectedFile.value === '' && node.level === 'file' && node.kind === selectedKind.value) allowedFrom.add(node.id);
  }
  return edges.filter((edge) => edge.level === 'reference' && allowedFrom.has(edge.from)).slice(0, 40);
});

function position(node: SpecGraphNode): { x: number; y: number } {
  const index = kindNodes.value.findIndex((entry) => entry.id === node.id);
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  return { x: 10 + column * (BOX_WIDTH + GAP_X), y: 10 + row * (BOX_HEIGHT + GAP_Y) };
}

function curve(edge: SpecGraphEdge): string {
  const from = kindNodes.value.find((node) => 'kind:' + node.kind === edge.from);
  const to = kindNodes.value.find((node) => 'kind:' + node.kind === edge.to);
  if (!from || !to) return '';
  const a = position(from);
  const b = position(to);
  const start = { x: a.x + BOX_WIDTH / 2, y: a.y + BOX_HEIGHT / 2 };
  const end = { x: b.x + BOX_WIDTH / 2, y: b.y + BOX_HEIGHT / 2 };
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 18 };
  return 'M ' + start.x + ' ' + start.y + ' Q ' + mid.x + ' ' + mid.y + ' ' + end.x + ' ' + end.y;
}

function labelOf(nodeId: string): string {
  return nodeById.value.get(nodeId)?.label ?? nodeId;
}

function toggleFile(specPath: string): void {
  selectedFile.value = selectedFile.value === specPath ? '' : specPath;
}

function scrollToAnchor(anchor: SpecGraphNode): void {
  if (anchor.path !== undefined) emit('open', anchor.path, anchor.line ?? 1);
}

async function load(): Promise<void> {
  try {
    graph.value = await project.projectApi<SpecGraphProjection>('/spec/graph');
    if (selectedKind.value !== '' && filesOfSelectedKind.value.length === 0) selectedKind.value = '';
  } catch (error) {
    toasts.error('读取引用图失败', errorMessage(error));
  }
}

onMounted(load);
watch(() => refreshCounter('specs'), () => void load());
</script>

<style scoped>
.spec-graph { width: 100%; height: auto; background: #fff; border: 1px solid var(--border); border-radius: 12px; }
.spec-graph-node { cursor: pointer; }
</style>
