# 0029 调度顺序：显式清单优先，编号兜底

状态：已批准（2026-09-18）
关联：[0024 调度器持久性](./0024-scheduler-durability.md)、
[0026 进程归属](./0026-daemon-process-ownership.md)、
[0027 内嵌调度器](./0027-embedded-scheduler.md)、
[0028 并发策略](./0028-concurrency-policy.md)、
[scheduler-concurrency-plan.md](../plan/scheduler-concurrency-plan.md)（C6）

## 背景

并发（C1–C5）解决的是"能同时跑几个"，**先跑哪个**这条线一直是空的：

1. 顺序来自 `readPlans` 的**文件名字典序**——plan 文件是 `<goal>.task-plan.yaml`，
   于是 `G10.task-plan.yaml` 排在 `G2` 前面（`"G10." < "G2."`）。这是一个真缺陷，不是风格问题。
2. goal 之间没有任何"谁先"的表达能力。`depends_on`（C2）只管**同一个 goal 内部**的任务；
   想让 G7 排在 G3 前面，除了改文件名没有别的办法。
3. 于是"顺序"这件事既不可读（要自己在脑子里按文件名排序）也不可改（改了名字等于改了身份）。

## 决策

### 1. 顺序写成 COMETFLOW.md 里的一处显式清单

```markdown
## 调度顺序

- G3
- G7
- G2
```

规则四条：

| 情形 | 行为 |
|---|---|
| 列在清单里 | 按**清单顺序**跑（位置即顺序） |
| 没列出 | 按 goal **编号升序**兜底，排在所有列出者之后 |
| 列了不存在的 goal | `goal sync` / 调度读取时给 warning，忽略该行（不静默吞掉拼写错误） |
| 同一个 goal 列了多次 | 只认第一次，给 warning |

`## 调度顺序` 与 `## 模块归属` 同类：COMETFLOW.md 里**给人看、也给机器读**的结构化段落。
顺序不写数字、不写等级——**位置天然唯一**，不存在"两个 goal 优先级相同怎么办"，
也不存在"这个 0 到底是最低还是最高"的歧义。

### 2. 已完成 / 新加入的 goal 都不需要动

- **已完成**：交付由 change 账本判 `done`，`nextClaimableTask` 只挑 `queued`——
  已交付的 goal 不参与领取，它在清单里的位置对调度**完全无效**。留着无害，删掉更清爽。
- **新加入**：追加到 COMETFLOW.md 末尾、不写进清单即可，它自然排在所有列出者之后。
  要让它插队，就把它挪到清单第一行：一次挪动，diff 里看得见。

### 3. 不冻进 plan

顺序在**读取时**生效（`deriveTodoList` 每次推导都重读 COMETFLOW.md），`plan freeze` 不记录它。
理由是优先级/顺序是"我此刻想先做哪个"，不是 goal 的契约内容；冻进 plan 会把"挪一行顺序"
升级成"重冻结"（连带 `plan_hash`、spec 基线、change 的 CAS）。与 `module`（冻进 plan、
因为它是写入边界的契约）刻意不同。

### 4. 不抢占，也不越过准入

顺序只在**本来就能领的候选**里决定谁先领。`blocked_by`（依赖未满足）与
module 归属排除（ADR 0028）**优先于**顺序；已经在跑的槽不会被顺序变化打断（ADR 0026）。

### 5. 判据是编号数字，不是文件名字典序

兜底排序把 `G10` 解析成 10，所以 `G2` 在 `G10` 之前。非 `G<数字>` 形态的 goal id
（手写计划）排在数字之后，同类之间按字符串比较——保证**全序**：任何两个 goal 的先后都确定，
不依赖 `readdir` 顺序、文件系统、也不依赖 `queue.json` 覆盖行的排列。

## 后果

正面：

- 顺序**可读**：一处清单就是当前执行顺序，不用在脑子里按文件名排序；
- 顺序**可改**且 diff 友好：挪一行，读者一眼看到意图变化；
- 新旧 goal 零维护：新加的不写就是末位，做完的不动就是惰性；
- 顺带修掉 `G10` 排在 `G2` 前面这个真缺陷。

代价与边界：

- 多了一处"必须与 goal id 对齐"的文本：`goal sync` 与调度读取都会给 warning，但格式错误
  本身不会让调度失败（坏行忽略，其余照常）；
- 顺序是**项目级**的，没有"每台机器不一样"的本地覆盖——真要做本机临时插队，
  走运行时覆盖（`queue.json` 的 overlay），而不是在 COMETFLOW.md 里写两套；
- 不做跨 goal 依赖（`depends_on: G2:T1`）：那是另一个特性，本轮不做。

## 与既有机制的关系

| 机制 | 关系 |
|---|---|
| 依赖排序（C2） | 正交：依赖是**硬门槛**（未交付不领），顺序是**门槛内的先后** |
| 并发单元 / module 排除（C3–C5） | 正交：并发决定"能几个"，顺序决定"先谁"；冲突时先跳过、先跑能跑的 |
| 单实例租约（ADR 0027） | 无关：顺序在一个调度器内部生效 |
| 队列推导（S3） | 顺序属于**推导**的一部分：`queue.json` 仍是覆盖 + 快照，不携顺序意图 |

## 实施记录（2026-09-18）

| 落点 | 实现 |
|---|---|
| 解析 | `domains/goal/schedule-order.ts`：`parseScheduleOrder()`（段落 + bullet + 未知/重复 warning）、`scheduleRank()` / `compareGoals()`（位置优先、编号兜底、全序）、`readScheduleOrder()`（读 COMETFLOW.md，**不读** goal 投影） |
| 推导 | `deriveTodoList()` 先按 goal 排序再展开任务（`readPlans` 的字典序只剩"文件读取顺序"这个无关角色）；`TodoView.order` 带上本次用的清单 |
| 回显 | `goal sync` 打印 `调度顺序：…` + warning；`daemon queue rebuild/reset` 打印同一行并给每行加 `#N`；`GET /scheduler/queue` 返回 `order` |
| 界面 | 调度面板新增「调度顺序」卡（显式清单 + 规则 + warning），队列内容表新增「顺序」列 |

验证：

- `goal-schedule-order.test.ts` 7 例：清单顺序 / 无段落 / 未知 id / 重复 / `- G3：说明` 与 `* G3` /
  `G2` 在 `G10` 之前 / 全序确定性；
- `daemon-order.test.ts` 4 例（注入式 runner 观测**领取顺序**）：清单顺序生效、未列出的排最后、
  无清单时按编号（旧实现会把 `G10` 插到 `G2` 前）、已交付 goal 不占位；
- 回归补 4 步（`goal sync` 与 `daemon queue rebuild` 打印同一份顺序）→ **152 步 PASS**；
  全量 `npx vitest run` **95 文件 / 553 例**；`tsc` / `vue-tsc` / `pnpm build` / `pnpm package-e2e` 全通过；
- 浏览器走查（真实 serve + 合成项目，`## 调度顺序` 写 `G3 → G1`）：调度面板显示「显式 2 个」与
  `G3 → G1 → 其余按编号升序`，队列内容表的「顺序」列为 `#1 G3 / #2 G1 / #3 G2 / #4 G4`，控制台无 error。
