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
| C3 | **并发上限**（`--concurrency N`） | 想并行只能起多个 daemon → 回到 C1 的风险 | ✅ 已实施（两条约束：无守卫 + 不同 spec_ref） |
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

### C3｜并发上限（已实施）

**已实现**：

- **槽位领取**：主循环按 `concurrency` 领到满，`Promise.race` 等空槽；`stop` / `pause` / `needs-human`
  只停止领取，已领取的槽跑完（不抢占）；
- **并发单元去重**：`concurrencyUnit()` = `spec_ref`（起草类任务回退到 capability），
  同一单元已在跑时这一轮不领它——同一份契约/模块不会被两个 agent 同时改；
- **准入**：`--concurrency > 1` 时探测写保护守卫，装了则**拒绝启动**并说明解除方式（ADR 0028）；
- **队列写入互斥**：`withQueueWrite()` 串行化"改内存队列 + 落盘"，并发收尾不会互相覆盖；
- **锁粒度**：`change run` 的锁改成 per-change scope（`runtime/locks/change-run-<name>.lock`），
  不同 change 可以并行跑——这一点是被 `daemon-slots` 的并发用例逼出来的（项目级一把锁会把它们排成串行）。

**验证**：`daemon-slots.test.ts` 用注入式 runner 记录"同时运行数"：
两个 capability 的任务 → 观测到 2；同一 spec_ref 的两条任务 → 观测到 1（串行）；
回归新增一步：装了守卫时 `--concurrency 2` 被拒（标记 `concurrency-not-open`）。

**仍未做**：写好方案里提到的"按 goal 排序 / 优先级 / 抢占"，以及装了守卫时的并发
（需要守卫支持按 module 归属，落点在 ADR 0023 的守卫本体）。

### C4｜指针与写保护（已实施：守卫按 module 判归属）

第一轮：ADR 0028 把策略定成"守卫在位时不开放并发"（守卫只会按 current-change 指针判归属）。
第二轮把守卫本体扩了容（[ADR 0028 修订](../decisions/0028-concurrency-policy.md)）：

- 守卫**先按 module 判归属**：写入落在唯一一个 build change 的 module 内 → 归它，不需要指针；
  路径不在任何 module 内、或同时落在多个 module 里 → 回落到指针与 fail closed；
- 准入随之放宽：装了守卫时，只要每个待办实现任务的 spec 都声明 `module` 且两两不相交，并发照开；
- 指针的职责从"唯一路由"变成"处理歧义"，`.cometflow/current-change.json` 仍在、语义更窄。

验证：`hook-guard-module.test.ts`（module 归属/歧义/未认领三种）、`daemon-slots.test.ts`
（装了守卫仍观测到并发 2）、`current-change.test.ts`（三条用例按新契约调整）、回归 148 步。

**仍未做**：module 嵌套的并发（嵌套视为歧义，必须串行）、goal 级优先级、跨项目并发。

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
