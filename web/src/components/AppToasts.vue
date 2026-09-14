<template>
  <div class="toast-stack">
    <div v-for="toast in toasts.items" :key="toast.id" class="toast" :class="toast.kind">
      <div class="toast-body">
        <strong>{{ toast.title }}</strong>
        <p v-if="toast.message">{{ toast.message }}</p>
      </div>
      <button class="ghost" @click="toasts.dismiss(toast.id)">✕</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToastStore } from '../stores/toasts';

const toasts = useToastStore();
</script>
