# 调度器并发与精细化排序

状态：**C1 已实施，C2–C4 待实施**（2026-09-17）
来源：[daemon-drives-change-plan.md](./daemon-drives-change-plan.md) §9 的四条前置条件
关联：ADR [0016](../decisions/0016-bounded-repair-loop.md)（有界修复）、
[0018](../decisions/0018-current-change-routing.md)（current-change 路由）、
[0021](../decisions/0021-concurrent-write-protection.md)（并发写保护）、
[0024](../decisions/0024-scheduler-durability.md)（调度器持久性）、[0026](../decisions/0026-daemon-process-ownership.md)（进程归属）

## 0. 现在是什么样

P4 把 daemon 变成了交付流水线，但**并发与排序刻意没做**：一次只推一个任务、按计划文件顺序取
第一个 `queued`、没有优先级。这不是"方案就绪只是没排期"，而是方案本身没写——因为并发会把
下面四件事打穿，必须先补。

## 1. 四条前置条件与实施步骤

| # | 前置条件 | 不补的后果 | 状态 |
|---|---|---|---|
| C1 | **任务领取原子化** | 两个 daemon（CLI / serve 内嵌 / 不同机器）读到同一份队列，双双选中同一个任务，各跑一遍 agent | ✅ 已实施 |
| C1 | **change 级互斥** | 人手工 `change run G1-T1` 的同时 daemon 也在推它 → 两个 agent 改同一块代码 | ✅ 已实施 |
| C2 | **排序语义** | 顺序 = 计划文件顺序；`depends_on` 依赖图**已经存在但调度器完全没用** | ⬜ |
| C3 | **并发上限**（`--concurrency N`） | 想并行只能起多个 daemon → 回到 C1 的风险 | ⬜（**前置已完成**：单实例租约，见下） |
| C4 | **指针与写保护的配合** | 多 change 并发时 `current-change` 只能指一个，ADR 0018 的 fail closed 会拒掉 agent 的写入 | ⬜ |

### C1｜原子领取 + change 级互斥（已实施）

实现方式：

- **领取在锁内完成**：把"推导待办 → 选第一条 queued → 标 running（写租约）→ 落盘"整段放进
  `acquireLock(projectRoot, 'daemon claim')`。锁内**重新从事实推导**（不用内存里的旧队列），
  这样两个实例也不会选中同一条。
- **change 级互斥**：`runChange` 拿 `acquireLock(projectRoot, 'change run <name>')`，拿不到就立刻失败并说明
  持有者（`LockHeldError`），不排队等——与 ADR 0021 的立场一致。`verifyChange` **刻意不加锁**：
  它只读代码、跑确定性检查与只读 Verifier，唯一写入是 `verification.md`（最后写入者胜），
  而真正改状态的归档本来就有锁。锁的范围只覆盖"会改工作区的那一步"。

验收：两个并发循环（同一项目）不会跑同一条任务；同一个 change 被两个驱动者同时 `change run` 时，
第二次直接报锁被持有（拿到锁后立刻又跑得通，锁不是永久挡板）；全量测试与回归不回归。

### C2｜排序语义（待实施）

要定三件事，都从既有事实里取，不新增状态：

1. **依赖优先**：按 `task.depends_on` 做拓扑排序（依赖环在 `plan validate` 已拦），同层按计划顺序；
2. **goal 内串行 / goal 间可选并行**：goal 是天然的隔离单元（一个 goal 的任务通常落在同几个 module）；
3. **不引入优先级配置**：先不做"手动插队"，需要插队时用 `daemon queue retry` 把某条提到队首
   （或临时 `change` 手工跑）——等真实需求出现再设计优先级。

验收：`depends_on` 表达的顺序被遵守（用夹具构造 T2 依赖 T1）；同层顺序稳定；环不会死锁（validate 先拦）。

### C3｜并发上限（待实施）

**前置（2026-09-17 已完成）**：单实例租约 `runtime/daemon.lease.json`（心跳 10s / 过期 60s）+
serve 内嵌调度器（ADR 0027）。没有它，"并发"只能靠起多个 daemon 实现，而那是用户心智模型之外的形态；
有了它，并发才是"一个调度器内部跑 N 个任务"，`--concurrency N` 才有明确的语义边界。

- 新增 `daemon start --concurrency N`（默认 1）；并发单元先按 **goal**（一个 goal 同时最多一个任务），
  因为 goal 内的任务共享 spec 与 module，是最小可信的隔离粒度；
- 每个并发槽独立领取（复用 C1 的锁内领取）、独立预算结算、独立日志前缀（`daemon[slot-k]`）；
- 与写保护的配合见 C4。

验收：`--concurrency 2` 在两个 goal 上真的并行（用可注入 runner 记录并发度）；同一 goal 不会并行。

### C4｜指针与写保护（待实施）

- 多 change 并发时 `current-change` 指针只能指一个：要么按 spec 声明的 `module` 分区
  （写入守卫按 module 判定归属），要么在并发 > 1 时自动降级为"按 goal 串行 + 指针随活跃 change 切换"；
- 需要先写 ADR（扩展现有 0018 或新增），把"并发时的写入归属"讲清楚，再动代码。

## 2. 完成定义（DoD）

沿用既有惯例：①每步都有测试且覆盖失败路径（锁被持有、依赖成环、并发争抢）；
②与 CLI 同源；③`scripts/regression.mjs` 补场景；④`docs/USAGE.md` 与
[capability-map.md](./capability-map.md) 同步；⑤浏览器走查；⑥回填本文件与计划索引。

## 3. 明确不做

- 不引入外部队列/消息系统：调度状态继续留在项目目录里（可分发、可离线）；
- 不做抢占（preemption）：正在跑的 agent 会话不打断，`stop` 也是下一轮生效（ADR 0026）；
- 不做跨项目并发：那是工作区层的另一件事。
