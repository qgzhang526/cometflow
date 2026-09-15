<template>
  <div v-if="error !== null" class="card finding">
    <b>面板渲染失败</b>
    <p class="muted">{{ error }}</p>
    <p class="muted">侧栏与其它面板不受影响；点「重试」重新挂载当前面板。</p>
    <div class="toolbar">
      <button class="primary" @click="retry">重试</button>
    </div>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';

const emit = defineEmits<{ retry: [] }>();
const error = ref<string | null>(null);

// 捕获子树的渲染/setup 错误：一个面板崩掉不应该把整个工作台变成空白页。
onErrorCaptured((captured) => {
  error.value = captured instanceof Error ? captured.message : String(captured);
  return false;
});

function retry(): void {
  error.value = null;
  emit('retry');
}
</script>
