# CometFlow 执行计划

状态：规划中，随实现滚动更新。
当前完成度：约 70%（Phase 1/2 完成，evolve 评审闭环落地）。

## 阶段总览

| 阶段 | 目标 | 状态 | 详细文档 |
|---|---|---|---|
| Phase 1 | 补强 Workflow / Spec 闭环（change list/resume、spec drift、plan regenerate） | **已完成**（d59d1af，平台测试 40） | [phase-1-workflow-spec-closure.md](./phase-1-workflow-spec-closure.md) |
| Phase 2 | 科学评估 MVP（Rubric / Pass@k / Pass^k）+ evolve 评审终态 | **已完成**（d65ca70 + c66ec5a，平台测试 43） | [007-evolution-review-workflow.md](../design/007-evolution-review-workflow.md) |
| Phase 3 | 调度器健壮性 | 待开始 | 进入阶段时补文档 |
| Phase 4 | Skill / Bundle 平台 | 待开始 | 进入阶段时补文档 |
| Phase 5 | 完整 Native 工作流 | 待开始 | 进入阶段时补文档 |
| Phase 6 | 产品化与发布 | 待开始 | 进入阶段时补文档 |

## 横切计划

| 计划 | 目标 | 状态 | 详细文档 |
|---|---|---|---|
| Comet 借鉴加固 | 落地 012 的 9 项：原子写入、两阶段迁移、规范哈希、快照 omission、脱敏、证据上限、有界修复循环、git 来源绑定、Hook 路由 | 待开始 | [comet-hardening-plan.md](./comet-hardening-plan.md) |
| Web 前端补齐 | 收敛「后端有能力、前端看不见」的差异：修 P0 正确性缺陷，补齐 spec 内核与 change 审计的可视化 | 调研完成，待实施 | [web-ui-enrichment-plan.md](./web-ui-enrichment-plan.md) |

## 阶段顺序原则

先把 spec/workflow 闭环补硬，再做科学评估，再补调度健壮性，再做 Skill/Bundle，最后产品化收口。

## 文档维护规则

- 每个阶段开始前，创建或更新对应详细文档。
- 每个阶段完成后，更新本 README 的状态列。
- 每个阶段必须有明确验收标准，并以测试和提交记录作为完成证据。
- 计划变更先改文档，再改代码。
