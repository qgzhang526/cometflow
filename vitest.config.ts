import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    /**
     * 这套测试会**起子进程**（验收 check、生成的守卫脚本、真实 CLI 走 tsx）并做并发文件读写，
     * 默认的 5s / 10s 预算在高负载机器上会把「慢」判成「坏」：把 8 核压满后跑全量，
     * 实测一次出现 55 处 `Test timed out in 5000ms`、3 处 hook 超时，以及 29 处
     * 因此连带出来的 `EBUSY` 清理失败——这些用例单独跑全绿，机器空下来也全绿。
     *
     * 放宽到 30s，让超时只在真的卡死时触发；确实更慢的用例（真实 CLI）仍在自己那里显式给预算。
     */
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
