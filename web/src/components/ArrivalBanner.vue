<template>
  <!--
    「去处理」的落地横幅：说清**为什么在这**、**接下来点什么**。
    挂在 ProjectView 里而不是各面板内部：跳转目标可能是不需要特殊逻辑的面板
    （例如 multiple-active-changes → 变更），但"到了该干嘛"这句话每个落点都需要。
  -->
  <div v-if="arrival !== null" class="finding">
    来自问题清单：<b>{{ arrival.subject ?? '整个项目' }}</b>
    <template v-if="arrival.reason"> —— {{ arrival.reason }}</template>
    <span class="muted">（已切到「{{ describeTarget(arrival) }}」）</span>
    <button class="ghost" @click="navigation.dismissArrival()">知道了</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useNavigationStore } from '../stores/navigation';
import { describeTarget } from '../utils/finding-targets';

const navigation = useNavigationStore();
const arrival = computed(() => navigation.arrival);
</script>
