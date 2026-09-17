# 0028 并发策略：并发单元从 spec_ref 到 module——守卫在位时按归属排除，冲突的串行

状态：已批准（2026-09-17；第三轮修订）
关联：[0018 current-change 路由](./0018-current-change-routing.md)、
[0021 并发写保护](./0021-concurrent-write-protection.md)、
[0023 写保护装进平台](./0023-platform-hook-install.md)、
[0027 内嵌调度器](./0027-embedded-scheduler.md)、
[scheduler-concurrency-plan.md](../plan/scheduler-concurrency-plan.md)（C3/C4）

> 阅读提示：下面的「决策」是**第一轮**的原文（当时的选择是"守卫在位就关闭并发"）。
> 两轮修订依次把它放宽：第二轮让守卫按 module 判归属，第三轮把准入从"整体开/关"
> 改成"领取时按 module 排除"。以文末两节修订为准。

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
| 写保护守卫（ADR 0023） | 第一轮的推论是"守卫在位 → 并发关闭"；第二、三轮分别改成"按 module 判归属"与"冲突的串行" |
| 任务依赖（C2） | 并发的准入还要满足依赖：`blocked_by` 非空的条目任何槽都不会领 |

## 实施记录（2026-09-17）

本条的**执行部分**已落地，两条约束都按上面执行：

| 机制 | 实现 |
|---|---|
| 并发单元 | `concurrencyUnit()`：`spec_ref`（起草类任务回退到 `capability`）；领取时用 `nextClaimableTask(tasks, unitsInFlight)` 跳过已被占用的单元 |
| 准入 | `checkConcurrencyGate()`：`--concurrency > 1` 时探测写保护守卫（`hookStatus` 支持且已安装的平台）；**第一轮**的行为是返回 `concurrency-not-open` 拒绝启动，第三轮改成返回 `{ unit, reason }`（见文末修订） |
| 队列写互斥 | 调度器内 `withQueueWrite()`（promise 链）串行化"改内存队列 + 落盘"，并发收尾不会互相覆盖 |
| 槽位 | 主循环按 `concurrency` 领取到满，`Promise.race` 等空槽；`stop`/`pause`/`needs-human` 只**停止领取**，已领取的槽跑完（不抢占） |
| 锁粒度 | `acquireLock` 新增 `scope`：`change run` 用 `change-run-<name>`（`runtime/locks/<scope>.lock`），**按 change 隔离**——项目级那把锁仍是"一次改多个文件"的事务锁（冻结/归档） |

实测（`daemon-slots.test.ts`，注入式 runner 记录同时运行数）：
两个 capability 各一条任务、`concurrency=2` → 观测到 **2** 并发；
同一 `spec_ref` 的两条任务、`concurrency=2` → 观测到 **1**（串行）。

### 修订（2026-09-17，第二轮）：守卫按 module 判归属，装了守卫也能并发

第一轮写的是"守卫在位时不开放并发"，理由是守卫只会**按 current-change 指针**判归属。
第二轮把这个前提去掉了：

1. **守卫扩容**（`hook-guard.ts`）：多个活跃 change 并存时**先按 module 判归属**——
   这次写入落在唯一一个 build 阶段 change 声明的 module 内，就归它（不需要指针）；
   只有当路径**不在任何 module 内**、或**同时落在多个 module 里**（module 互相包含）时，
   才回落到 current-change 指针与 fail closed。指针的角色从"唯一路由"变成"处理歧义"。
2. **准入放宽**（`daemon-concurrency.ts`）：装了守卫时不再一律拒绝，改为检查——
   每个待办**实现**任务的 spec 是否都声明了 `module`，且这些 module **两两不相交**
   （一个路径只能落在一个 module 里）。起草类任务不受这条约束（它写 `specs/`，走保护路径）。
   任一条件不满足 → 仍然拒绝，并指出差在哪（哪个任务没声明 module / 哪两个 module 互相包含）。

实测：

- `hook-guard-module.test.ts` 3 例：两个 build change 各写自己 module → 都放行；
  写在所有 module 之外 → 仍 fail closed（提示指向 module 与 `change select`）；
  module 互相包含（`src` vs `src/inner`）→ 回落到指针语义并拒绝。
- `daemon-slots.test.ts` 新增一例：**装了 claude-code 守卫、module 不相交 → 并发度仍是 2**。
- `daemon-dependency.test.ts` 的准入用例改为：装了守卫但 spec 没声明 module → 被拒，理由指到"补 module"。
- `current-change.test.ts` 的三个用例按新契约调整：module 内写入按 module 归属，
  路径不在任何 module 内时仍然 fail closed（指针缺失 / 指针失效两条路径都保留）。
- 回归：那一步从「装守卫时并发被拒」改成「装守卫且 module 不相交时并发被放行」，
  另保留一条「路径不在任何 module 内 → 拒绝归属不明的写入」（148 步）。

**仍未做**：goal 级排序与优先级、跨项目并发，以及 module 的**嵌套**并发
（现在嵌套一律视为归属歧义、必须串行——保守，但正确）。

### 修订（2026-09-17，第三轮）：module 是并发单元，冲突的任务串行而不是整体拒绝

第二轮把"守卫在位 → 并发关闭"放宽成"**全部**待办实现任务的 module 声明齐全且两两不相交
→ 才允许开并发"。它有个明显的不对称：**一条任务不合格就整体不许并发**。
现实里最容易撞上的正是这条——一个 capability 的两个任务共用一个 module（相等），
或者老计划 / 没写 front-matter 的 spec 没有 module，于是 `--concurrency 2` 直接不可用。

第三轮把准入的形态改掉：

1. **并发单元改成 module**（装了守卫时；没装守卫仍是 `spec_ref`）。判据是"路径归属是否唯一"：
   `a === b`（同一条路径落在两个 module 里）、互相包含（`src` vs `src/api`，嵌套部分落在两个
   module 里）、任一侧未声明（归属无从判断）——三种都算冲突。
2. **冲突表现为"领取时跳过"，不是"拒绝启动"**（`nextClaimableTask`）：第一条候选被占就继续
   往后看，让不同 module 的候选先跑。于是"同 module 串行、异 module 并行"是同一个调度器的
   正常形态，而不是一开一关的二选一。
3. **占用集合来自两处事实**：在飞 change 的账本（`listChangeStates` 里未归档的 module——
   含**人手工开的** change）叠上本进程已领取的槽（change 还没落盘的窗口）。
   候选人**自己的** change 不算冲突：那是"续作自己的活"。
4. **准入不再返回拒绝**：`checkConcurrencyGate()` 返回 `{ unit, reason }`，说明用哪个单元、
   哪些任务会因为没声明 module 而串行。`concurrency-not-open` 这个停止原因随之删除
   （CLI 也不再为它给非零退出码）。
5. 新增停止原因 `waiting-on-active-change`：没有槽在跑、候选全被在飞 change 的 module 挡住时，
   区分"队列空了"（正常收工）与"要等的 change 还没收尾"（要人去看：归档 / unblock / 让 module 不相交）。

**为什么不是"总是按 module 排除"**：没装守卫的项目继续按 `spec_ref` 去重。模块级排除的存在
理由是让守卫的归属判定无歧义；在没装守卫的项目里强加它，会把"没写 module 的项目"变成纯串行——
那是拿吞吐换一个不存在的风险（没有 fail-closed 的写入判定）。

实测（`daemon-modules.test.ts`，注入式 runner 记录同时运行数；装了 claude-code 守卫、`--concurrency 2`）：

| 场景 | 观测到的并发度 |
|---|---|
| 两个 capability 的 module 互不相交（`src/alpha` / `src/beta`） | **2** |
| module 互相包含（`src/core` / `src/core/deep`） | **1**（串行，两条都交付） |
| module 相同（两个 capability 都写 `src/shared`） | **1** |
| spec 没声明 module | **1**（归属不可判，按最坏情况独占） |
| 没装守卫 + module 嵌套 | **2**（排除只服务于守卫的归属语义） |

回归那一步的断言同步改成"装了守卫也能开并发（单元 = module，并点出会串行的任务）"，仍 148 步 PASS；
全量 `npx vitest run` 91 文件 / 538 例。

**仍未做**：goal 级排序与优先级、跨项目并发。
