import { describe, expect, it } from 'vitest';
import { createKeyedSerializer } from '../../platform/async/serialize.js';

/**
 * 按 key 串行化（`platform/async/serialize.ts`）。
 *
 * 它保护的是"异步写入的顺序"：同一个目标连着写两次时，先发起的那次不能后落盘——
 * 否则磁盘上留下的是旧快照，而且此后再无写入来修正（job 记录就踩过这个：
 * 重启后任务中心看不到那次跑出的 result）。
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createKeyedSerializer', () => {
  it('同一 key：后一个任务在前一个结束之后才开始（即使前者更慢）', async () => {
    const serialize = createKeyedSerializer();
    const events: string[] = [];

    const slow = serialize('job_1', async () => {
      events.push('slow:start');
      await delay(50);
      events.push('slow:end');
      return 'slow';
    });
    const fast = serialize('job_1', async () => {
      events.push('fast:start');
      events.push('fast:end');
      return 'fast';
    });

    expect(await slow).toBe('slow');
    expect(await fast).toBe('fast');
    // 关键断言：fast 的 start 必须晚于 slow 的 end（不是"谁快谁先落盘"）。
    expect(events).toEqual(['slow:start', 'slow:end', 'fast:start', 'fast:end']);
  });

  it('不同 key：互不等待', async () => {
    const serialize = createKeyedSerializer();
    const order: string[] = [];

    const first = serialize('job_1', async () => {
      await delay(30);
      order.push('job_1');
    });
    const second = serialize('job_2', async () => {
      order.push('job_2');
    });

    await Promise.all([first, second]);
    expect(order).toEqual(['job_2', 'job_1']);
  });

  it('前一个失败不卡住后面，且失败返回给调用方', async () => {
    const serialize = createKeyedSerializer();

    const failing = serialize('job_1', async () => {
      throw new Error('write failed');
    });
    await expect(failing).rejects.toThrow('write failed');

    // 队尾仍然可用：一次写失败不能让这个 key 永久哑掉。
    const recovered = await serialize('job_1', async () => 'ok');
    expect(recovered).toBe('ok');
  });
});
