import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { getToken, setToken } from '../api/client';

export const useSessionStore = defineStore('session', () => {
  const token = ref(getToken());
  const hasToken = computed(() => token.value !== '');

  function save(next: string): void {
    setToken(next);
    token.value = getToken();
  }

  return { token, hasToken, save };
});
