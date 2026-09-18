import { ref, type Ref } from 'vue';

/**
 * 面板的"读一次"这件事：单飞、失败不炸、数据整体替换。
 *
 * 每个面板都写过一遍这段（`try { data = await api(...) } catch { toasts.error(...) }`），
 * 而且各写各的：有的不防并发（连点两次刷新会互相覆盖），有的失败后把旧数据清空。
 * 这里把**可测的那部分**（单飞 + 失败保留旧值）收成一个不含 store 的纯逻辑，
 * `usePanelData` 再把它接到 toast 与 SSE 上。
 */
export interface PanelLoader<T> {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  /** 最近一次失败的原始信息（null 表示上一次是成功的）。 */
  error: Ref<string | null>;
  reload: () => Promise<void>;
}

export function createPanelLoader<T>(load: () => Promise<T>, onError: (message: string) => void): PanelLoader<T> {
  const data = ref<T | null>(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function reload(): Promise<void> {
    // 单飞：刷新按钮连点、SSE 抖动、轮询撞上手动刷新，都只发一个请求。
    if (loading.value) return;
    loading.value = true;
    try {
      const next = await load();
      data.value = next;
      error.value = null;
    } catch (cause) {
      // 失败**保留上一次的数据**：把面板清空比显示旧值更容易让人以为"东西没了"。
      const message = cause instanceof Error ? cause.message : String(cause);
      error.value = message;
      onError(message);
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, error, reload };
}
