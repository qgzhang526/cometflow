import { describe, expect, it } from 'vitest';
import { createPanelLoader } from './panel-loader';

/**
 * 面板加载器的两条判据（每个面板过去都各写一遍，且写法不一致）：
 * 1. **单飞**：连点刷新 / SSE 抖动 / 轮询撞手动刷新，只发一个请求；
 * 2. **失败保留旧值**：读失败时清空数据，比显示旧值更容易让人以为"东西没了"。
 */
describe('createPanelLoader', () => {
  it('单飞：并发调用只发一次请求，结果落在同一个 data 上', async () => {
    let calls = 0;
    let release!: (value: string) => void;
    const loader = createPanelLoader(
      () => {
        calls += 1;
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
      () => undefined,
    );

    const first = loader.reload();
    const second = loader.reload();
    expect(calls).toBe(1);
    release('值');
    await Promise.all([first, second]);
    expect(loader.data.value).toBe('值');
    expect(loader.loading.value).toBe(false);
  });

  it('失败保留旧值，并把原因交给调用方（不吞掉）', async () => {
    const errors: string[] = [];
    let fail = false;
    const loader = createPanelLoader(async () => {
      if (fail) throw new Error('boom');
      return { queued: 2 };
    }, (message) => errors.push(message));

    await loader.reload();
    expect(loader.data.value).toEqual({ queued: 2 });

    fail = true;
    await loader.reload();
    expect(errors).toEqual(['boom']);
    expect(loader.error.value).toBe('boom');
    // 关键：旧值还在（面板不会突然空掉）；下一次成功会清掉错误。
    expect(loader.data.value).toEqual({ queued: 2 });
    fail = false;
    await loader.reload();
    expect(loader.error.value).toBeNull();
  });
});
