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

## 决策记录

| ADR | 决策 |
|---|---|
| [0001-spec-single-source.md](../decisions/0001-spec-single-source.md) | 项目级 spec 是唯一事实源 |
| [0002-task-spec-association.md](../decisions/0002-task-spec-association.md) | 任务与 spec 关联发生在拆解与冻结阶段 |
| [0003-plan-review-policy.md](../decisions/0003-plan-review-policy.md) | 拆解审核三档策略 |
| [0004-spec-change-reconciliation.md](../decisions/0004-spec-change-reconciliation.md) | 已完成任务不可变，spec 变更走 reconciliation |
| [0005-goal-source-markdown-first.md](../decisions/0005-goal-source-markdown-first.md) | 任务目标以 Markdown 为人类事实源 |
| [0006-evolution-review-states.md](../decisions/0006-evolution-review-states.md) | Evolve 提案 approved/rejected 终态与评审命令 |
