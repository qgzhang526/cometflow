import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobManager } from '../../domains/server/jobs.js';

/**
 * job 记录的落盘顺序。
 *
 * 记录是"内存先改、异步落盘"，状态一路往前走：`queued` → `running` → `succeeded` + result。
 * 这些写入并发跑时，先发起的那次可能后 rename —— 磁盘上留下的是**旧快照**（没有 result），
 * 而且此后再无写入来修正它：重启后任务中心就看不到那次跑出了什么。
 *
 * CI 上真实撞到过（Windows 的 `build & test`）：`POST /eval/run` 之后重启 serve，
 * `GET /api/jobs/{id}` 拿到的结果里 `report` 不见了。
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-jobs-order-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('job 记录落盘顺序', () => {
  it('连续状态更新之后，磁盘上是**最后**那次（result 不会丢）', async () => {
    const manager = new JobManager({ resolveProjectRoot: async () => root });

    for (let index = 0; index < 15; index += 1) {
      const job = manager.create('p1', 'eval-run');
      // 三次写入连着发起、不等彼此：这正是乱序落盘会吃掉结果的形态。
      manager.start(job.id);
      manager.complete(job.id, { report: { passed: true } });
      await manager.flush();

      const record = JSON.parse(
        await fs.readFile(path.join(root, '.cometflow', 'runtime', 'jobs', job.id + '.json'), 'utf8'),
      ) as { status?: string; result?: { report?: { passed?: boolean } } };
      expect(record.status).toBe('succeeded');
      expect(record.result?.report?.passed).toBe(true);
    }
  }, 30000);
});
