<template>
  <div class="steps">
    <div
      v-for="(step, index) in STEPS"
      :key="step"
      class="step"
      :class="{ active: step === phase, done: index < currentIndex, blocked: status === 'blocked' && step === phase }"
    >
      {{ LABELS[step] }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ChangePhase, ChangeStatus } from '../api/types';

const props = defineProps<{ phase: ChangePhase; status?: ChangeStatus }>();

const STEPS: ChangePhase[] = ['shape', 'build', 'verify', 'archive'];
const LABELS: Record<ChangePhase, string> = {
  shape: '① 确认验收',
  build: '② 构建',
  verify: '③ 验收',
  archive: '④ 归档',
};
const currentIndex = computed(() => STEPS.indexOf(props.phase));
</script>
