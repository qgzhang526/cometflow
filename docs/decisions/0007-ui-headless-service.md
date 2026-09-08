# 0007 UI 客户端通过 headless service 访问领域

状态：提议（2026-09-07）
关联：008-client-visualization.md、005-cli-and-workflow.md、006-roadmap.md

## 背景

用户希望把 CometFlow 的 CLI 工作流可视化：目标（COMETFLOW.md）→ 计划拆解（generate/validate/review/approve/freeze）→ change 执行（new/run/verify/archive）→ 进化与评估。当前 CLI 命令是领域服务（domains/*）的薄封装，dashboard 只读。

若让网页/TUI 各自直接 import domains，或解析 CLI 的 console.log 文本，会产生两套调用逻辑和脆弱的输出契约。

## 决策

1. 引入 headless service `cometflow serve`（REST + SSE + Job），Web/TUI 客户端只通过 serve 访问领域。
2. serve 与 CLI 共用 domains/* 领域服务，不复制业务逻辑；现有 `domains/dashboard/server.ts` 作为 serve 的种子实现。
3. 客户端不解析 CLI 文本输出；命令的结构化返回（JSON envelope）与 serve 响应共享同一投影函数。
4. COMETFLOW.md 仍是目标唯一人类事实源；UI 的「添加目标 / 编辑总体目标」通过写回 Markdown + `goal sync` 实现，不建立平行数据库。
5. 长任务（plan generate 的未来 LLM 版、change run、eval、evolve verify）统一为 job：提交 → 202 + jobId → SSE 推送日志/进度 → 取结果。

## 后果

正面：

- CLI、Web、TUI 行为一致，共用同一套状态文件，可互相切换。
- serve 可独立测试、可脚本化，未来可扩展多项目与团队视图。
- UI 不依赖命令文案，命令改输出格式不破坏 UI。

负面：

- 需要维护 serve 层与 job/SSE 基建，增加复杂度。
- 文件型状态带来并发写问题（MVP 限定单用户/单写者）。
- 写操作具备「触发 agent 修改代码」的能力，必须本地绑定 + token + 二次确认。
