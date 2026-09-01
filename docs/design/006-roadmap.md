# 006 分阶段实施路线

## P0 立项与基线

- 创建 cometflow 仓库。
- 冻结 Comet 与 Nightshift 基线 tag。
- 确定 Node、pnpm、CI、测试策略。
- 编写架构决策与本文档。

验收：仓库可构建、测试、lint。

## P1 Spec 内核优先

先实现 spec 内核，再实现调度和工作流：

- COMETFLOW.md / specs/ 目录约定。
- goal sync：COMETFLOW.md → goals/*.yaml。
- spec validate / diff / freeze / trace。
- spec anchor 与 acceptance 提取。
- plan generate / validate / review / approve / freeze。
- plan trace。

验收：spec → task → acceptance → trace 的最小闭环可运行。

## P2 代码合并与结构落地

- Comet 代码迁入 app/domains/platform。
- Nightshift 代码迁入 scheduler/evolution/agents。
- 保留 smoke/trial 回归。

## P3 统一 AgentRunner 与调度器

- platform/agents 统一接口。
- flow-run / daemon / idle-governor。
- 多 agent 切换。
- Bash → TS golden test。

## P4 Workflow 深度融合

- 每个冻结任务创建一个可恢复 Change。
- Native/Classic 接入执行。
- status 同时显示调度与工作流状态。
- 报告包含 verification 结果。

## P5 Evolution + Eval 闭环

- cometflow evolve。
- import-skill 风险扫描。
- evolve verify --eval。
- Rubric / Pass@k / Pass^k 证据入 review。

## P6 可观测性与产品化

- Dashboard 增加 Scheduler / Evolution 视图。
- 通知、日志、指标。
- 文档、迁移指南。
- 发布 cometflow@0.1.0。
