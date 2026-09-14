# ADR 0024：调度器要能崩溃恢复、有失败上限、预算跨重启、任务有超时

状态：已批准
日期：2026-09-15

## 背景

调度器的缺口不是「队列不落盘」——`runtime/queue.json` 一直有 `status` / `attempts` / `updated_at`。真正的缺口是**恢复语义**，四处证据：

1. `daemon.ts` 先把任务置为 `running` 再落盘，而 `nextQueuedTask()` 只挑 `status === 'queued'`：**崩在 running 的任务永远不会再被捡起**，从队列里静默消失。
2. `markQueueTask` 在置 running 时 `attempts + 1`，但**没有任何地方读它**：没有上限、没有退避，必然失败的任务会被无限重试。
3. `Budget` 在 `startDaemon` 内 `new Budget(...)`：**进程重启即重置额度**，而「每天跑多少分钟」这类预算语义本来就要求跨重启累计。
4. `runFlowRun(runner, { projectRoot, agentId, model })` **没有传 `timeoutMs`**：agent 一旦挂起，daemon 永久阻塞，不报错也不前进。

## 决策

1. **租约（lease）**：`QueueTask` 增加 `lease_until` 与 `owner`（pid@host）；置 running 时写下租约，完成/失败时清空。
2. **回收**：`reclaimExpiredLeases()` 在 daemon 启动时与每轮循环各执行一次；过期租约回到 `queued`，达到上限则标 `failed`。
3. **attempts 口径**：统计「启动过几次」，增量只发生在置 running 时；**回收不额外 +1**（否则一次崩溃会被记成两次尝试）。
4. **失败上限**：默认 3 次（`maxAttempts`）；达上限标 `failed` 并提示需人工介入后重新入队，不再自动重试。
5. **预算累计**：`runtime/budget.json` 记录 `used_ms`，daemon 启动时按「总额度 − 已用」计算剩余；`cometflow daemon budget [--reset]` 查看/清零。
6. **单任务超时**：默认 30 分钟（`taskTimeoutMs`），透传给 `runFlowRun`；租约时长取 `max(DEFAULT_LEASE_MS, timeout + 60s)`，保证正常执行不会被误判为过期。

## 理由

- 「至少一次」比「可能永远不执行」安全：回收会带来重复执行的可能，但队列任务本来就该幂等；静默丢失任务则无法补偿。
- attempts 的口径必须唯一，否则上限判定会提前触发（一次崩溃算两次），把还能救的任务判死。
- 预算不跨重启等于没有预算：重启是常态（手动停、崩溃、机器重启）。
- 超时是长跑的基本保障：没有它，一次挂起的 agent 会话就能让整个无人值守流程停止前进，而日志里没有任何错误。

## 后果

- 崩溃后重启 daemon 会看到 `daemon reclaimed <task> attempts=<n>`；达上限的任务打印 `daemon giving-up`。
- `queue.json` 增加 `lease_until` / `owner` 字段；旧队列文件缺字段时按「无租约」处理，不受影响。
- 队列任务必须幂等——这一点写进了代码注释与日志提示，也是使用无人值守模式的前提。
- `daemon budget` 让「这个月已经跑了多久」可查询、可清零。
