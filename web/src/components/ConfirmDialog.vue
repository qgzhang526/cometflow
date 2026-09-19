<template>
  <!--
    站内二次确认弹层：替代 window.confirm。
    原生 confirm 的样式和页面不统一，而且它会阻塞渲染、在部分内嵌浏览器里表现不一。
    这里复用 ModalCard，行为一致：只有按钮能关，点遮罩不关。
  -->
  <ModalCard :title="title" @close="emit('cancel')">
    <p class="confirm-message">{{ message }}</p>
    <template #footer>
      <button @click="emit('cancel')">{{ cancelText }}</button>
      <button class="primary" @click="emit('confirm')">{{ confirmText }}</button>
    </template>
  </ModalCard>
</template>

<script setup lang="ts">
import ModalCard from './ModalCard.vue';

withDefaults(
  defineProps<{ title: string; message: string; confirmText?: string; cancelText?: string }>(),
  { confirmText: '确定', cancelText: '取消' },
);
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<style scoped>
.confirm-message { margin: 0; line-height: 1.7; white-space: pre-wrap; }
</style>
