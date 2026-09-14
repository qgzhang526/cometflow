<template>
  <RouterView />
  <AppToasts />
  <div v-if="needsToken" class="conn-banner auth-banner">
    <span>{{ session.hasToken ? 'token 已被服务端拒绝，请粘贴新的 token。' : '请粘贴 serve 启动时打印的 token。' }}</span>
    <input v-model="tokenDraft" placeholder="token" />
    <button class="primary" @click="applyToken">保存</button>
  </div>
  <div v-if="disconnected" class="conn-banner">
    <span>实时连接已断开（{{ events.connection }}），界面不会自动刷新。</span>
    <button @click="events.reconnectNow()">立即重连</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterView } from 'vue-router';
import AppToasts from './components/AppToasts.vue';
import { tokenRejected } from './api/client';
import { useEventStore } from './stores/events';
import { useSessionStore } from './stores/session';

const events = useEventStore();
const session = useSessionStore();
const tokenDraft = ref('');

const disconnected = computed(
  () =>
    session.hasToken &&
    !tokenRejected.value &&
    (events.connection === 'reconnecting' || events.connection === 'offline'),
);
const needsToken = computed(() => !session.hasToken || tokenRejected.value);

function applyToken(): void {
  session.save(tokenDraft.value);
  tokenDraft.value = '';
  events.reconnectNow();
  // 重新加载当前路由：之前失败的请求需要重发一遍。
  window.location.reload();
}

// 401 后立刻忘掉坏 token，避免它一直被当成「已配置」而反复失败。
watch(tokenRejected, (rejected) => {
  if (rejected) session.save('');
});

onMounted(() => events.start());
</script>
