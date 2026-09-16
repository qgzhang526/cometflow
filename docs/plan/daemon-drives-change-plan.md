# P4 Workflow 深度融合：让 daemon 驱动 change 生命周期

状态：**计划（未实施）**——2026-09-17 立项，分支 `codex/daemon-drives-change`
来源：[006-roadmap.md](../design/006-roadmap.md) 的 **P4「Workflow 深度融合」**
关联：ADR [0013](../decisions/0013-verification-must-be-executable.md)（验收必须可执行）、
[0016](../decisions/0016-bounded-repair-loop.md)（有界修复循环）、
[0018](../decisions/0018-current-change-routing.md)（current-change 路由）、
[0021](../decisions/0021-concurrent-write-protection.md)（并发写保护）、
[0024](../decisions/0024-scheduler-durability.md)（调度器持久性）、
[capability-map.md](./capability-map.md)（现能力地图）

## 1. 现状证据（这轮讨论里逐条查过）

006 的 P4 原文要求四件事：**每个冻结任务创建一个可恢复 Change / Native·Classic 接入执行 /
status 同时显示调度与工作流状态 / 报告包含 verification 结果**。今天一件都没做，证据如下：

| # | 事实 | 出处 |
|---|---|---|
| 1 | daemon 对 workflow **零引用**（`runChange` / `createChangeFromTask` / `transition` / `verifyChange` / `archiveChange` / `current-change` 一个都没有），它只 import budget / flow-run / idle-governor / git-safety / queue / daemon-state | `domains/scheduler/daemon.ts` |
| 2 | daemon 的执行体是 `runFlowRun`——与 `cometflow run` **同一条无绑定会话**（固定提示词 + 整份 COMETFLOW.md + 「有 frozen plan 就只做它的任务」的软约束） | `domains/scheduler/flow-run.ts` |
| 3 | daemon 判断任务成不成，只依据 **agent 退出码**：`done` / `failed`，没有 acceptance 判定、不跑 Verifier | `runDaemonLoop` |
| 4 | `runChange` 全仓库只有两个调用者：CLI `change run` 与 `POST /changes/<name>/run` | `app/commands/change.ts`、`domains/server/api.ts` |
| 5 | 队列来源：没有 `queue.json` 时按 plans 里 `frozen` / `approved` 的任务推导；**有则一律用那份文件**（粘性，任务跑过就不再重跑） | `domains/scheduler/queue.ts` |
| 6 | `TaskStatus` 只有 `draft / validated / approved / frozen / cancelled`——**没有 `done`**；`writeTaskPlan` 的调用者全是计划相关命令与端点，**没有任何 workflow 代码回写计划** | `domains/task-plan/types.ts`、`domains/task-plan/task-plan-store.ts` |
| 7 | daemon 是**排空即退出**：队列无 `queued` 任务就 `break`，预算耗尽也 `break`；CLI 只有 `daemon start` 与 `daemon budget`，没有 pause/resume/stop/reset-queue | `runDaemonLoop`、`app/cli/index.ts` |

由 5/6/7 直接推出的两个真实缺口（这轮讨论确认过）：

- **队列不可重建/不可重置**：想让跑过的任务重跑，今天只能手工删改 `.cometflow/runtime/queue.json`；
- **计划侧永远显示 `frozen`**：一次交付（change 归档）不会在计划或队列以外留下事实，
  于是「两条通道互不知情」——同一个任务既可能被 daemon 跑过又被 change 交付过，也可能被重复跑。

## 2. 目标形态

daemon 从「把 agent 叫起来的批处理泵」升级为**交付流水线**：取任务 → 自动建 change → 执行 →
独立验收 → 归档 → 回写「这个任务已交付」。人手动的 `change` 命令仍然保留，但角色从主路径
变成**干预/调试通道**（rebase、reconciliation、unblock、select 这些异常路径天然需要人）。

一句话验收：**daemon 报 `done` 的任务，必须能指出它对应的 change、它的 acceptance 结论、
以及它归档时应用了哪一版 spec。**

## 3. 分步实施（每步独立可验、可停）

### S1｜让 daemon 走 change 流水线（最小可用）

- 取到队列任务后：`createChangeFromTask`（自动设 current-change 指针）→ `confirm-acceptance` →
  `runChange` → `verifyChange` → `archiveChange`；
- 「完成」由 acceptance 结论决定，不再由退出码决定；队列状态仍写，但含义变成「调度视角的执行结果」；
- spec-authoring 任务沿用 G4 的护栏（产物存在 + `spec validate` 无 error）。

验收：夹具上 daemon 跑完一个任务后 —— 存在对应 change 且 `archived=true`；`verification.yaml`
里有 acceptance 结论；`queue.json` 该任务为 `done`；调度卡（C5）能看到该任务的 change 与 phase。

### S2｜异常路径自动化

- verify 失败 → 有界修复循环（ADR 0016 的 `repair_attempts` / `verdict_hash` 已实现，这里只是由 daemon 驱动）；
- 连续失败到上限 → change 置 `blocked`、队列任务 `failed`、daemon 停下并交人工；
- spec 冲突（`SpecConflictError`）→ 停在 archive 前，记录「需要人选 rebase 还是 reconciliation」，不静默覆盖。

验收：注入三类失败（验收不过 / 反复失败 / spec 漂移），各自的终止状态与人工出口在日志、change 状态、
调度投影三处都可见。

### S3｜三份记录对齐 + 队列可重置

- **交付事实**：任务交付后要有可查的去处。两个候选——(a) 计划侧引入 `done`；
  (b) 队列降级为**派生视图**（每次从 plans + changes 重建），用 change 账本作为唯一事实。
  倾向 (b)：避免第四份状态，但需要先确认「重建队列」不会把已交付任务重新排上。
- **队列重建/重置**：`daemon queue rebuild|reset`（CLI）与对应端点，替代今天手工删文件；
- 明确「同一任务被两条通道跑」的语义：要么互斥（daemon 跳过已有 archived change 的任务），要么显式允许并在界面标注。

验收：`daemon queue rebuild` 之后，已交付任务不会被重新入队；调度卡能区分「交付过」与「跑过」。

### S4｜界面并列两个状态 + 决定进程生命周期归属

- 调度面板按任务并列显示：调度状态（queued/running/done/failed + 尝试次数）与工作流状态
  （change 名、phase、verify 结论、是否有 blocked 原因）；
- **先决问题**：daemon 是 CLI 长驻进程，要「页面可控」就得先决定谁持有它的生命周期
  （serve 内嵌调度器 / 受管子进程 / 维持 CLI + 只读投影）。这一条不决策，界面上的启停按钮就是在
  spawn 游离进程，日志与退出都无处安放。

验收：P4 原文的「status 同时显示调度与工作流状态」在界面上可见；进程生命周期的归属在一份 ADR 里写死。

## 4. 待决问题（实施前需要拍板）

| # | 问题 | 影响 |
|---|---|---|
| 1 | 队列是事实源还是派生视图？（S3 的 a/b） | 决定「重复执行」能不能被机制消掉 |
| 2 | daemon 进程由谁持有？（S4） | 决定「前端可控」能不能做、怎么做 |
| 3 | 并发上限与排序：同一项目允许多少 change 并行、goal 之间的优先级怎么定 | 决定写保护指针与预算策略 |
| 4 | 计划侧要不要 `done`，还是用 change 账本回答「做完没有」 | 影响 capability-map 里「主链路自验」的写法 |
| 5 | 冻结是否仍允许跳过 review/approve（CLI/HTTP 今天不拦，只有界面拦） | 与 P4 同批定，避免又一条「界面约定 ≠ 机制约束」 |

## 5. 完成定义（DoD）

沿用既有惯例：①每步都有测试且覆盖失败路径；②与 CLI 同源（同一份领域函数，不复制判定）；
③`scripts/regression.mjs` 补场景；④`docs/USAGE.md` 与 [capability-map.md](./capability-map.md) 同步；
⑤浏览器走查；⑥回填本文件与 `docs/plan/README.md` 状态列。

## 6. 明确不做

- 不做 Classic 工作流的调度接入（Classic 已按决策退出界面，见审计 C10）；
- 不引入第四份状态：S3 优先「队列降级为派生视图」，而不是新增一份"交付记录"；
- 不在本批做 LLM 智能拆解（ADR 0007 仍列为未来项）。
