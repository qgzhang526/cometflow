<template>
  <!--
    goal 级调度顺序（ADR 0029）：顺序写在 COMETFLOW.md 的 `## 调度顺序` 里，位置即顺序。
    把"当前生效的顺序"直接摊开——不然读者得自己在脑子里按文件名排序。
  -->
  <div class="card">
    <div class="row">
      <h2>调度顺序</h2>
      <span class="grow" />
      <StatusBadge
        :tone="listed.length > 0 ? 'brand' : 'gray'"
        :text="listed.length > 0 ? '显式 ' + listed.length + ' 个' : '按编号'"
      />
    </div>
    <p class="muted">
      写在 <code>COMETFLOW.md</code> 的 <code>## 调度顺序</code> 段落里，<b>位置即顺序</b>：
      列出的按清单走，没列出的（含新加的 goal）按编号升序排在后面。
      顺序不冻进计划——改它不需要重新 <code>plan freeze</code>；已完成 goal 不参与领取，留在清单里也无害。
      要插队就把那一条挪到清单第一行。
    </p>
    <p v-if="listed.length > 0">
      <b>{{ listed.join(' → ') }}</b>
      <span class="muted"> → 其余按编号升序</span>
    </p>
    <p v-else class="muted">没有显式清单：当前按 goal 编号升序（<code>G2</code> 在 <code>G10</code> 之前）。</p>
    <p v-for="warning in warnings" :key="warning" class="muted">警告：{{ warning }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import StatusBadge from '../../../components/StatusBadge.vue';

const props = defineProps<{ order: { listed: string[]; warnings: string[] } | undefined }>();

// 没有 order（老服务端 / 还没加载）时按"没有显式清单"显示：与真实语义一致（编号兜底）。
const listed = computed(() => props.order?.listed ?? []);
const warnings = computed(() => props.order?.warnings ?? []);
</script>
