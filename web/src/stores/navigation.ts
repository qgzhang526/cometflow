import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PanelTarget } from '../utils/finding-targets';

/**
 * 「带着意图跳过去」：问题清单的「去处理」不只是换面板，还要落到能处理它的那个页签、
 * 并指名出问题的那份 spec / 那个 change。
 *
 * 为什么走 store 而不是 props：面板是 `<component :is>` 动态挂的、切换靠路由，
 * 给每个面板塞一层 props 只为传一次跳转不值当；而"跳到规格的哪个页签"本来也不是面板的 props。
 */
export const useNavigationStore = defineStore('navigation', () => {
  const pending = ref<PanelTarget | null>(null);
  /**
   * 最近一次**已被取走**的跳转：落地横幅读它。
   *
   * 与 `pending` 分开是因为生命周期不同：`pending` 是"还没人接"的一次性意图（面板取走即清），
   * 而横幅要一直显示到用户看完——由用户点「知道了」或下一次跳转覆盖。
   */
  const arrival = ref<PanelTarget | null>(null);

  function request(target: PanelTarget): void {
    // 每次都是新对象：连着两次跳同一个面板（不同 subject）也能触发 watch。
    pending.value = { ...target };
    /**
     * 横幅在**点击那一刻**就挂上，而不是等面板取走——只有需要落到某个页签的面板才会调
     * `consume`（例如「变更」不需要），否则"去变更"这一类落点就没有落地说明。
     * 用户离开目标面板时由 ProjectView 清掉（见那里的 watch）。
     */
    arrival.value = { ...target };
  }

  /** 面板取走属于自己的那次跳转（取走即清，避免下次挂载又应用一遍）。 */
  function consume(panel: PanelTarget['panel']): PanelTarget | null {
    const current = pending.value;
    if (current === null || current.panel !== panel) return null;
    pending.value = null;
    return current;
  }

  function dismissArrival(): void {
    arrival.value = null;
  }

  return { pending, arrival, request, consume, dismissArrival };
});
