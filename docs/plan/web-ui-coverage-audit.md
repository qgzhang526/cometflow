# Web 前端覆盖度审计（后端已实现能力 ↔ 界面可见性）

状态：审计报告（只读调研；2026-09-16 按新基线修订 §1/§3/§5/§7/§9，实施批次见
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
| HTTP 端点接线率 | **83 / 85 ≈ 98%** | V1 新增 8 个端点且全部接线；仍只有 `/config/project`、`/spec-index` 两个端点无人调用（都是冗余投影，非用户可见缺口） |
| CLI 能力完整可见率 | **50 / 78 ≈ 64%** | 另有 3 条「部分可见」、25 条「无 UI 入口」（其中 14 条属安装/运维/长驻进程，见 §5.2） |
| 核心流水线可见率（扣除 14 条安装/运维/长驻进程命令） | **50 / 64 ≈ 78%** 完整，**83%** 至少部分可见 | V1 已交付 findings / metrics / current-change / doctor 维护动作；剩余缺口集中在证据回收、回滚指引、写保护卡片与门禁可见性 |

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
| HTTP 端点 | 49 | **85** | 新增 spec 内核 9、change 审计 5、提案 2、资产与门禁 6、ticket 1、V1 可见性 8 等 |
| 前端面板 | 8 | **10 + 任务中心** | Specs 7 页签、Changes 4 页签、Assets 4 页签、Goals 5 页签 |
| 前端源码规模 | 单文件 ≈800 行 | `web/src` 5.4k 行 / 45 个文件（31 个 `.vue`） | 分层为 view / store / component / util |

## 4. 逐面板覆盖

| 面板 | 已接线端点 | 深度 | 缺口（对应 §5–§7） |
|---|---|---|---|
| 总览 Overview | `/project/status`、`/project/doctor`、`/findings`、`/metrics`、`/maintenance`、`/project/doctor/{clean-temp,clean-jobs,force-unlock}` | 计数卡 + 计划/变更表 + **问题清单**（两源去重、可跳转）+ **质量与健康度**（含生效阈值）+ **维护动作**（预告→确认→执行） | V1 已交付 C1/C2/C17；仅剩 TopBar 健康徽章（C14，V4-2） |
| 目标 Goals | `/mission.md` GET/PUT、`/goals`、`/context/sync`、`/goals/sync` | 5 页签（使命 / 技术栈 / 运行环境 / 任务目标 / 投影）+ 整文 Markdown 编辑 | 只能追加 `### Gn`，无单目标就地编辑/删除（C16） |
| 规格 Specs | `/init-manifest`、`/spec/scaffold`、`/specs`、`/specs/content`、`/spec/checks`、`/spec/graph`、`/spec/references`、`/spec/versions`、`/spec/version`、`/spec/restore`、`/spec/lock`、`/spec/diff`、`/spec/drift`、`/spec/impact`、`/spec/verify`、`/spec/validate`、`/spec/proposals`、`/spec/proposal` | 7 页签、编辑器引用 chip + 镜像层、版本回放、影响预演、提案存取 | `spec import` 无端点（C8）；`spec anchors` 无端点（C9，图/文件页签部分等价）；`/spec-index` 端点冗余（B1） |
| 计划 Plans | `/goals`、`/plans`、`/plans/{goal}`、`generate/regenerate/validate/review/approve/freeze` | 状态驱动按钮 + 任务表（kind/capability/spec 绑定/depends_on）+ findings | `plan trace` 无端点（C7） |
| 变更 Changes | `/changes`、`/changes/{name}`、`resume/transition/run/verify/archive/scope/journal/evidence/rebase/unblock`、`/plans/{goal}` | 4 页签、步骤条、验收结论、冲突双路径、job 日志 | `change select` 无端点（C3）；`change gc` 无端点（C4） |
| 进化 Evolve | `/evolutions`、`propose/verify/submit/approve/reject` | 提案卡 + 门禁 + 评审表单 | `evolve rollback` 无入口（C6） |
| 评估 Eval | `/eval/run` | Pass@k / Pass^k / 每轮输出 / rubric / judge 全量渲染 | 只认最近一次 eval job，无历史对比（C15） |
| 调度 Scheduler | `/scheduler/queue` | 队列 + 推导待办 + 下一个任务 + 参数只读 | 无 daemon 启停/预算/日志（C5） |
| 资产 Assets | `/skills`、`/skills/{name}`、`/bundles`、`/classic`、`/hook/check` | Skills / Bundle / Classic / Hook 预览 4 页签（只读为主） | skill/bundle 写操作无入口（C12）；classic 只读（C10）；hook 安装无入口（C11） |
| 设置 Settings | `/config` GET/PUT、`/agents` | agent/模型、verification、scope、scheduler、并发策略（含切换 fail 与延长） | `/config/project` 冗余（B2） |
| 任务中心（抽屉） | `/jobs`、`/jobs/{id}`、`DELETE /jobs` + SSE | 持久化任务、日志、结果、深链 | — |

## 5. A 类：后端有能力、HTTP 无端点（23 条）

### 5.1 产品缺口（13 行中 3 行已由 V1 交付；余 10 行进下一批）

> 标 ✅ 的三行已完成（见 [web-ui-visibility-plan.md](./web-ui-visibility-plan.md) §3.1）；
> 保留在表中是为了让差异盘点可追溯——「当时差在哪里」和「现在补上了」都能对上。

| 能力 | CLI | 领域函数 | 缺什么 | 对 UI 的价值 |
|---|---|---|---|---|
| ✅ 度量投影 | `metrics` | `metrics-service.ts` / `spec-health.ts` | ~~无端点、无面板~~ → `GET /metrics` + 总览卡片 | 重建质量与 spec 健康度已可见，并显示当前生效的门禁阈值 |
| ✅ 当前 change 指针 | `change select` | `current-change.ts` | ~~无端点、无入口~~ → `GET/POST /current-change` + Changes 面板与 Hook 预览两处入口 | 多活跃 change 的 fail closed 现在可以在界面上解除 |
| 证据回收 | `change gc` | `evidence-retention.ts` | 无端点、无入口 | doctor 报出可回收量，但「确认回收」只能在 CLI 敲 `--apply` |
| Evolve 回滚指引 | `evolve rollback` | `evolution-service.ts` | 无端点、无入口 | approve 之后没有任何界面出口能取回滚步骤 |
| 冻结任务追溯 | `plan trace` | `task-plan-trace.ts` | 无端点、无入口 | PlansPanel 展示了 `spec_ref/spec_anchor/spec_version/spec_hash`，但「冻结任务 ↔ 当前 spec 是否仍命中」的专门投影没有 |
| 表格导入 | `spec import` | `spec-import.ts` | 无端点、无入口 | 工标/接口清单从 CSV/TSV/Markdown 导入，W1 的 A 类名单里列过但没实现 |
| spec 锚点清单 | `spec anchors` | `buildSpecIndex` | 无端点 | 引用图与文件页签部分等价，缺一份「锚点 → 绑定任务」的平铺视图 |
| Classic 推进（2 条） | `classic new` / `classic transition` | `domains/classic/*` | 只有 `GET /classic` | 另一条工作流在界面里只读，与 native change 并存的定位仍然模糊 |
| 预算用量投影 | `daemon budget` | `scheduler/budget.ts` | 无端点 | 调度面板有意只读（见 C5），但连「累计预算用了多少」的只读投影也还没有，用户无法判断调度器是否在正常工作 |
| ✅ 统一 findings 投影（P5 新增，非命令） | —（经 `gate check --findings` / `spec verify --with-doctor` 暴露） | `domains/gates/findings.ts` | ~~无端点、无入口~~ → `GET /findings` + 总览「问题清单」卡 | 界面上看到的条目与 `gate check . --findings` 逐条相等（测试钉住） |
| 门禁判定投影 | `gate check` | `domains/gates/spec-gates.ts` | 无端点、无入口 | 「本地提交会不会被挡」是只读判定，界面上完全看不到结论；配合 findings 端点才能回答「现在能不能提交」 |
| 门禁安装状态 | `gate status` | `domains/gates/git-hook.ts` | 无端点、无入口 | 与 C11 同类：装在哪、是否漂移（`core.hooksPath` 变化、hook 被改写）只有 CLI 能看到 |

### 5.2 安装 / 运维 / 长驻进程专属（14 条，建议长期留在命令行）

`run`、`update`、`uninstall`、`project migrate`、`dashboard`、`skill add`、`skill import`、`bundle create`、
`bundle distribute`、`hook install`、`hook uninstall`、`gate install`、`gate uninstall`、`daemon start`。

判断依据是「是否需要常驻进程 / 是否改变机器的安装状态」：这类命令给 UI 入口的收益低、风险高
（例如 `uninstall` 会删项目状态），保持 CLI 专属是有意选择，不算覆盖缺口。它们目前都由面板空状态文案
明确导回 CLI（Assets 的 Skills/Bundle/Classic 三个页签都写了对应命令）。

按这个口径（V1 之后）：78 条叶子命令 = 50 条完整可见 + 3 条部分可见 + 14 条 CLI 专属 + 11 条产品缺口；
「核心流水线可见率」的 64 条分母就是 78 − 14。

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
| C4 | 证据回收无入口 | `change gc` 只在 CLI；doctor 报告可回收量 | 长跑项目的任务/日志回收必须离开界面 |
| C5 | 调度面板只读 | `SchedulerPanel.vue` 顶部文案明确「只读展示，不在界面上改队列状态」；无 daemon 启停、无 budget、无日志尾 | 这是**有意的设计选择**，但「预算用量」和「daemon 最近一次决策」连只读投影都没有，用户无法判断调度器是否在正常工作 |
| C6 | Evolve 回滚无入口 | `EvolvePanel.vue` 只有 propose/verify/submit/approve/reject；`evolve rollback` 未接线 | approve 之后想撤销，只能查 CLI 输出 |
| C7 | 任务追溯不完整 | `PlansPanel.vue` 任务表有 `spec_ref/spec_anchor/spec_version/spec_hash`；`plan trace` 未接线 | 计划错误要回溯到 spec anchor 时，缺一层「冻结任务 ↔ 当前 spec 命中/漂移」的专门视图 |
| C8 | 无表格导入入口 | `spec-import.ts` 有实现；Specs 7 个页签都没有导入 | 大批量接口清单只能走 CLI |
| C9 | 无锚点平铺视图 | `spec anchors` 未接线 | 引用图按 kind 分层下钻，缺「所有锚点 + 覆盖率」的一览 |
| C10 | Classic 只读 | `AssetsPanel.vue` Classic 页签文案「界面只读，推进仍走 `cometflow classic transition`」 | 「两条工作流并存」在 UI 上表现为一条可写、一条只读，用户会问哪条才是正路 |
| C11 | Hook 状态只能间接看 | `hook install/uninstall` 无端点；P1 已落地，`doctor.ts` 汇总六种 hook finding | V1-1 之后这些 finding 会出现在总览「问题清单」卡里（带级别与来源），但**仍没有独立的写保护卡片**（装在哪、是否漂移、CLI 能否解析一次看全）——留给 V2-3 |
| C12 | Skill/Bundle 只读 | Assets 面板用空状态文案把用户导回 `skill add` / `bundle create` / `bundle distribute` | 属有意的「只读优先」，但 `bundle distribute` 的平台选择（`opencode` / `claude-code`）已由 `GET /bundles` 返回，界面完全可以做成一次点击 |
| C13 | 无一次性 agent 会话入口 | `run` 未接线 | 试跑/临时会话必须先建 change，或者回 CLI |
| C14 | TopBar 缺项目健康徽章 | `ProjectView.vue` TopBar 只有项目名/path + agent 徽章 + 任务计数；doctor 状态只在总览 | 008 §5.1 明确要求「项目健康徽章（doctor: OK / NEEDS ATTENTION）」 |
| C15 | Eval 无历史对比 | `EvalPanel.vue` 的 `adoptLatestJob()` 只找回**最近一次** `eval-run` | 报告本身渲染很完整，但无法并排对比两轮评估（这正是「科学评估」最有价值的地方） |
| C16 | 目标只能追加 | `GoalsPanel.vue` 的 `addGoal()` 从 `### G(\d+)` 推算最大编号 + 1（P1-10 已修编号推断） | 单个目标的编辑/删除仍要打开整文 Markdown 编辑器 |
| ✅ C17 | 总览的问题清单只有一个来源 | Doctor 卡只渲染 `doctor.findings`；P5 的 `collectFindings`（两源、去重、带 `subject`）没有端点 | **V1-1 已交付**：问题清单与 `gate check . --findings` 同源，可跳转到对应面板 |

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
| V2 | `change gc` 端点 + 证据占用卡；`evolve rollback` 指引；写保护卡片 | C4、C6、C11 |
| V3 | `gate check` / `gate status` 可见性；`plan trace`；`spec import`；`spec anchors` 平铺 | §5.1 的门禁两行、C7、C8、C9 |
| V4 | Eval 历史对比；TopBar 健康徽章；目标单条编辑；Classic 定位；端点冗余清理 | C15、C14、C16、C10、C12、§6 |

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

# 2. HTTP 端点（api.ts 的 78 处方法判定；其中 plan 动作与 evolve 动作各是 1 处判定对应 4 条路径，
#    因此 method+path 组合为 84 条，再加 serve.ts 的 /api/events = 85）
rg -o "method === '[A-Z]+'" domains/server/api.ts | sort | uniq -c

# 3. 前端实际接线（逐条比对 projectApi / api 调用的路径前缀）
rg -n "projectApi" web/src
rg -n "api<|api\(" web/src/components web/src/stores

# 4. B 类残留（有端点、前端零引用）
rg -n "spec-index|config/project" web/src
```

维护规则：本报告只描述**当前**差异。下一批实施后，请同步更新 §1 的数字、§4 的逐面板缺口列，
以及 `docs/plan/README.md` 的「Web 前端」两行状态——避免再次出现「文档勾完成、覆盖度没人复核」的情况。
