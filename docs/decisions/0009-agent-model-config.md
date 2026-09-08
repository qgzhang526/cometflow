# 0009 Agent 与模型配置分层

状态：已采纳（已实现 2026-09-07）
关联：008-client-visualization.md、ADR 0007、ADR 0008

## 背景

UI 的 change run / daemon 需要选择 agent（opencode / claude-code）与模型。当前 agent 默认值已从 `.cometflow/config.yaml` 读取（`domains/scheduler/flow-run.ts` 的 `resolveAgentId`），但 `model` 只在命令行 `--model` 临时传入、未持久化；且缺少统一的 config 读写服务。

## 决策

1. 配置三层：全局 `~/.cometflow/config.yaml`（默认值）→ 项目 `.cometflow/config.yaml`（覆盖）→ 单次运行参数（当次覆盖）。CLI 环境变量 `COMETFLOW_AGENT` 保持最高优先（仅 CLI 侧，现有行为）。
2. 新增 `domains/project/config.ts` 读写项目 config（schema `cometflow.project.v1`，与 init/migrate 既有 config.yaml 兼容）：`agent`、`model`、`agents.<id>.model`（可选）、`scheduler.{mode,intervalMs,budgetMs,idleCpuThreshold,scheduleStartMinutes,scheduleEndMinutes}`（可选）；同时保留既有字段 `default_workflow`、`plan_review`。
3. agent 取值必须通过 registry 校验（`builtInAgentRunners` 的 id 集合）；model 只存模型名。
4. 凭证/端点/密钥由 agent 工具自身配置（opencode.jsonc / CLAUDE.md / 环境变量）管理，CometFlow 不代管。

## 实现记录（2026-09-07）

- `domains/project/config.ts`：`readProjectConfig` / `writeProjectConfig` / `validateProjectConfig` / `resolveAgentId` / `resolveModel`，schema 使用 `cometflow.project.v1`。
- `resolveAgentId` 已从 `flow-run.ts` 迁入 config service；`flow-run.ts` re-export 保持向后兼容。
- `resolveModel` 接入 `app/commands/run.ts` 与 `app/commands/daemon.ts`（`--model` 覆盖 > 配置默认）。
- 测试：`test/domains/config.test.ts` 6 用例；全量 27 文件 77 用例通过。

## 后果

正面：

- UI 与 CLI 共享同一配置事实源；默认值可复用，单次覆盖灵活。
- 消除 `flow-run.ts` 内 ad-hoc 读 yaml 的散点逻辑。

负面：

- 新增 config service 与校验逻辑，多一层维护面。
- 配置三层中的「全局 ~/.cometflow/config.yaml」尚未实现；当前只落地项目层，serve 阶段再补全局层。
