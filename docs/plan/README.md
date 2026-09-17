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
| Web 前端可见性 | 把「后端算出来了、但只能敲命令」清零：findings / metrics / current-change / doctor 维护动作（V1），证据回收 / 回滚指引 / 写保护状态（V2），门禁 / 追溯 / 导入 / 锚点（V3），Eval 历史对比 / 顶栏徽章 / 目标编辑 / 预算可见（V4） | **V1–V4 全部完成**（审计的产品缺口清零） | [web-ui-visibility-plan.md](./web-ui-visibility-plan.md) |
| spec 作者与把关 | 统一「capability spec 谁写、谁把关」：草案标记 `status`、`plan_review` 策略消费、Web capability 骨架入口（审计 C18）、`spec-authoring` 任务的验收护栏 | **G1–G4 已实施**（2026-09-16，回归 132 步） | [spec-authoring-plan.md](./spec-authoring-plan.md) |
| 一次性 agent 试跑（C13） | 把 `cometflow run` 接进界面：`POST /run` + `flow-run` job（日志走任务中心），设置页试跑卡片带 agent 选择与二次确认；明确「试跑 ≠ 交付」 | **已实施**（2026-09-16） | [agent-trial-run-plan.md](./agent-trial-run-plan.md) |
| 可见性收口（C5 / C12） | C5：daemon 状态投影（`.cometflow/runtime/daemon-state.json`）+ 调度面板「最近一次决策」卡；C12：`POST /bundles/distribute` + Bundle 页签一键分发（预告 → 确认 → 执行） | **已实施**（2026-09-16，C 类缺口全部关闭） | [visibility-closeout-plan.md](./visibility-closeout-plan.md) |
| 能力地图 | CLI 能力 / HTTP 端点 / 面板的对应关系，以及每条主链路的「你怎么自己验证它对不对」 | **已产出**（2026-09-16） | [capability-map.md](./capability-map.md) |
| P4 Workflow 深度融合 | 让 daemon 驱动 change 生命周期（取任务 → 建 change → 执行 → 独立验收 → 归档 → 回写交付事实），队列降级为派生视图 + 运行时覆盖，控制语义走控制文件（ADR 0026） | **S1–S4 已实施**（2026-09-17，回归 145 步） | [daemon-drives-change-plan.md](./daemon-drives-change-plan.md) |
| 调度并发与排序 | C1 原子领取 + change 级互斥 ✅；C2 依赖排序（`depends_on` 必须已交付）✅；C3 `--concurrency N` 准入与配置就位（执行仍串行）；C4 并发策略决策（ADR 0028）✅ | **C1/C2/C4 已实施，C3 部分**（2026-09-17） | [scheduler-concurrency-plan.md](./scheduler-concurrency-plan.md) |
| 内嵌调度器与常驻 | serve 内嵌调度器（job 形式）+ 单实例租约 + `scheduler.autostart` 常驻恢复 + 页面启动按钮（ADR 0027，修订 0026） | **已实施**（2026-09-17） | [daemon-drives-change-plan.md](./daemon-drives-change-plan.md) |

## 阶段顺序原则

先把 spec/workflow 闭环补硬，再做科学评估，再补调度健壮性，再做 Skill/Bundle，最后产品化收口。

## 文档维护规则

- 每个阶段开始前，创建或更新对应详细文档。
- 每个阶段完成后，更新本 README 的状态列。
- 每个阶段必须有明确验收标准，并以测试和提交记录作为完成证据。
- 计划变更先改文档，再改代码。
