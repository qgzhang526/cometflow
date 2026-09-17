# 0028 并发策略：单元是 capability spec，写保护守卫在位时不开放并发

状态：已批准（2026-09-17）
关联：[0018 current-change 路由](./0018-current-change-routing.md)、
[0021 并发写保护](./0021-concurrent-write-protection.md)、
[0023 写保护装进平台](./0023-platform-hook-install.md)、
[0027 内嵌调度器](./0027-embedded-scheduler.md)、
[scheduler-concurrency-plan.md](../plan/scheduler-concurrency-plan.md)（C3/C4）

## 背景

C1（原子领取 + change 级互斥）与单实例租约（ADR 0027）之后，"一个调度器"已经成立，
下一个问题才是**它内部能不能同时推进多个任务**。不先定策略就写 `--concurrency N`，
会把两件事撞在一起：

1. **同一个契约/模块被两个 agent 同时改**：任务是从 spec anchor 派生的，同一 capability 的任务共享
   `spec_ref` 与 `module`，并行改同一块代码的冲突不是"运气问题"，而是必然；
2. **写保护守卫是 fail-closed 且按 current-change 指针判归属**（ADR 0018/0023）：并发跑两个 change 时
   指针只能指其中一个，另一个的写入会被守卫拒绝——表现为"agent 报错"，而不是"CometFlow 说清了原因"。

## 决策

1. **并发单元 = capability spec（`spec_ref`）**：同一 `spec_ref` 的任务**永不并行**。
   理由：spec 是契约，`module` 声明在 spec 上，同一 capability 的任务天然落在同一块代码与同一份文档上。
   （goal 级太粗——一个 goal 的 `scope` 可以含多个 capability；module 级需要在 spec 之外再引一层映射。）
2. **写保护守卫在位时，不开放并发**：只要项目装了写保护守卫（`.claude/settings.json` 里的 CometFlow hook），
   `--concurrency > 1` 一律**拒绝启动**（不是静默降级），并说明原因：
   "守卫按 current-change 指针判定写入归属，并发会让另一个 change 的写入被拒"。
   要做并发，先卸载守卫（`cometflow hook uninstall . --platform claude-code`），或等守卫支持按 module 归属。
3. **不做抢占**：已经跑起来的 agent 会话不打断；`stop` / `pause` 只影响"是否领取新任务"。
4. **队列写入串行化**：并发下每个任务的完成都会改队列文件，写入必须经进程内互斥（后写覆盖前写会丢状态）。

## 后果

正面：

- "并行"的粒度有明确语义：一个 capability 同时只有一个执行者，避免必然冲突；
- 守卫冲突从"agent 莫名报错"变成"启动时一句人话"，可解释、可操作；
- 与既有机制零冲突：租约管"一个调度器"、原子领取管"不重复领"、本 ADR 管"谁能并行"。

负面与边界：

- 装了守卫的项目**用不了并发**——这是有意的保守选择，直到守卫支持按 module 归属；
- 并发单元是 spec 而不是 module：同一 spec 下如果真有两个互不相干的 module，也会被串行化（牺牲吞吐换正确）；
- 跨项目并发（工作区级）不在本条范围内。

## 与既有机制的关系

| 机制 | 关系 |
|---|---|
| C1 原子领取 | 并发下仍然成立：每次领取都在项目锁内重新推导 |
| 单实例租约（ADR 0027） | 并发的语义是"一个调度器内部 N 个槽"，不是"起 N 个调度器" |
| 写保护守卫（ADR 0023） | 本 ADR 明确：守卫在位 → 并发关闭；这不是临时妥协，而是 fail-closed 的直接推论 |
| 任务依赖（C2） | 并发的准入还要满足依赖：`blocked_by` 非空的条目任何槽都不会领 |

## 实施记录（2026-09-17）

本条的**执行部分**已落地，两条约束都按上面执行：

| 机制 | 实现 |
|---|---|
| 并发单元 | `concurrencyUnit()`：`spec_ref`（起草类任务回退到 `capability`）；领取时用 `nextClaimableTask(tasks, unitsInFlight)` 跳过已被占用的单元 |
| 准入 | `checkConcurrencyGate()`：`--concurrency > 1` 时探测写保护守卫（`hookStatus` 支持且已安装的平台），装了则返回 `concurrency-not-open` 并说明解除方式（CLI 退出码 1，**不静默降级**） |
| 队列写互斥 | 调度器内 `withQueueWrite()`（promise 链）串行化"改内存队列 + 落盘"，并发收尾不会互相覆盖 |
| 槽位 | 主循环按 `concurrency` 领取到满，`Promise.race` 等空槽；`stop`/`pause`/`needs-human` 只**停止领取**，已领取的槽跑完（不抢占） |
| 锁粒度 | `acquireLock` 新增 `scope`：`change run` 用 `change-run-<name>`（`runtime/locks/<scope>.lock`），**按 change 隔离**——项目级那把锁仍是"一次改多个文件"的事务锁（冻结/归档） |

实测（`daemon-slots.test.ts`，注入式 runner 记录同时运行数）：
两个 capability 各一条任务、`concurrency=2` → 观测到 **2** 并发；
同一 `spec_ref` 的两条任务、`concurrency=2` → 观测到 **1**（串行）；
装了 claude-code 守卫的项目（`daemon-dependency.test.ts` 真装一次钩子）→ 启动被拒并提示 `hook uninstall`。

**仍未做**：写保护守卫支持按 module 判定归属（那样装了守卫的项目也能并发）、goal 级排序与优先级、
跨项目并发。前者的落点是 ADR 0023 的守卫本体。
