<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal" :class="{ wide }">
        <div class="modal-head">
          <strong>{{ title }}</strong>
          <button class="ghost" @click="emit('close')">✕</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div class="modal-foot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ title: string; wide?: boolean }>(), { wide: false });
const emit = defineEmits<{ close: [] }>();
</script>
