import { onMounted, watch } from 'vue';
import { useToastStore } from '../stores/toasts';
import { refreshCounter } from './useRefresh';
import { createPanelLoader, type PanelLoader } from './panel-loader';
import type { RefreshArea } from '../api/refresh-areas';

/**
 * 面板数据的标准接法：**加载 + 失败提示 + 跟着 SSE 重读**。
 *
 * 给出 `area` 之后，这个面板就自动订阅对应区域的刷新（见 `api/refresh-areas.ts` 的映射）。
 * 单飞与"失败保留旧值"的判据在 `createPanelLoader` 里，那部分有单元测试。
 */
export function usePanelData<T>(
  load: () => Promise<T>,
  options: { errorTitle: string; area?: RefreshArea; immediate?: boolean },
): PanelLoader<T> {
  const toasts = useToastStore();
  const loader = createPanelLoader(load, (message) => toasts.error(options.errorTitle, message));

  if (options.area !== undefined) {
    const area = options.area;
    watch(
      () => refreshCounter(area),
      () => void loader.reload(),
    );
  }
  if (options.immediate !== false) onMounted(() => void loader.reload());

  return loader;
}
