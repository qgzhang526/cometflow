# Web 前端补齐计划（后端能力 ↔ 前端展示差异）

状态：**W1 已完成**（Web 客户端迁移到 Vue 3 + Vite + TypeScript，四个 P0 缺陷修复），W2–W5 待开始
分支：`codex/enrich-web-ui`
调研基线：`fd870a9` + 工作区未提交改动（H1 加固 + 试验夹具）
关联：ADR 0007（UI headless）、ADR 0008（工作区/多项目）、ADR 0009（agent/模型分层）、
ADR 0013（验收必须可执行）、ADR 0014（状态原子可恢复）、[008 客户端可视化](../design/008-client-visualization.md)、
[comet-hardening-plan.md](./comet-hardening-plan.md)

## 1. 调研方法

以三份「事实源」互相对照，而不是凭印象列功能：

| 事实源 | 文件 | 作用 |
|---|---|---|
| CLI 命令面 | `app/cli/index.ts` | 后端**已经具备**的能力全集（65 条叶子命令） |
| HTTP 端点 | `domains/server/api.ts` | 前端**够得着**的能力（49 个端点） |
| 前端调用 | `web/app.js` | 前端**实际用到**的能力（8 个面板） |

差异按三类判定，后续批次也按这三类排优先级：

- **A 类｜有后端、无端点**：能力存在于 domains/CLI，但 HTTP 层没开，前端不可能有入口；
- **B 类｜有端点、前端未接线**：端点已经存在且可用，前端没调用或用错；
- **C 类｜有入口、正确性或表达力不足**：能点，但结果是错的、丢了、或看不出所以然。

## 2. 差异总览

| 维度 | 数量 | 说明 |
|---|---|---|
| CLI 叶子命令 | 65 | 22 个命令组 |
| HTTP 端点 | 49 | 覆盖 workspace / 项目 / spec / plan / change / evolve / eval / job / SSE |
| 前端面板 | 8 | 总览、目标、规格、计划、变更、进化、评估、设置 |

结论：**spec 内核与 change 审计这两块「产品主张」在前端几乎不可见**。
`spec` 12 条子命令里前端只用了 `validate` / `scaffold` / `index`；`change` 11 条子命令里只用了
`new` / `transition` / `run` / `verify` / `archive`。也就是说，CLI 里最贵的那部分能力
（版本回放、影响分析、漂移检测、一致性门禁、实现范围审计）目前只有敲命令才看得到。

## 3. A 类：后端有能力、HTTP 无端点

这些是「前端能不能做」的前置条件，需要先补端点（都只是薄封装已有领域函数，不新增业务逻辑）。

| 能力 | CLI | 领域函数 | 建议端点 | 对 UI 的价值 |
|---|---|---|---|---|
| 验收项 ↔ 可执行 check | `spec checks` | `parseSpecFile` / `listSpecFiles` | `GET /spec/checks` | ADR 0013 的落点：一眼看到「哪些验收项还没有 check，只能靠人判」 |
| 一致性门禁 | `spec verify` | `verifySpecIntegrity` | `GET /spec/verify` | 已有 doctor 摘要，但缺完整 findings（含 `plan-integrity` / `change-state-integrity`） |
| spec 变更 diff | `spec diff` | `diffSpecs` | `GET /spec/diff` | 展示「当前 specs/ 相对 lock 改了什么」 |
| 锚点级影响分析 | `spec diff --impact [--change]` | `analyzeSpecImpact` / `readProposedSpecs` | `GET /spec/impact?change=` | 归档前预演「谁会漂移」；这是 011 的核心卖点 |
| 冻结任务漂移 | `spec drift` | `collectSpecDrift` | `GET /spec/drift` | 列出被改坏的冻结任务与漂移类型 |
| 版本历史 | `spec versions` | `readSpecHistory` | `GET /spec/versions[?path=]` | 「spec 即产物」的可视化入口 |
| 版本回放 / 恢复 | `spec show` / `spec restore` | `resolveSpecVersionRef` / `readSpecBlob` | `GET /spec/version-content`、`POST /spec/restore` | 误删 spec 后可一键取回 |
| lock 基线 | `spec lock` | `refreshSpecBaseline` | `POST /spec/lock` | 现在只能靠「编辑 spec 顺带刷新」，显式建立基线没有入口 |
| 表格导入 | `spec import` | `importSpecsFromFile` | `POST /spec/import` | 工标/接口清单从 Excel 粘贴导入 |
| 任务→spec 追溯 | `plan trace` | `task-plan-trace` | `GET /plans/{goal}/trace` | Plan 面板的「这个任务绑到哪个 anchor」 |
| 实现范围审计 | `change scope` | `collectImplementationScope` | `GET /changes/{name}/scope` | 回答「这次改动有没有越界」，含 `unattributed` |
| 变更审计流水 | `change journal` | `readChangeJournal` | `GET /changes/{name}/journal` | 全部迁移与 agent 动作的时间线 |
| 重新冻结基线 | `change rebase` | `rebaseChange` | `POST /changes/{name}/rebase` | spec 冲突时的恢复路径（现在报错后 UI 无出路） |
| 残留临时文件清理 | `doctor --clean-temp` | `removeOrphanTempFiles` | `POST /project/doctor/clean-temp` | H1-1 已在 doctor 报出，缺「按提示清理」的按钮 |
| 调度队列 | `daemon start` | `readQueue` / `buildQueueFromPlans` | `GET /scheduler/queue` | 队列状态只读即可，无需先做 daemon 控制 |
| Classic 工作流 | `classic new/status/transition` | `domains/classic/*` | `GET/POST /classic/changes` | 另一条工作流完全不可见（定位待确认） |
| Skill / Bundle | `skill *`、`bundle *` | `domains/skill/*`、`domains/bundle/*` | `GET /skills`、`GET /bundles` | 平台侧资产盘点 |
| Hook 判定预览 | `hook check` | `evaluateHook` | `POST /hook/check` | 让用户理解「为什么这次写入被拒绝」 |
| 一次性 agent 会话 | `run` | `app/commands/run.ts` | `POST /run`（job） | 不建 change 的临时会话 |

## 4. B 类：端点已存在、前端未接线

这些是「改前端就见效」的，成本最低。

| 端点 | 现状 | 建议 |
|---|---|---|
| `GET /api/jobs` | 前端只轮询单个 `/jobs/{id}` | 增加 Job 中心（进行中/已完成/失败），刷新后仍可见 |
| `GET /api/events` 的 `job.*` 事件 | 前端只处理 `state.changed` | 用事件驱动日志与 toast，替代 500ms 轮询 |
| `POST /changes/{name}/resume` | 无按钮 | Change 详情顶部显示「下一步该做什么」 |
| `DELETE /api/projects/{id}` | 无入口 | 项目卡片「从工作区移除」（不删文件） |
| `POST /evolutions/{name}/verify` | 无按钮 | Evolve 面板补 verify（job + 门禁日志） |
| `POST /evolutions/{name}/reject` | 无按钮 | 补 reject 表单（reason 必填） |
| `GET /api/plans` | 前端只按 goal 逐个读 | Plan 面板先渲染摘要列表（goal/status/tasks） |
| `GET /api/agents` | 只用于 TopBar 徽章 | 设置页的 agent 下拉应来自它，而不是自由文本 |

## 5. C 类：前端缺陷（按严重度）

### P0-1 设置页保存会静默丢弃项目配置

- 现象：`web/app.js:760` 的 `saveConfig()` 只 PUT 了 `{agent, model, scheduler}`；
  `domains/server/api.ts:316` 把 body 直接当作完整 config 覆盖写入。
- 影响：项目 `.cometflow/config.yaml` 里已有的 `verification`、`scope.allow`、`agents`、
  `default_workflow`、`plan_review` 会在用户点一次「保存配置」后**全部消失**。
  更隐蔽的是 `GET /api/config` 返回的是「全局 + 项目」合并结果，写回时会把全局默认值固化成项目值，
  破坏 ADR 0009 的分层。
- 建议：端点改为「读现有 → 合并 body → 校验 → 写入」，或提供 `PATCH`；
  前端保存后重新 GET 回填，并显示本次实际写入的字段。

### P0-2 评估跑完，面板被换成 Changes

- 现象：`web/app.js:688` 的 `pollJob()` 在任务结束时无条件调用 `renderChanges()`；
  `runEval()`（`web/app.js:739`）复用了同一个轮询器。
- 影响：Eval 任务结束的瞬间，用户眼前的报告消失，面板变成变更列表；
  而 `JobManager.complete(job.id, { report })` 里的 `EvalReport`（pass@k / pass^k / rubric / judge）
  前端从未渲染。
- 建议：`pollJob(jobId, { logBox, onDone })` 改成回调式，各面板只刷新自己；并为 Eval 增加报告视图。

### P0-3 Change 的验收结论被丢弃，详情被重置

- 现象：`changeAction()`（`web/app.js:676`）对 `verify` / `archive` 的返回结果不做任何处理，
  随后 `renderChanges()` 会把 `#change-detail` 重置为「选择 change」。
- 影响：点击「验收」后既看不到 verdict（哪条 acceptance 失败、来自 check 还是 agent），
  也看不到 `scope.unattributed`，而且必须重新点一次 change 才能继续操作。
- 建议：详情区改为状态驱动渲染（不再整块重建）；verify 结果按 acceptance 分组展示，
  失败项带上原始 check 命令与输出摘要。

### P0-4 Builder 日志在运行结束的瞬间被销毁

- 现象：`changeAction('run')` 把日志写进 `#change-log`，完成回调走 `renderChanges()` 重建面板。
- 影响：最需要留存的日志恰好最先消失；也没有地方回看历史 job。
- 建议：日志归属 Job 中心（B 类第 1 项），面板只做「跳转到该 job」。

### P1-5 SSE 全量重渲染，打断正在进行的编辑

- 现象：`connectSse()`（`web/app.js:342`）收到任何 `state.changed` 就 `route()`；
  未按 `projectId` 过滤，也没有去重；`const panel` 是死代码。
- 影响：其他项目的写操作也会触发当前页面重绘；编辑 COMETFLOW.md 或 spec 时，
  后台的 job 事件会把表单内容冲掉。
- 建议：事件带 `projectId` / `path` 精确路由到受影响的面板；对同一 panel 做短时间去抖；
  编辑态（modal 打开）时挂起刷新，改为提示「有外部变更」。

### P1-6 SSE 无失败处理

- 现象：token 无效时 `EventSource` 无限重连，服务端持续 401。
- 建议：`onerror` 计数退避 + 顶部提示「实时连接已断开，点击重连」。

### P1-7 变更名含单引号会破坏页面

- 现象：`web/app.js:653` 用 `onclick="openChange('<name>')"` 拼接，而 `esc()` 不转义 `'`。
- 建议：改用 `data-*` + `addEventListener`（`renderSpecs` 已是这种写法，统一即可）。

### P1-8 Plans 面板只有裸 JSON

- 现象：`web/app.js:618` 把整份 task-plan `JSON.stringify` 塞进 `<pre>`。
- 影响：008 §8.2 设计的「任务列表 + 依赖 + acceptance + findings 分组 + 按钮可用性由状态决定」
  完全没有落地；用户看不出下一步该点哪个按钮，也看不出为什么。
- 建议：按 `plan.status` 计算按钮可用性；任务表展示 `capability/spec_anchor/spec_hash/acceptance_ids/depends_on`；
  validate findings 按 error/warning 分组并可跳转到 spec anchor。

### P1-9 Specs 编辑器缺「版本 + 校验 + 验收」三件事

- 现象：`renderSpecs()` 只有 12-kind 状态、脚手架、引用计数、文件列表与纯文本编辑框。
- 影响：保存后不刷新列表与版本；看不到 `spec_version` / `hash`；
  看不到「哪个 anchor 的验收项没有 check」；没有 diff / drift / impact / verify。
- 建议：编辑器常驻「版本链 + 当前 hash + 未覆盖验收项」，顶部提供 校验 / 影响分析 / 版本回放 三个动作。

### P1-10 目标面板只能追加，ID 靠字符串计数推断

- 现象：`openGoalFormModal()` 用 `mission.content.split('### G').length` 推断下一个编号。
- 影响：已有 G10 或目标块被重排时会生成重复编号或错号；也无法编辑/删除单个目标。
- 建议：从解析结果计算最大编号 + 1，并支持对单个 `### Gn` 块就地编辑。

### P2 其余问题

| 问题 | 证据 | 建议 |
|---|---|---|
| 反馈只有 `alert()` | 全文件多处 | 统一 toast + 保存后自动刷新 |
| 首页不显示「最近打开」 | `web/app.js:292` 只用 goals/plans/changes 计数，而 `WorkspaceProject.lastOpenedAt` 已存在 | 卡片补时间，并按 `lastOpenedAt` 排序 |
| 无「从工作区移除」 | `DELETE /api/projects/{id}` 未被调用 | 卡片增加次要操作 |
| token 走 URL query | `web/app.js:344` SSE 需 `?token=` | 后端签发一次性 ticket，避免 token 进历史与日志 |
| 全局安装后 UI 404 | `package.json` 的 `files` 只有 `dist` + `README.md` | 把 `web/` 纳入发布产物（008 §10 已列） |
| 无面板级错误边界 | `web/app.js` 单文件约 800 行，任一 await 抛错即空白 | 引入 panel 级 try/catch + 错误卡片 |

## 6. 建议实施批次

### W1 正确性与可观测性（P0，先修再扩）✅ 已完成

- 目标：让现有 8 个面板**结果正确、状态不丢**。
- 落点：`domains/server/api.ts` 的 config 合并写入；`web/app.js` 的 `pollJob` / `renderChanges` / `changeAction`
  重构为「状态驱动 + 回调刷新」；新增 Job 中心与 toast。
- 验收：保存设置不丢 `verification` / `scope`；eval 结束仍在 Eval 面板且能看到 pass@k 报告；
  change 动作后详情不重置、verdict 可见；刷新页面后能看到进行中的 job。
  补 `test/domains/serve-api.test.ts` 的 config 回归用例。

实施结果：

- **前端重建为 Vue 3 + Vite + TypeScript**（ADR 0016）：`web/src/` 下按 view / store / component 分层，
  依赖只有 `vue` / `vue-router` / `pinia`，样式与类名沿用原设计，产物为 `web/dist`。
- **P0-1**：`PUT /config` 改为增量合并（`mergeProjectConfigOverride`），新增 `GET .../config/project`
  暴露项目层覆盖集合；设置页补全 verification / scope / 每 agent 模型 / 调度器窗口，保存后回读并回报写入键。
- **P0-2**：Eval 面板复用任务记录渲染报告（Pass@k / Pass^k / 每任务轮次明细 / rubric / judge），
  任务结束后不再切走面板；`JobRecord.result` 落库，刷新页面后仍可从 `GET /api/jobs` 取回。
- **P0-3**：Change 详情状态驱动渲染，验收结论按 acceptance 列出（含 check 命令、exitCode、stdout/stderr、
  实现范围越界项），动作完成后不再重置选择。
- **P0-4 / B 类**：新增任务中心抽屉（`GET /api/jobs` + `job.*` 事件），Builder 日志离开面板也不会丢。
- **P1-5/6**：SSE 按 `projectId` / `path` 路由到区域、去抖、编辑中挂起、断线退避重连并有横幅提示。
- **P1-7**：不再用内联 `onclick` 拼接；**P1-8**：Plans 面板由裸 JSON 改为任务表 + 状态驱动按钮 + findings 列表。
- 测试：`test/domains/serve-api.test.ts` 增补 config 合并回归与 webDir 回退；新增 `test/domains/jobs.test.ts`。

浏览器冒烟（真实 serve + regression fixture 项目，逐面板点击）又暴露三处只在端到端才出现的问题，已一并修掉：

- **P0-5 `workspace.json` 并发读改写会互相截断**：每个项目请求都会 `touchProject`（读→改→写），
  而新面板普遍用 `Promise.all` 并发取数，于是出现「读到自己/对方写了一半的文件」→ `JSON.parse` 失败 →
  500 `Unexpected end of JSON input`，前端表现为「加载变更失败」且列表为空。
  修法：`writeWorkspace` 改原子写（H1-1 的 `atomicWriteJson`），`registerProject` / `touchProject` / `removeProject`
  走按文件排队的进程内互斥；新增并发回归测试（5 个并发注册 + 30 次并发 touch，断言不丢项目且文件可解析）。
- **任务中心抽屉遮住面板主操作**：抽屉固定在最右侧，会盖住面板右上角的按钮（例如「运行评估」）。
  修法：抽屉打开时给内容区留出 `padding-right`，操作按钮始终可点。
- **`?token=` 未生效**：入口没有调用 `initTokenFromUrl()`，serve 打印的带 token 地址打开后拿不到凭据。
  修法：在挂载前完成 token 落盘与地址清理，并把 SSE 的 token 收进 `eventStreamUrl()`，常规请求一律走 `Authorization` 头。

### W2 spec 内核可视化（A 类 + P1-9）

- 目标：把「spec 即产物」变成可点、可回放。
- 落点：新增 `GET /spec/checks`、`/spec/verify`、`/spec/versions`、`/spec/diff`、`/spec/impact`、`/spec/drift`、
  `POST /spec/restore`；Specs 面板增加「版本」「影响」「验收覆盖」三个视图。
- 验收：能看到每个 anchor 的验收项与 check；能列出并回放历史版本；
  改一份 spec 后能预览受影响的冻结任务与严重度分级。

### W3 change 审计与恢复路径（A 类 + P0-3）

- 目标：让 change 的「为什么」可回答。
- 落点：`GET /changes/{name}/scope`、`/journal`、`POST /rebase`；Change 面板改为步骤条 +
  标签页（概览 / 范围 / 流水 / 证据）。
- 验收：越界改动有归属解释；归档冲突时 UI 给出 rebase 或 reconciliation 两条明确路径；
  时间线含全部迁移事件。

### W4 事件与 job 体系收口（B 类 + P1-5/6）

- 目标：SSE 成为唯一刷新通道，轮询退居兜底。
- 落点：`web/app.js` 的 SSE 处理改为按 `projectId` / `path` 路由 + 去抖 + 退避重连；
  TopBar job 指示器；`job.*` 事件驱动日志。
- 验收：其他项目的事件不再刷新当前页；编辑中不被外部事件打断；断线可恢复且有提示。

### W5 覆盖面扩展（A 类余项）

- 目标：把 8 面板之外的资产（调度队列、Skill/Bundle、Hook 预览、Classic）纳入界面。
- 落点：`GET /scheduler/queue`、`GET /skills`、`GET /bundles`、`POST /hook/check`、Classic 读写端点。
- 验收：每个新面板都有空状态引导，且全部只读优先、写操作二次确认。

## 7. 与 008 设计文档的完成度对照

| 008 阶段 | 设计内容 | 现状 |
|---|---|---|
| S1 serve 骨架 + 应用外壳 | token、静态托管、工作区、首页、JobManager、SSE | **基本完成**（缺 job 中心与 TopBar 指示器） |
| S1.5 Specs 面板 | 12-kind + 引用图 + 校验面板 + 编辑器引用高亮 | **部分**：kind 状态与引用计数有，引用图与高亮未做 |
| S2 Plan 向导 | 状态机驱动按钮 + 任务列表 + findings | **未做**（当前是裸 JSON） |
| S3 Change 步骤条 | 四步 + 实时日志 + 回退表达 | **部分**：有按钮与轮询日志，无步骤条、无回退表达、日志会丢 |
| S4 Evolve + Eval | 门禁日志 + 报告可视化 | **部分**：propose/submit/approve 有，verify/reject 未接线，报告未渲染 |
| S5 打磨与扩展 | doctor/daemon 面板、二次确认、离线打包 | **未做**（doctor 仅在总览里以文本列出） |

## 8. 开放问题（需要决策后再动手）

1. ~~**前端技术选型**~~：**已决策**——Vue 3 + Vite + TypeScript，见 ADR 0016；迁移与 W1 一并完成。
2. **UI 是否有权改 canonical spec**：`POST/PUT /api/specs` 会立即 `refreshSpecBaseline`（登记新版本）。
   这是「UI 编辑即新版本」的强语义，需要确认是否要加草稿态。
3. **并发写**：CLI 与 serve 同时操作同一项目仍是 last-write-wins（008 风险 3）。前端写操作越多，
   这个风险越显性，建议在 W1 一并加入进程级文件锁或写入前 mtime 校验。
4. **Classic 工作流定位**：它与 native change 并存，但 UI 完全没提。要么给只读视图，要么明确标注「CLI-only」。
5. **Job 持久化**：`JobManager` 是纯内存，重启即丢。若 W1 引入 Job 中心，需要考虑是否落盘
   （可复用 H1-1 的原子写工具）。

## 9. 完成定义（DoD）

每个批次都必须同时满足：

1. 端点有测试（沿用 `test/domains/serve-api.test.ts` 的「起真服务器」风格），失败路径覆盖到；
2. 前端改动在 `experiments/` 的真实项目上按 `docs/demo` 的验证路径走通一遍；
3. 用户可见行为变化同步更新 `docs/USAGE.md` 第 12 节与 008 文档的完成度标记；
4. 涉及新端点或语义变化的，补 ADR。
