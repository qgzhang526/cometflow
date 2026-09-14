<template>
  <span class="badge" :class="tone">{{ text }}</span>
</template>

<script setup lang="ts">
defineProps<{ tone: 'ok' | 'warn' | 'err' | 'gray' | 'brand'; text: string }>();
</script>
