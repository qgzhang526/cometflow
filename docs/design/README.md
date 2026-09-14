# CometFlow 设计文档

状态：**已批准，实施前基线**  
批准日期：2026-09-01  
项目名：CometFlow（中文候选名：恒彗）

## 文档索引

| 文档 | 内容 |
|---|---|
| [001-overview.md](./001-overview.md) | 项目定位、融合原则、目标架构 |
| [002-spec-driven-kernel.md](./002-spec-driven-kernel.md) | Spec 内核、目录布局、单一事实源 |
| [003-task-planning.md](./003-task-planning.md) | 任务拆解、任务与 spec 关联、审核与纠错 |
| [004-spec-change-impact.md](./004-spec-change-impact.md) | spec 变更对已完成任务的影响 |
| [005-cli-and-workflow.md](./005-cli-and-workflow.md) | CLI 命令与执行流程 |
| [006-roadmap.md](./006-roadmap.md) | 分阶段实施路线 |
| [007-evolution-review-workflow.md](./007-evolution-review-workflow.md) | Evolve 评审与终态工作流 |
| [008-client-visualization.md](./008-client-visualization.md) | 客户端可视化（serve + Web UI）架构 |
| [009-spec-artifact-taxonomy.md](./009-spec-artifact-taxonomy.md) | Spec 工件分类（kind 模型）与事实所有权 |
| [010-init-scaffolding.md](./010-init-scaffolding.md) | Init 按项目类型裁剪生成 spec kind |
| [011-spec-versioning.md](./011-spec-versioning.md) | Spec 版本管理、anchor 级影响分析与代码重建 |
| [012-comet-borrowings.md](./012-comet-borrowings.md) | 从 comet 借鉴的机制与落地评估 |

## 决策记录

| ADR | 决策 |
|---|---|
| [0001-spec-single-source.md](../decisions/0001-spec-single-source.md) | 项目级 spec 是唯一事实源 |
| [0002-task-spec-association.md](../decisions/0002-task-spec-association.md) | 任务与 spec 关联发生在拆解与冻结阶段 |
| [0003-plan-review-policy.md](../decisions/0003-plan-review-policy.md) | 拆解审核三档策略 |
| [0004-spec-change-reconciliation.md](../decisions/0004-spec-change-reconciliation.md) | 已完成任务不可变，spec 变更走 reconciliation |
| [0005-goal-source-markdown-first.md](../decisions/0005-goal-source-markdown-first.md) | 任务目标以 Markdown 为人类事实源 |
| [0006-evolution-review-states.md](../decisions/0006-evolution-review-states.md) | Evolve 提案 approved/rejected 终态与评审命令 |
| [0007-ui-headless-service.md](../decisions/0007-ui-headless-service.md) | UI 通过 headless service 访问领域 |
| [0008-workspace-project-model.md](../decisions/0008-workspace-project-model.md) | serve 采用工作区 + 项目注册表，支持多项目 |
| [0009-agent-model-config.md](../decisions/0009-agent-model-config.md) | Agent/模型配置分层，凭证不代管 |
| [0010-spec-artifact-kind-model.md](../decisions/0010-spec-artifact-kind-model.md) | Spec 工件分类（kind 模型），project=COMETFLOW.md |
| [0011-init-kind-scaffolding.md](../decisions/0011-init-kind-scaffolding.md) | Init 按项目类型裁剪生成 spec kind |
| [0012-spec-version-as-artifact.md](../decisions/0012-spec-version-as-artifact.md) | spec 内容是可寻址产物，版本引用可回放 |
| [0013-verification-must-be-executable.md](../decisions/0013-verification-must-be-executable.md) | 验收必须可执行，且不能由实现者自证 |
| [0014-atomic-and-recoverable-state.md](../decisions/0014-atomic-and-recoverable-state.md) | 状态写入必须原子，迁移必须可恢复 |
| [0015-evidence-integrity-and-retention.md](../decisions/0015-evidence-integrity-and-retention.md) | 证据必须留痕、脱敏，并有保留上限 |
| [0016-bounded-repair-loop.md](../decisions/0016-bounded-repair-loop.md) | 修复循环必须有界，停滞必须停机 |
| [0017-git-provenance-binding.md](../decisions/0017-git-provenance-binding.md) | change 绑定 git 来源，漂移时阻断 |
| [0018-current-change-routing.md](../decisions/0018-current-change-routing.md) | 多 change 并存时按 current-change 指针路由写入 |
| [0019-web-client-vue-vite.md](../decisions/0019-web-client-vue-vite.md) | Web 客户端采用 Vue 3 + Vite + TypeScript，产物为 web/dist |
| [0020-ui-edit-spec-semantics.md](../decisions/0020-ui-edit-spec-semantics.md) | UI 编辑 spec：保存即版本，草稿只有 change 提案一种形态 |
| [0021-concurrent-write-protection.md](../decisions/0021-concurrent-write-protection.md) | 并发写保护：单文件 CAS + 多文件锁，warn 是有期限的过渡态 |
| [0022-verifier-resolution-and-policy.md](../decisions/0022-verifier-resolution-and-policy.md) | 独立 Verifier 的 agent 解析回退与不可用策略 |
