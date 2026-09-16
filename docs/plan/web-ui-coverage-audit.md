# Web 前端覆盖度审计（后端已实现能力 ↔ 界面可见性）

状态：审计报告（只读调研；2026-09-16 按新基线修订 §1/§3/§5/§7/§9，同日补登 C18，实施批次见
[web-ui-visibility-plan.md](./web-ui-visibility-plan.md)）
分支：`codex/enrich-ui`
基线：`main @ 2a4d54f`（含平台侧 P1–P5：doctor 汇总写保护状态、git 提交门禁、metrics 阈值可配、
gate findings 统一呈现）+ 本分支的审计文档
关联：ADR 0007（UI 只走 headless service）、[008 客户端可视化](../design/008-client-visualization.md)、
[web-ui-enrichment-plan.md](./web-ui-enrichment-plan.md)（W1–W5）、
[web-ui-followup-plan.md](./web-ui-followup-plan.md)（M1–M3 / N1–N6）、
[metrics-plan.md](./metrics-plan.md)、[platform-next-plan-2.md](./platform-next-plan-2.md)、
[web-ui-visibility-plan.md](./web-ui-visibility-plan.md)（本审计的实施计划）

## 1. 结论摘要

| 口径 | 结果 | 说明 |
|---|---|---|
| HTTP 端点接线率 | **90 / 92 ≈ 98%** | `/config/project` 与 `/spec-index` 按 V4-5 的决策**保留给 CLI/脚本**（有文档与测试的对外投影，不是缺口） |
| CLI 能力完整可见率 | **59 / 78 ≈ 76%** | 另有 1 条「部分可见」、18 条「无 UI 入口」，V4 时产品缺口清零；2026-09-16 复核新登记 1 条（C18：Web 无法为 capability 建骨架），**同日按 [spec-authoring-plan.md](./spec-authoring-plan.md) G3 交付**。18 条里 14 条是安装/运维/长驻进程（§5.2），4 条是按决策退出界面（Classic 弃用 3 条 + spec index 保留 1 条，§5.1） |
| 核心流水线可见率（扣除 18 条安装/运维/弃用/保留命令） | **59 / 60 ≈ 98%** 完整，**100%** 至少部分可见 | 剩下的「部分可见」只有 `bundle compile`（编译产物已在资产面板预览，仅装配动作留 CLI） |

一句话结论：**008 的 S1–S5 与 W1–W5 / N1–N6 声称的产物都在代码里，主流水线（goal → plan → spec →
change → evolve → eval）已经端到端可用**；剩余缺口不再分布在主链路上，而是四类「边缘但真实」的地方——
① 度量与健康度投影（`metrics`）完全不可见；② P5 刚统一出来的 findings 投影（verify + doctor 两源、已去重）
没有端点，界面上仍只有 doctor 一个来源；③ 需要人工决策的收尾动作（doctor 维护、change 指针、证据回收、
evolve 回滚）只有 CLI 出口；④ 资产与另一条工作流（skill/bundle/classic/hook 安装）只读。

## 2. 方法与口径

仍沿用 W1 的三份事实源对照，但把「前端调用」从 `web/app.js` 换成了 Vue 3 源码：

| 事实源 | 文件 | 作用 |
|---|---|---|
| CLI 命令面 | `app/cli/index.ts`（74 条叶子命令） | 后端**已经具备**的能力全集 |
| HTTP 端点 | `domains/server/api.ts`（76 条 method+path 组合，写成 70 处方法判定）+ `domains/server/serve.ts`（`/api/events`） | 前端**够得着**的能力 |
| 前端调用 | `web/src/**`（`stores/project.ts` 的 `projectApi` + `api/client.ts` 的 `api()`） | 前端**实际用到**的能力 |

分类沿用 A / B / C：

- **A 类｜有后端、无端点**：域函数与 CLI 都在，HTTP 层没开，前端不可能有入口；
- **B 类｜有端点、前端未接线**：端点存在且可用，前端没调用；
- **C 类｜有入口、深度或表达力不足**：能点，但只读、只覆盖一部分，或结论看不出来。

本次额外做了一步：**逐条复核上一轮计划的「已完成」声明**，而不是相信文档里的勾。结论是 W1–W5 与 N1–N6
的产物都能在代码里找到对应落点（`spec/graph` + 引用图页签、`spec/references` + 编辑器 chip、
`job-store.ts` 的双阈值回收与 `hydrate`、`platform/fs/cas-write.ts` + `concurrency.ts` 的两段式上线、
`POST /session/ticket`、`PanelBoundary.vue`、`package-e2e` 的 `web/dist/index.html` 检查），没有发现
「文档说做了、代码里没有」的条目。

2026-09-16 复核补充：平台侧 P1–P5（doctor 汇总写保护状态、git 提交门禁、metrics 阈值可配、
gate findings 统一呈现）已合入 `main` 并逐条验证落地；本报告与 `platform-next-plan-2.md` 的关系是
**后端半场 vs 可见性半场**，不是重复计划——详见 [web-ui-visibility-plan.md](./web-ui-visibility-plan.md) §0。

## 3. 总量对照

| 维度 | W1 调研时 | 现在 | 本报告关注点 |
|---|---|---|---|
| CLI 叶子命令 | 65 | **78** | 新增 spec graph、hook install/status/uninstall、change select/gc/rebase、plan trace、gate check/install/status/uninstall 等 |
| HTTP 端点 | 49 | **92** | 新增 spec 内核 9、change 审计 5、提案 2、资产与门禁 6、ticket 1、V1–V3 可见性 15 等 |
| 前端面板 | 8 | **10 + 任务中心** | Specs 7 页签、Changes 4 页签、Assets 4 页签、Goals 5 页签 |
| 前端源码规模 | 单文件 ≈800 行 | `web/src` 5.4k 行 / 45 个文件（31 个 `.vue`） | 分层为 view / store / component / util |

## 4. 逐面板覆盖

| 面板 | 已接线端点 | 深度 | 缺口（对应 §5–§7） |
|---|---|---|---|
| 总览 Overview | `/project/status`、`/project/doctor`、`/findings`、`/metrics`、`/maintenance`、`/gate`、`/project/doctor/{clean-temp,clean-jobs,force-unlock}`、`/project/evidence/clean` | 计数卡 + 计划/变更表 + **问题清单** + **门禁** + **质量与健康度** + **维护动作**（四类清理，全部「预告→确认→执行」）；findings 同时驱动**顶栏健康徽章** | V1–V4 已交付 C1/C2/C4/C14/C17 与门禁可见性 |
| 目标 Goals | `/mission.md` GET/PUT、`/goals`、`/context/sync`、`/goals/sync` | 5 页签 + 整文 Markdown 编辑 + **单条目标就地编辑/删除**（按 `### Gn` 块边界，删除前显示原块） | V4 已交付 C16 |
| 规格 Specs | 上述 + `/spec/anchors`、`/spec/import` | **8 页签**（新增「导入」）、编辑器引用 chip + 镜像层、版本回放、影响预演、提案存取、「验收覆盖」内含**全部锚点**（kind / 验收项 / 绑定任务） | V3 已交付 C8/C9；`/spec-index` 端点冗余（B1，V4-5 清理） |
| 计划 Plans | 上述 + `/plans/{goal}/trace` | 状态驱动按钮 + 任务表 + **追溯**（任务 → spec 绑定 → 验收项 → 状态，附文本清单） | V3 已交付 C7 |
| 变更 Changes | `/changes`、`/changes/{name}`、`resume/transition/run/verify/archive/scope/journal/evidence/rebase/unblock`、`/plans/{goal}` | 4 页签、步骤条、验收结论、冲突双路径、job 日志 | `change select` 无端点（C3）；`change gc` 无端点（C4） |
| 进化 Evolve | `/evolutions`、`propose/verify/submit/approve/reject`、`/evolutions/{name}/rollback` | 提案卡 + 门禁 + 评审表单 + **回滚指引弹窗** | V2 已交付 C6 |
| 评估 Eval | `/eval/run` | Pass@k / Pass^k / 每轮输出 / rubric / judge 全量渲染 + **历史与两轮对比**（差值 + 结论翻转清单） | V4 已交付 C15 |
| 调度 Scheduler | `/scheduler/queue` | 队列 + 推导待办 + 下一个任务 + 参数只读 + **已用预算**（跨重启累计） | V4 已交付预算可见；daemon 启停与日志仍属 CLI（C5 的有意只读） |
| 资产 Assets | `/skills`、`/skills/{name}`、`/bundles`、`/classic`、`/hook/check`、`/hook/status` | Skills / Bundle / Classic / Hook 预览 4 页签；Hook 页签顶部新增**写保护状态表**（支持性 / 条目 / 守卫脚本 / CLI 解析） | V2 已交付 C11；skill/bundle 写操作仍无入口（C12）；classic 只读（C10） |
| 设置 Settings | `/config` GET/PUT、`/agents` | agent/模型、verification、scope、scheduler、并发策略（含切换 fail 与延长） | `/config/project` 冗余（B2） |
| 任务中心（抽屉） | `/jobs`、`/jobs/{id}`、`DELETE /jobs` + SSE | 持久化任务、日志、结果、深链 | — |

## 5. A 类：后端有能力、HTTP 无端点（23 条）

### 5.1 产品缺口（13 行中 9 行已交付：V1/V2 五条 + V3 四条；余 4 行进 V4）

> 标 ✅ 的十一项已完成（见 [web-ui-visibility-plan.md](./web-ui-visibility-plan.md) §3.1–§3.4）；
> 保留在表中是为了让差异盘点可追溯——「当时差在哪里」和「现在补上了」都能对上。

| 能力 | CLI | 领域函数 | 缺什么 | 对 UI 的价值 |
|---|---|---|---|---|
| ✅ 度量投影 | `metrics` | `metrics-service.ts` / `spec-health.ts` | ~~无端点、无面板~~ → `GET /metrics` + 总览卡片 | 重建质量与 spec 健康度已可见，并显示当前生效的门禁阈值 |
| ✅ 当前 change 指针 | `change select` | `current-change.ts` | ~~无端点、无入口~~ → `GET/POST /current-change` + Changes 面板与 Hook 预览两处入口 | 多活跃 change 的 fail closed 现在可以在界面上解除 |
| ✅ 证据回收 | `change gc` | `evidence-retention.ts` | ~~无端点、无入口~~ → `POST /project/evidence/clean` + 维护卡证据行 | 预告（按 change 的占用 + 候选路径）→ 确认 → 回收；不匹配时连 journal 轮转都不做 |
| ✅ Evolve 回滚指引 | `evolve rollback` | `evolution-service.ts` | ~~无端点、无入口~~ → `GET /evolutions/{name}/rollback` + Evolve 面板弹窗 | approve 之后想撤销，界面上就能拿到步骤 |
| ✅ 冻结任务追溯 | `plan trace` | `task-plan-trace.ts` | ~~无端点、无入口~~ → `GET /plans/{goal}/trace` + Plans 面板追溯 | 任务 → spec 绑定 → 验收项一次看全，未绑定 / 无验收项显式标注 |
| ✅ 表格导入 | `spec import` | `spec-import.ts` | ~~无端点、无入口~~ → `POST /spec/import` + Specs「导入」页签 | 粘贴 → 预览（会新写 / 已存在跳过 / 非法能力名）→ 写入，规则与 CLI 同源 |
| ✅ spec 锚点清单 | `spec anchors` | `spec-anchors.ts`（新） | ~~无端点~~ → `GET /spec/anchors` + 「验收覆盖」内的全部锚点段 | 「锚点 → 绑定任务 → 可执行验收」平铺；未绑定者就是覆盖率分母里的缺口 |
| ⊘ Classic 推进（2 条） | `classic new` / `classic transition` | `domains/classic/*` | **按决策退出界面**（2026-09-16：只保留 native，Classic 后续版本一并移除） | 不再需要界面入口；USAGE §7.4 已标注弃用 |
| ✅ 预算用量投影 | `daemon budget` | `scheduler/budget.ts` | ~~无端点~~ → `GET /scheduler/queue` 的 `budget` 字段 + 调度面板「已用预算」 | 跨重启累计的用量可见；重置仍走 CLI（`daemon budget . --reset`） |
| ✅ 统一 findings 投影（P5 新增，非命令） | —（经 `gate check --findings` / `spec verify --with-doctor` 暴露） | `domains/gates/findings.ts` | ~~无端点、无入口~~ → `GET /findings` + 总览「问题清单」卡 | 界面上看到的条目与 `gate check . --findings` 逐条相等（测试钉住） |
| ✅ 门禁判定投影 | `gate check` | `domains/gates/spec-gates.ts` | ~~无端点、无入口~~ → `GET /gate` + 总览「门禁」卡 | 「现在能不能提交」在界面上有结论（逐项 PASS/FAIL） |
| ✅ 门禁安装状态 | `gate status` | `domains/gates/git-hook.ts` | ~~无端点、无入口~~ → 同上（响应里的 `install`） | 装没装、是否链式、内容是否漂移、`core.hooksPath` 指向哪里，一眼可见 |

### 5.2 安装 / 运维 / 长驻进程专属（14 条，建议长期留在命令行）

`run`、`update`、`uninstall`、`project migrate`、`dashboard`、`skill add`、`skill import`、`bundle create`、
`bundle distribute`、`hook install`、`hook uninstall`、`gate install`、`gate uninstall`、`daemon start`。

判断依据是「是否需要常驻进程 / 是否改变机器的安装状态」：这类命令给 UI 入口的收益低、风险高
（例如 `uninstall` 会删项目状态），保持 CLI 专属是有意选择，不算覆盖缺口。它们目前都由面板空状态文案
明确导回 CLI（Assets 的 Skills / Bundle 两个页签都写了对应命令；Classic 页签已按 V4-4 移除）。

按这个口径（V1–V4 之后）：78 条叶子命令 = 59 条完整可见 + 1 条部分可见 + 14 条 CLI 专属 +
4 条按决策退出界面（Classic 3 条：new / transition / status；spec index 1 条）；**产品缺口清零**。
「核心流水线可见率」的 60 条分母就是 78 − 18（14 条 CLI 专属 + 4 条弃用/保留）。

## 6. B 类：有端点、前端未接线（2 条，均为冗余）

| 端点 | 现状 | 结论 |
|---|---|---|
| `GET /api/projects/{id}/config/project` | 前端未调用 | **冗余**：`GET /config` 已同时返回 `config`（合并视图）与 `projectOverride`（项目层覆盖键），Settings 用的是后者 |
| `GET /api/projects/{id}/spec-index` | 前端未调用 | **被取代**：Specs 面板走 `/spec/graph`（带解析状态与边）与 `/init-manifest`；`spec-index` 只剩 CLI `spec index` 与文件投影用途 |

这也解释了「接线率 97% 而不是 100%」的全部差额。两条都不构成用户可见缺口，但会在「端点总数 vs 实际使用」上产生噪声。建议在下一批里二选一：
在端点注释里标注「CLI 专用/保留」，或直接删除。

## 7. C 类：有入口、深度或表达力不足

| 编号 | 问题 | 证据 | 影响 |
|---|---|---|---|
| ✅ C1 | doctor 维护动作无入口 | 三个开关 `cleanTemp/cleanJobs/forceUnlock` 只接受 CLI 参数，findings 文案把用户推回终端 | **V1-4 已交付**：三个端点 + 维护卡（预告 → 二次确认 → 执行，预览不匹配 409 且不删） |
| ✅ C2 | 度量投影零可见 | `collectMetrics` 有 `rebuild` + `spec_health` 两组指标，`web/src` 无任何调用 | **V1-2 已交付**：总览「质量与健康度」卡 + 生效阈值 |
| ✅ C3 | current-change 指针无入口 | `change select` 只在 CLI；Hook 预览文案写着 fail closed 却无法设置指针 | **V1-3 已交付**：Changes 面板与 Hook 预览两处入口 |
| ✅ C4 | 证据回收无入口 | `change gc` 只在 CLI；doctor 报告可回收量 | **V2-1 已交付**：维护卡证据行（预告 → 确认 → 回收），与 doctor 动作同一套护栏 |
| C5 | 调度面板只读 | `SchedulerPanel.vue` 顶部文案明确「只读展示，不在界面上改队列状态」；无 daemon 启停、无 budget、无日志尾 | 这是**有意的设计选择**，但「预算用量」和「daemon 最近一次决策」连只读投影都没有，用户无法判断调度器是否在正常工作 |
| ✅ C6 | Evolve 回滚无入口 | `EvolvePanel.vue` 只有 propose/verify/submit/approve/reject；`evolve rollback` 未接线 | **V2-2 已交付**：提案卡新增「回滚指引」弹窗（纯投影） |
| ✅ C7 | 任务追溯不完整 | 任务表没有验收项，也没有「未绑定」的显式表达 | **V3-2 已交付**：追溯表（含 acceptance ids 与未绑定 / 无验收标注）+ 文本清单 |
| ✅ C8 | 无表格导入入口 | `spec-import.ts` 有实现；Specs 页签都没有导入 | **V3-3 已交付**：「导入」页签（粘贴 → 预览 → 写入） |
| ✅ C9 | 无锚点平铺视图 | `spec anchors` 未接线 | **V3-4 已交付**：「验收覆盖」内的全部锚点段（kind / 验收项 / 绑定任务） |
| ⊘ C10 | Classic 只读 | `AssetsPanel.vue` 曾有 Classic 页签（只读） | **V4-4 按决策处理**：界面移除该页签，USAGE 标注弃用（只保留 native，Classic 后续版本一并移除）——不是「补上写入闭环」 |
| ✅ C11 | Hook 状态只能间接看 | `hook install/uninstall` 无端点；P1 已落地，`doctor.ts` 汇总六种 hook finding | **V2-3 已交付**：资产面板 Hook 页签的写保护状态表（支持性 / 条目 / 守卫脚本 / CLI 解析），与 doctor findings 互为表里 |
| C12 | Skill/Bundle 只读 | Assets 面板用空状态文案把用户导回 `skill add` / `bundle create` / `bundle distribute` | 属有意的「只读优先」，但 `bundle distribute` 的平台选择（`opencode` / `claude-code`）已由 `GET /bundles` 返回，界面完全可以做成一次点击 |
| C13 | 无一次性 agent 会话入口 | `run` 未接线 | 试跑/临时会话必须先建 change，或者回 CLI |
| ✅ C14 | TopBar 缺项目健康徽章 | TopBar 只有项目名/path + agent 徽章 + 任务计数 | **V4-2 已交付**：findings 提升为共享 store，顶栏徽章与总览清单同源同数 |
| ✅ C15 | Eval 无历史对比 | `adoptLatestJob()` 只找回最近一次 `eval-run` | **V4-1 已交付**：历史表 + 「对比轮」+ 指标差值与结论翻转清单 |
| ✅ C16 | 目标只能追加 | `addGoal()` 只能追加新块 | **V4-3 已交付**：按 `### Gn` 块就地编辑/删除（删除前显示原块），写回后自动 sync |
| ✅ C17 | 总览的问题清单只有一个来源 | Doctor 卡只渲染 `doctor.findings`；P5 的 `collectFindings`（两源、去重、带 `subject`）没有端点 | **V1-1 已交付**：问题清单与 `gate check . --findings` 同源，可跳转到对应面板 |
| ✅ C18 | capability spec 的骨架入口只在 CLI | `POST /spec/scaffold` 只接受 `kinds` / `answers`（`domains/server/api.ts:647`），走 root kind 的 `scaffoldKinds` / `scaffoldProject`；`--capability` 只在 `app/cli/index.ts:687` | 四条产出路径（手写 / 骨架 / spec-authoring 任务 / 表格导入）里，界面只暴露「手写 / 导入」两条 | **G3 已交付**（[spec-authoring-plan.md](./spec-authoring-plan.md) §7）：端点接受 `capabilities[]` 并复用 `scaffoldCapabilities`，脚手架页签可点名生成、分别显示 created/skipped/invalid；顺带修掉「端点缺 stack 时把 root kind 判成 absent」 |

## 8. 与 008 阶段设计的对照

| 008 阶段 | 设计内容 | 现状 | 剩余 |
|---|---|---|---|
| S1 serve 骨架 + 应用外壳 | token、静态托管、工作区、首页、JobManager、SSE、任务中心、TopBar 指示器 | **完成** | TopBar 缺 doctor 徽章（C14） |
| S1.5 Specs 面板 | 12-kind + 引用图 + 校验面板 + 编辑器引用高亮 | **完成** | 锚点平铺（C9）、表格导入（C8） |
| S2 Plan 向导 | 状态机驱动按钮 + 任务列表 + findings | **完成** | `plan trace`（C7） |
| S3 Change 步骤条 | 四步 + 实时日志 + 回退表达 | **完成**（`PhaseSteps.vue`、job 日志、rebase/unblock 双路径） | 指针管理（C3）、证据回收（C4） |
| S4 Evolve + Eval | 门禁日志 + 报告可视化 | **完成** | 回滚（C6）、历史对比（C15） |
| S5 打磨与扩展 | doctor/daemon 面板、二次确认、离线打包 | **部分**：二次确认与打包完成；doctor 只有一张卡、daemon 面板只读 | C1、C2、C5、C11 |

## 9. 下一批候选 → 已细化为实施计划

本节原本是候选清单；2026-09-16 已细化为 [web-ui-visibility-plan.md](./web-ui-visibility-plan.md)
的 V1–V4（含落点、验收标准、依赖与 DoD）。这里只保留排序结论，细节以计划文档为准：

| 批次 | 内容 | 对应本报告条目 |
|---|---|---|
| ✅ V1（已完成） | 统一 findings 端点 + 总览问题清单卡；`metrics` 端点 + 质量与健康度卡；current-change 指针端点 + 两处入口；doctor 三个维护动作端点 + 按钮 | C17、C2、C3、C1 |
| ✅ V2（已完成） | `change gc` 端点 + 维护卡证据行；`evolve rollback` 指引；写保护状态表 | C4、C6、C11 |
| ✅ V3（已完成） | `gate check` / `gate status` 可见性；`plan trace`；`spec import`；`spec anchors` 平铺 | §5.1 的门禁两行、C7、C8、C9 |
| ✅ V4（已完成） | Eval 历史对比；TopBar 健康徽章；目标单条编辑/删除；Classic 界面移除；冗余端点标注保留；调度预算可见 | C15、C14、C16、C10、§6、§5.1 的预算行 |

两处对 §9 原稿的修正（写进计划时才发现）：

1. **doctor 三个维护动作不解决 C4**：`doctor --clean-jobs` 回收的是**任务证据**（`runtime/jobs`，走 `applyJobGc`），
   而 C4 的 `change gc --apply` 回收的是 **change 运行时证据**（`evidence-retention.ts` 的 `applyEvidenceGc`）——
   两套对象、两个入口，所以 C4 单列为 V2-1，不并进 V1-4。
2. **V1 多了一条「统一 findings」**：它不在本报告成稿时的 §9 里，是平台侧 P5 落地后新出现的投影（§5.1 已补行）。
   把它放进 V1 的理由是它是 C1/C14 的天然数据源——先有它，doctor 卡与健康徽章就不必各写一套渲染。

运维类（§5.2 的 14 条）建议维持 CLI 专属，只在文档里明确登记，不进入前端 backlog。

## 10. 附录：复核方法

```bash
# 1. CLI 叶子命令数（91 处 .command( − 13 个命令组 = 78）
rg -o "\.command\('[a-z-]+" app/cli/index.ts | wc -l

# 2. HTTP 端点（api.ts 的 85 处方法判定；其中 plan 动作与 evolve 动作各是 1 处判定对应 4 条路径，
#    因此 method+path 组合为 91 条，再加 serve.ts 的 /api/events = 92）
rg -o "method === '[A-Z]+'" domains/server/api.ts | sort | uniq -c

# 3. 前端实际接线（逐条比对 projectApi / api 调用的路径前缀）
rg -n "projectApi" web/src
rg -n "api<|api\(" web/src/components web/src/stores

# 4. B 类残留（有端点、前端零引用）
rg -n "spec-index|config/project" web/src
```

维护规则：本报告只描述**当前**差异。下一批实施后，请同步更新 §1 的数字、§4 的逐面板缺口列，
以及 `docs/plan/README.md` 的「Web 前端」两行状态——避免再次出现「文档勾完成、覆盖度没人复核」的情况。
