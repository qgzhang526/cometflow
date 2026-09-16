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
| Comet 借鉴加固 | 落地 012 的 9 项：原子写入、两阶段迁移、规范哈希、快照 omission、脱敏、证据上限、有界修复循环、git 来源绑定、Hook 路由 | **已完成**（H1–H3，M1–M3 达成；平台测试 55 文件 / 292 例） | [comet-hardening-plan.md](./comet-hardening-plan.md) |
| 度量批次 | 把已有证据聚合成重建质量与 spec 健康度指标（`cometflow metrics`） | **已完成** | [metrics-plan.md](./metrics-plan.md) |
| CI 门禁 | 回归执行器跨平台化 + spec 门禁 + 度量基线 + 三 job CI | **已完成**（run #4 双平台全绿） | [ci-plan.md](./ci-plan.md) |
| 平台侧后续 | 独立验证默认化 ✅、hook 真正接线 ✅（claude-code）、调度器健壮性 ✅；并发写锁归 web-ui-followup-plan 的 N4 | **A/B/D 已完成** | [platform-next-plan.md](./platform-next-plan.md) |
| 平台侧第二批 | doctor 汇总 hook 状态 ✅、git 提交门禁 ✅、metrics 阈值可配 ✅、husky/lefthook 安装点 ✅、findings 统一呈现 ✅ | **全部完成（P1–P5）** | [platform-next-plan-2.md](./platform-next-plan-2.md) |
| Web 前端补齐 | 收敛「后端有能力、前端看不见」的差异：修 P0 正确性缺陷，补齐 spec 内核、change 审计与资产可视化 | **已完成**（W1–W5） | [web-ui-enrichment-plan.md](./web-ui-enrichment-plan.md) |
| Web 前端后续 | 引用关系图与引用高亮、Job 持久化、并发写保护、spec 编辑语义、发布链路收尾 | **已全部完成**（M1–M3，N1–N6） | [web-ui-followup-plan.md](./web-ui-followup-plan.md) |
| Web 前端覆盖度审计 | 以 CLI / HTTP / 前端调用三份事实源互相对照，量化「后端有能力、前端看不见」的差异（A/B/C 三分类） | **已完成**（2026-09-16 按平台侧 P1–P5 后的基线修订） | [web-ui-coverage-audit.md](./web-ui-coverage-audit.md) |
| Web 前端可见性 | 把「后端算出来了、但只能敲命令」清零：findings / metrics / current-change 指针 / doctor 维护动作（V1），证据回收、回滚指引与写保护状态（V2），再到门禁/追溯/导入（V3–V4） | **V1、V2 已完成**（V3–V4 已排序未细化） | [web-ui-visibility-plan.md](./web-ui-visibility-plan.md) |

## 阶段顺序原则

先把 spec/workflow 闭环补硬，再做科学评估，再补调度健壮性，再做 Skill/Bundle，最后产品化收口。

## 文档维护规则

- 每个阶段开始前，创建或更新对应详细文档。
- 每个阶段完成后，更新本 README 的状态列。
- 每个阶段必须有明确验收标准，并以测试和提交记录作为完成证据。
- 计划变更先改文档，再改代码。
