import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

let nextId = 1;

/** 界面反馈统一走这里，替掉散落的 alert()。 */
export const useToastStore = defineStore('toasts', () => {
  const items = ref<Toast[]>([]);

  function push(kind: ToastKind, title: string, message?: string): number {
    const id = nextId++;
    items.value = [...items.value, { id, kind, title, message }];
    const ttl = kind === 'error' ? 8000 : 4000;
    window.setTimeout(() => dismiss(id), ttl);
    return id;
  }

  function dismiss(id: number): void {
    items.value = items.value.filter((item) => item.id !== id);
  }

  return {
    items,
    dismiss,
    info: (title: string, message?: string) => push('info', title, message),
    success: (title: string, message?: string) => push('success', title, message),
    error: (title: string, message?: string) => push('error', title, message),
  };
});
