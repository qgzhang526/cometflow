import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import type { Finding, FindingsResponse } from '../api/types';

/**
 * 统一 findings 的共享状态。
 *
 * 它是唯一被两处同时用到的只读投影（总览「问题清单」+ 顶栏健康徽章），所以放进 store 而不是面板局部状态：
 * 两处各拉一次，就会出现「顶栏说 3 个 error、清单里只列了 2 条」这种互相打脸的画面。
 */
export const useFindingsStore = defineStore('findings', () => {
  const items = ref<Finding[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const projectId = ref<string | null>(null);

  const errorCount = computed(() => items.value.filter((finding) => finding.severity === 'error').length);
  const warningCount = computed(() => items.value.filter((finding) => finding.severity === 'warning').length);

  async function load(id: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const data = await api<FindingsResponse>('/projects/' + encodeURIComponent(id) + '/findings');
      items.value = data.findings;
      projectId.value = id;
    } catch (caught) {
      error.value = errorMessage(caught);
      items.value = [];
    } finally {
      loading.value = false;
    }
  }

  function reset(): void {
    items.value = [];
    projectId.value = null;
    error.value = null;
  }

  return { items, loading, error, projectId, errorCount, warningCount, load, reset };
});
