# 一次性 agent 试跑入口（审计 C13）

状态：**已完成**（2026-09-16；端点 + 界面 + 测试 + 回归 + 文档全部落地）
来源：[web-ui-coverage-audit.md](./web-ui-coverage-audit.md) C13「无一次性 agent 会话入口」——`run` 未接线
关联：[005-cli-and-workflow](../design/005-cli-and-workflow.md)、ADR 0007（UI 只走 headless service）、
ADR 0021/0023（写保护与 hook guard）

## 1. 这条入口是什么

把 CLI 的 `cometflow run` 接到界面上。它是**唯一不绑 change / task / acceptance 的 agent 会话**：

- 提示词固定（[flow-run.ts](../../domains/scheduler/flow-run.ts) 的 `buildFlowPrompt`）：一句「你是 CometFlow，独立工作」
  + 整份 `COMETFLOW.md` + 四条指令（specs/ 是唯一事实源、有冻结计划就只做那些任务、
  只做有冻结计划或显式 acceptance 的工作、把决策写进 `reports/latest.md`）；
- 用选定 agent（opencode / claude-code / mock）在项目根目录跑，退出码即 agent 退出码；
- 没有 acceptance、没有 module 边界、不写验收账本。

所以它的定位是**试跑**：确认「agent + 这个项目的上下文」能不能跑通（读不读 spec、会不会乱写、
超不超时），而不是交付。2048 实验里的 `reports/g1-run.log` 就是它的产物——那次它还事实上承担了主交付，
也正是「试跑容易与交付混淆」的实例。

## 2. 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 长任务怎么跑 | 走既有 job 通道（202 + jobId + SSE 日志），job kind = `flow-run` | agent 会话可能几分钟到几小时，同步请求会挂死；与 `change run` / `eval` 同一套机制 |
| 默认 agent/模型 | 不传时取项目配置（`resolveAgentId` / `resolveModel`），与 CLI 同源 | 界面与 CLI 行为必须一致 |
| agent 白名单 | 未知 agent 直接 400，列出可选值 | 避免「运行了但什么都没发生」 |
| 提示框 | 二次确认，明确写出「不绑 change / task / acceptance，产物不进账本；写入不受 change 约束」 | 试跑 ≠ 交付，这句话是功能的一部分 |
| 写保护冲突 | 提示「多个活跃变更时可能被写保护守卫拒绝」 | `run` 让 agent 直接 Write/Edit，hook guard 会 fail closed，报错来自 Claude 而非 CometFlow |
| 日志 | 逐行写进 job（stdout 原样、stderr 加 `[stderr]` 前缀） | 与其它 job 一致，刷新页面不丢 |

## 3. 落点与待办

| 项 | 落点 | 状态 |
|---|---|---|
| 端点 | `POST /api/projects/<id>/run`（`{agent?, model?, timeoutMs?}` → 202 `{jobId, agent}`） | ✅ 已实现（`domains/server/api.ts`） |
| job kind | `'flow-run'`（`domains/server/jobs.ts`） | ✅ |
| 界面入口 | 设置面板「一次性试跑」卡片：agent 选择 + 模型（可留空）+ 试跑按钮 + 任务中心链接 + 说明文案 | ✅ |
| 测试 | `serve-jobs-api.test.ts`：`mock` agent → 202 + job 成功（校验 `kind=flow-run`、无 `change` 字段、日志含「不绑 change」与 agent 输出）；未知 agent → 400 + 可选值列表 | ✅ |
| 回归 | `scripts/regression.mjs` 加 `run --agent mock` 一步（CLI 侧） | ✅ |
| 文档 | USAGE §12.1 界面结构 / §12.2 端点表；审计 C13 转 ✅、§1 端点口径同步 | ✅ |
| 计划索引 | `docs/plan/README.md` 增一行 | ✅ |

## 4. 完成定义（DoD）

沿用既有惯例：①端点有测试且覆盖失败路径；②与 CLI 同源（同一份 `runFlowRun`）；③回归补场景；
④`docs/USAGE.md` 同步；⑤浏览器走查（跑一次 mock 试跑，日志在任务中心可见）；⑥回填本文件与计划索引状态。

## 5. 明确不做

- 不做「试跑结果自动转为 change / 任务」：那会把两条路径混起来，正是本入口要防的；
- 不做 bundle 分发（审计 C12）：按用户决定留到后续版本。
