# P4 Workflow 深度融合：让 daemon 驱动 change 生命周期

状态：**S1–S4 已实施**（2026-09-17，分支 `codex/daemon-drives-change`；实施结果见 §7）
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
  `runChange` → `verifyChange` →（verify 通过）`archiveChange`；
- **change 名由任务派生**：`<goal>-<task>`（如 `G1-T1`），确定性命名让失败重试与断点续作落在同一个
  change 上，而不是每次重开一个。已存在的 change 按它的 `phase` 续作（shape → build → verify → archive）；
  已 `archived` 的直接视为已交付，不再重跑；
- 「完成」由 acceptance 结论决定，不再由退出码决定；队列状态仍写，但含义变成「调度视角的执行结果」；
- spec-authoring 任务沿用 G4 的护栏（产物存在 + `spec validate` 无 error）；
- **过渡止血（原 B 方案的最小版）**：`daemon queue rebuild|reset`（CLI + 端点），把今天「手工删
  `.cometflow/runtime/queue.json`」升级成有语义的命令——`rebuild` 按事实重算待办并保留运行时覆盖，
  `reset` 清掉覆盖（显式要求全部重跑）。

验收：夹具上 daemon 跑完一个任务后 —— 存在对应 change 且 `archived=true`；`verification.yaml`
里有 acceptance 结论；`queue.json` 该任务为 `done`；调度卡（C5）能看到该任务的 change 与 phase。

### S2｜异常路径自动化

- verify 失败 → 有界修复循环（ADR 0016 的 `repair_attempts` / `verdict_hash` 已实现，这里只是由 daemon 驱动）；
- 连续失败到上限 → change 置 `blocked`、队列任务 `failed`、daemon 停下并交人工；
- spec 冲突（`SpecConflictError`）→ 停在 archive 前，记录「需要人选 rebase 还是 reconciliation」，不静默覆盖。

验收：注入三类失败（验收不过 / 反复失败 / spec 漂移），各自的终止状态与人工出口在日志、change 状态、
调度投影三处都可见。

### S3｜三份记录对齐 + 队列可重置

- **已定：队列降级为「派生待办 + 运行时覆盖」的混合体**（§4 第 1 条的结论）。三份记录各归其位：

  | 问题 | 唯一出处 |
  |---|---|
  | 这个任务该不该跑 | **派生**：plans 里 `frozen`/`approved` 的任务，减去已有 `archived` change 的 `(goal, task)` |
  | 这个任务交付了吗 | **change 账本**（`archived: true` + `verification.yaml` 的 acceptance 结论） |
  | 谁在跑、租约、试了几次、上次为什么失败 | **运行时覆盖**（`.cometflow/runtime/queue.json` 瘦身为此） |

- **队列重建/重置**：`daemon queue rebuild|reset`（CLI）与对应端点。`rebuild` = 重新派生 + 保留覆盖；
  `reset` = 清掉覆盖（全部重新排队）。
- **迁移（必须显式，不能默认）**：老路径交付过的任务（如 2048 的 G1~G3：agent 直接跑出来、
  没有 change 目录）在派生视图里会显示"未交付"。`rebuild` **默认保留**运行时覆盖里的 `done`
  当作 legacy 交付记录（不重跑），需要重跑时用 `reset` 显式清掉；本文件记录这个取舍。
- 「同一任务被两条通道跑」在 A 之下变成互斥：daemon 跳过已有 `archived` change 的任务；
  想重跑必须显式动作（`reset` 或新开 change 承载）。

验收：`daemon queue rebuild` 之后，已交付任务不会被重新入队；调度卡能区分「交付过」与「跑过」。

### S4｜界面并列两个状态 + 决定进程生命周期归属

- 调度面板按任务并列显示：调度状态（queued/running/done/failed + 尝试次数）与工作流状态
  （change 名、phase、verify 结论、是否有 blocked 原因）；
- **进程生命周期归属（已定，见 §4 第 2 条）**：**进程仍由 CLI 持有**（`daemon start` 是唯一 spawn 点），
  但控制语义通过**控制文件** `.cometflow/runtime/daemon.control.json` 受管：`daemon pause|resume|stop`
  写它，daemon 循环每轮读它（`stop` → 退出并写 `stopped_reason`；`pause` → 只跳过不退出）。
  这样「界面可控」不必让 serve/浏览器成为进程主人，也避免 spawn 游离进程。
- 界面上提供：暂停 / 继续 / 停止（写控制文件，不是启停进程）+ 每行任务的 change 名、phase、
  verify 结论与 blocked 原因。

验收：P4 原文的「status 同时显示调度与工作流状态」在界面上可见；进程生命周期的归属在一份 ADR 里写死。

## 4. 决策记录（2026-09-17 拍板，施工按此执行）

| # | 问题 | 决定 | 理由 |
|---|---|---|---|
| 1 | 队列是事实源还是派生视图 | **目标 A：派生待办 + 运行时覆盖**；过渡期先给 `queue rebuild|reset`（B 的最小版）止血 | 「做完没有」只能有一个出处；派生视图可做同源断言，事实源不能。过渡命令是纯增量，不锁死方向 |
| 2 | daemon 进程由谁持有 | **进程归 CLI，控制语义走控制文件**（pause/resume/stop），界面只写控制文件不 spawn | 「谁持有进程生命周期」必须有明确答案；控制文件让界面可控而不引入游离进程 |
| 3 | 并发上限与排序 | **单任务串行**：一次只推进一个 change，按队列顺序；并发与优先级留给后续批次（需先有指针路由与预算策略） | 先让交付链正确，再谈吞吐；并发在写保护 + current-change 指针未成体系前会互相踩 |
| 4 | 计划侧要不要 `done` | **不要**：交付事实由 change 账本回答 | 避免第四份状态；任务「有没有被交付」是 `changes/*` 的函数，不是 plan 的函数 |
| 5 | 冻结是否允许跳过 review/approve | **保持现状（允许）**，但把它写进 USAGE 而不是让界面单独拦 | 冻结在语义上是「绑定契约」，review/approve 是审核策略；两者独立，改语义要单独立项，不在本批扩大范围 |

## 5. 完成定义（DoD）

沿用既有惯例：①每步都有测试且覆盖失败路径；②与 CLI 同源（同一份领域函数，不复制判定）；
③`scripts/regression.mjs` 补场景；④`docs/USAGE.md` 与 [capability-map.md](./capability-map.md) 同步；
⑤浏览器走查；⑥回填本文件与 `docs/plan/README.md` 状态列。

## 6. 明确不做

- 不做 Classic 工作流的调度接入（Classic 已按决策退出界面，见审计 C10）；
- 不引入第四份状态：S3 优先「队列降级为派生视图」，而不是新增一份"交付记录"；
- 不在本批做 LLM 智能拆解（ADR 0007 仍列为未来项）。

## 7. 实施结果（2026-09-17）

| 项 | 落点 | 验证 |
|---|---|---|
| S1 交付通道 | 新增 `domains/scheduler/daemon-run-change.ts`：`goal-task` 确定性命名、按 phase 续作、已归档即跳过；daemon 循环改用它，队列行带 `change`/`verdict`，状态投影带 `last_task.change/verdict/detail` | `daemon-drives-change` 4 例（交付归档并对账、失败重试到上限、spec 存续期被改→冲突停机、验收不过重试）；回归 145 步 |
| S1 顺带修复 | `runChange` 把 `model` 与 `timeoutMs` 传给 runner——此前 build 链路完全忽略模型配置与单任务超时（挂起的 agent 会永久阻塞 daemon） | `scheduler-durability` 断言超时被传下去 |
| S2 异常路径 | 三类结论都带人工出口：验收不过（重试 + verification.md 路径）、blocked（`change unblock` 提示）、spec 冲突（rebase 或 reconciliation，ADR 0004）；blocked/冲突直接停机 | 单测断言 detail 文案 + 停机状态 |
| S3 派生待办 | 新增 `daemon-todo.ts`：`mergeTodoView`（change 账本 > 运行时覆盖 > 计划推导）、`rebuildQueue`（保留 legacy done）、`resetQueue`（清覆盖）；`queue.json` 降级为覆盖+快照；CLI `daemon queue rebuild\|reset` + 两个端点 | `daemon-todo` 5 例 + serve 端点 1 例；`next` 语义随之更新（交付过的会被跳过） |
| S3 不重复干活 | 同一任务上已有别的 change（非 daemon 命名）→ 标「在飞」并让开；daemon 自己的未归档 change → 保持待办并续作（崩溃恢复不丢） | `daemon-todo` 用例覆盖两种情况 |
| S4 控制语义 | 新增 `daemon-control.ts` + ADR 0026：进程归 CLI，`pause\|resume\|stop` 写控制文件，循环每轮读；CLI 三条命令 + `POST /scheduler/daemon/control`；面板加控制按钮 | `daemon-control` 3 例 + serve 端点 1 例 |
| S4 两态并列 | `GET /scheduler/queue` 的 `tasks` 每行带 `source`（计划推导/运行时记录/交付账本）与 `workflow`（change 名、phase、是否归档、blocked）；面板把这两个视角并成两列 | 浏览器走查（见 §8） |

## 8. 验证链（本批实测）

| 命令 | 结果 |
|---|---|
| `npx vitest run` | **84 文件 / 501 例全绿** |
| `node scripts/regression.mjs` | **145 步 PASS**（新增 10 步：队列重建、控制文件生效、驱动一次真实交付） |
| `tsc --noEmit` / `vue-tsc --noEmit` / `pnpm build` / `pnpm package-e2e` | 全部通过 |
| 浏览器走查 | 调度面板：控制按钮 + 来源列 + 交付列（change/phase/已归档）渲染正常，控制台无 error |

与计划的偏差一处，按代码事实记录：**S1 的「change 名由任务派生」还额外承担了「区分谁在干」的职责**——
非 daemon 命名的活跃 change 被视为「别人在干」，daemon 让开（否则两条通道会同时改同一块代码）。
这一条在 §3 S3 里只写了「跳过已归档」，实现时按「避免重复劳动」的动机补全。
