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
| C2 | **排序语义** | 顺序 = 计划文件顺序；`depends_on` 依赖图**已经存在但调度器完全没用** | ✅ 已实施 |
| C3 | **并发上限**（`--concurrency N`） | 想并行只能起多个 daemon → 回到 C1 的风险 | ⚠️ 部分：准入与配置已就位，**执行仍串行**（见下） |
| C4 | **指针与写保护的配合** | 多 change 并发时 `current-change` 只能指一个，ADR 0018 的 fail closed 会拒掉 agent 的写入 | ✅ 决策完成（[ADR 0028](../decisions/0028-concurrency-policy.md)） |

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

### C2｜排序语义（已实施）

实现方式（不新增状态）：`QueueTask` 带上 `depends_on`，`mergeTodoView` 计算 `blocked_by`
（`depends_on` 里的任务尚未交付 = 有归档 change），`nextQueuedTask` 只挑 `blocked_by` 为空的条目。
界面在队列行上直接写「等待 T1 交付」，徽章给出「待交付 N（等依赖 M）」。

语义要点：

- **依赖的判据是"已交付"**（归档 change），不是"跑过"——与 S3 的交付定义一致；
- 依赖是链式的（T3 等 T2、T2 等 T1），逐层解锁；
- 环由 `plan validate` 先拦（已有），调度器不重复判断。

验收：`daemon-dependency.test.ts` 3 例（前序未交付 → 不被选中且标出在等谁、前序交付 → 自然可调度、链式全交付 → 队列排空）。

### C3｜并发上限（部分实施）

**已就位**：`--concurrency <n>` / `scheduler.concurrency` 的配置面与传递链（CLI → daemon → 内嵌调度器），
以及**明确的拒绝语义**：>1 时返回 `concurrency-not-open` 并说明原因与解除方式（ADR 0028），
**不静默降级**——静默降级会让"我开了并发"变成一句假话。

**未实施**：真正并行执行多个任务。它需要：并发槽位调度（同一 `spec_ref` 不并行）、
队列写入的进程内互斥（后写覆盖前写会丢状态）、以及 `stop/pause` 在并发下的收口语义（停止领取新任务、
等已领取的跑完）。这些都在 ADR 0028 的框架下，但属于独立一批。

### C4｜指针与写保护（决策完成，实现待守卫扩容）

ADR 0028 的结论：并发单元 = capability spec；**写保护守卫在位时不开放并发**（守卫按 current-change
指针 fail-closed，并发会让另一个 change 的写入被拒）。要让装了守卫的项目也能并发，前提是守卫支持
按 module 判定归属——那是守卫（ADR 0023）自己的扩容，不在本批。

### 单实例租约（C3 的前置，已完成）

`runtime/daemon.lease.json`（心跳 10s / 过期 60s）+ serve 内嵌调度器（ADR 0027）：
没有它，"并发"只能靠起多个 daemon 实现，而那是用户心智模型之外的形态；有了它，并发才有
"一个调度器内部跑 N 个任务"这个明确语义。

## 2. 完成定义（DoD）

沿用既有惯例：①每步都有测试且覆盖失败路径（锁被持有、依赖成环、并发争抢）；
②与 CLI 同源；③`scripts/regression.mjs` 补场景；④`docs/USAGE.md` 与
[capability-map.md](./capability-map.md) 同步；⑤浏览器走查；⑥回填本文件与计划索引。

## 3. 明确不做

- 不引入外部队列/消息系统：调度状态继续留在项目目录里（可分发、可离线）；
- 不做抢占（preemption）：正在跑的 agent 会话不打断，`stop` 也是下一轮生效（ADR 0026）；
- 不做跨项目并发：那是工作区层的另一件事。
