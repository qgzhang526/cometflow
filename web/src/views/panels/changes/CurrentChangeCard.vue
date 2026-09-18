<template>
  <div class="card">
    <div class="row">
      <h2>当前 change（写保护路由）</h2>
      <span class="grow" />
      <StatusBadge
        :tone="pointer === null ? (activeChanges.length > 1 ? 'warn' : 'gray') : pointerResolved ? 'ok' : 'err'"
        :text="
          pointer === null
            ? activeChanges.length > 1
              ? '未设置 · 写保护会 fail closed'
              : '未设置'
            : pointerResolved
              ? '已设置 ' + pointer.change
              : '指针已失效'
        "
      />
      <button v-if="pointer !== null" class="ghost" :disabled="busy" @click="emit('clearCurrent')">清除</button>
    </div>

    <!--
      这段就是 doctor 那条 `multiple-active-changes` 的"怎么处理"：
      守卫按指针判断"这次写入属于谁"，没指针时归属不明 → 直接拒绝 agent 的写入（fail closed）。
    -->
    <p class="muted">
      同时有多个活跃 change 时，写保护守卫靠这个指针判断<b>这次写入属于谁</b>：
      没设（或指向已归档的 change）时，归属不明的写入会被拒绝——也就是 agent 改不动文件。
      <b>正在做哪一个，就把它设为当前</b>（等价 <code>cometflow change select &lt;name&gt;</code>）；
      设好之后问题清单里那条 <code>multiple-active-changes</code> 会从 warning 降级为 info。
      不打算跑 agent 的这段可以不管它。
    </p>

    <p v-if="activeChanges.length === 0" class="muted">没有活跃 change：先新建一个（下面「新建」），或从计划里冻一条任务。</p>
    <div v-else class="row">
      <template v-for="change in activeChanges" :key="change.name">
        <button
          class="ghost"
          :disabled="busy || pointer?.change === change.name"
          :title="'把 ' + change.name + ' 设为当前 change（写入门禁按它的模块边界判定）'"
          @click="emit('setCurrent', change.name)"
        >
          {{ pointer?.change === change.name ? '✓ ' + change.name : '设为当前 ' + change.name }}
          <span class="muted">· {{ change.phase }}</span>
        </button>
      </template>
    </div>

    <p v-if="staleHint" class="muted">
      这些都是遗留的半成品 change？它们<b>不影响你手工编辑</b>，只在跑 agent 时占位。
      产品目前没有「废弃 change」入口：要么把它走完流程归档（空的 change 归档不会应用任何 spec 变更，
      但 build 阶段会真的跑一次 agent），要么人工删 <code>changes/&lt;name&gt;/</code> 目录——这条缺口已登记。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import StatusBadge from '../../../components/StatusBadge.vue';
import type { ChangeState, CurrentChangePointer } from '../../../api/types';

/**
 * 当前 change 指针：写保护路由的**唯一开关**，也是 doctor 那条 `multiple-active-changes` 的解法。
 *
 * 从「变更」列表卡里挪出来单独一张卡：它原来是一行灰字，用户看到"未设置（4 个活跃 change）"
 * 之后既不知道选哪个、也不知道选完会怎样。这里把候选直接列成按钮（带 phase），并写清后果。
 */
const props = defineProps<{
  activeChanges: ChangeState[];
  pointer: CurrentChangePointer | null;
  pointerResolved: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{ setCurrent: [name: string]; clearCurrent: [] }>();

/** 遗留提示只在"多个活跃 change 且没设指针"时出现——别的问题不需要这段。 */
const staleHint = computed(() => props.pointer === null && props.activeChanges.length > 1);
</script>
