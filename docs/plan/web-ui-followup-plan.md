# Web 前端后续计划（引用图 / 引用高亮 / Job 持久化 / 并发写 / 编辑语义 / 收尾）

状态：**M1、M2 已完成**（引用图/引用高亮 + Job 持久化 + 编辑语义），M3 待实施；四条开放问题的结论见 §6
来源：[web-ui-enrichment-plan.md](./web-ui-enrichment-plan.md) 的 §5 P2 与 §8 开放问题、
[008 客户端可视化](../design/008-client-visualization.md) §8.6②④、
[comet-hardening-plan](./comet-hardening-plan.md) 遗留
前置：W1–W5 已完成（Vue 3 迁移、P0 修复、spec 内核、change 审计、任务收口、资产覆盖）
关联 ADR：0001（spec 单一事实源）、0007（UI 只走 headless service）、0012（spec 版本即产物）、0014（原子与可恢复状态）、
0020（UI 编辑 spec 的语义）、0021（并发写保护与两段式上线）

## 1. 范围与排序

| 编号 | 事项 | 来源 | 规模 | 依赖 |
|---|---|---|---|---|
| N1 | spec 引用关系图（kind → 文件 → anchor/接口三级） | 008 §8.6② | L | 无（复用 spec-index / spec-validate / spec-structure） |
| N2 | 编辑器内引用高亮（可解析引用 chip + 未解析红字） | 008 §8.6④ | M | N1 的引用投影 |
| N3 | Job 持久化（重启后任务与日志仍在） | 计划 §8 开放问题 5 | M | H2 的 evidence-retention（回收）与 redact（脱敏） |
| N4 | 并发写保护（CLI 与 serve 同时写同一项目） | 计划 §8 开放问题 3、008 风险 3 | L | N3（都落在 runtime 状态上） |
| N5 | UI 编辑 canonical spec 的语义（草稿 vs 立即版本） | 计划 §8 开放问题 2 | S（决策）+ S（实现） | 需要 ADR 0020 |
| N6 | 收尾：token 一次性 ticket、面板级错误边界、发布链路含前端构建 | 计划 §5 P2 | S | 无 |

排序原则：

1. **先补可见性**（N1 → N2）：这两项是 008 里唯一还没落地的设计内容，且共用同一份「引用提取」，
   先做 N1 等于把 N2 的数据源先建好。
2. **再补可信度**（N3 → N5）：任务重启后还在、spec 编辑的语义写清楚，都属于「证据能不能信」。
3. **最后动并发与发布**（N6 → N4）：N6 改动小、能先固定发布基线；N4 会改写入路径的面最广，
   放在状态类改动都稳定之后。

### 1.1 决策摘要（2026-09-14）

| 问题 | 决策 |
|---|---|
| N4 CAS 粒度 | 覆盖事实源文件（含 `specs/**`）；**分两步上线**：`warn`（默认 + 30 天时间盒）→ `fail`，到期由 `doctor` / `spec verify` 报 error 强制面对 |
| N3 保留策略 | 「最近 200 条 + 30 天」双阈值，取更宽者保留；回收默认 dry-run，只走 `change gc` 一个入口 |
| N1 是否给 CLI | 提供 `cometflow spec graph --json`，但只做投影：不设退出码、不进 CI 门禁（未解析引用的判定仍归 `spec validate`） |
| N5 一键存提案 | 提供，但前置「change 已存在且处于 shape 阶段」、路径固定 `changes/<change>/specs/`，并补「已有提案」的反向提示入口 |

## 2. 现状证据

| 事项 | 现状落点 | 为什么现在不够 |
|---|---|---|
| 引用图 | `domains/spec/spec-index.ts` 的 `buildSpecIndex` 只按文件给投影；`domains/spec/kind.ts` 有 kind 语义但没有边 | 前端只知道「有几条 api/flow」，看不到「谁引用谁」；deferred/absent 与未解析引用没有图形化表达 |
| 引用高亮 | 编辑器是 `web/src/views/panels/SpecsPanel.vue` 的纯 `<textarea>` | 引用语法（模型：X / 错误码：Y / 调用 POST /z / 键 k）只能靠人眼比对；`spec validate` 的 findings 只有文件级、没有行列定位 |
| 引用语法 | `domains/spec/spec-structure.ts` 是**无任何 import 的纯函数**：`extractModelRefs` / `extractErrorCodeRefs` / `extractConfigKeyRefs` / `extractHeaderRefs` / `extractStatusRefs` / `extractApiReferences(FromLine)` / `extractApiPathRefs` | 这些函数只回值、不回位置（无 offset），既做不了高亮，也没法把 finding 定位到具体行列 |
| Job 生命周期 | `domains/server/jobs.ts` 的 `JobManager` 是纯内存 Map（W4 加了 200 上限与 `clearFinished`） | serve 重启即丢：任务中心、`?change=` 深链找回的日志、eval 报告全部消失；长跑项目也没有跨会话审计 |
| 并发写 | `writeProjectConfig` / `writeTaskPlan` / `writeChangeState` / spec 写入都走 `atomicWriteText`（H1），`workspace.json` 在 W1 加了进程内互斥 | 原子写只保证「不半写」，不保证「不互相覆盖」；CLI 与 serve 是两个进程，各自读旧内容再写，后写的赢 |
| spec 编辑语义 | `domains/server/api.ts` 的 `POST /specs`、`PUT /specs/content` 保存后立即 `refreshSpecBaseline` | 每次保存都是一次 canonical 版本变更；用户没有「先看 diff 再决定」和「撤销上一版」的入口 |
| 发布链路 | `scripts/release/package-e2e.mjs` 只检查 `dist/app/cli/index.js` 并跑 tsc + vitest | 前端未构建时 `pnpm package-e2e` 仍 PASS，但 `cometflow serve` 打开是空白页（W1 的 serve 自检只是运行时兜底） |

## 3. 分项计划

### N1 引用关系图 ✅ 已完成

- **目标**：把 009 的引用方向表变成可点的图：kind 层 → 文件层 → anchor/接口层，悬停显示具体引用点，
  未解析引用与 deferred/absent kind 有明确视觉状态。
- **数据来源**：`buildSpecIndex`（apis/models/flows/errors/config）+ `validateSpecs` 的 7 类引用 finding
  （`unresolved-model-reference` / `-error-` / `-config-` / `-protocol-` / `-field-` / `-api-reference` /
  `missing-reference-target`）+ `spec-structure.ts` 的提取函数。
- **落点**：
  1. 新增 `domains/spec/spec-graph.ts`：`collectSpecGraph(projectRoot)` 产出
     `{ nodes: [{ id, kind, path, label, status }], edges: [{ from, to, refKind, resolved, site: { path, line } }] }`；
     `resolved` 与 `validateSpecs` 共用同一份「目标索引」，避免图与校验结论互相矛盾。
  2. `GET /api/projects/{id}/spec/graph`（薄封装）+ CLI `cometflow spec graph [--json]`，
     让图与 `spec validate` 共用投影（ADR 0007 的做法）。
     **职责边界（决策）**：`spec graph` 只输出 `nodes/edges`，**不设退出码、不进 CI 门禁**；
     想卡「未解析引用数」的脚本与 CI 一律从 `spec validate` 的 findings 取，避免出现第二个判定源。
  3. 前端 Specs 面板新增「引用图」页签：SVG 分层布局，12 个 kind 节点固定位置，点击展开到文件/anchor；
     边按 refKind 分色，`resolved=false` 红色虚线；悬停显示 `path:line`。
  4. deferred/absent kind 置灰；只渲染当前项目、逐级展开。
- **验收**：把 `specs/rules.md` 的「模型：Building」改成不存在的模型 → 图上出现红色虚线边且悬停指到该行；
  点 capability 节点能展开到 `POST /buildings` 这类 anchor；`spec graph` 与 `spec validate` 的未解析集合完全一致。

实施结果：新增 `domains/spec/spec-graph.ts`（`buildSpecReferenceIndex` + `collectSpecGraph`），
`GET /spec/graph` 与 CLI `cometflow spec graph [--json]`（只做投影、无退出码）；前端 Specs 面板新增「引用图」页签：
12 个 kind 节点按 009 方向表聚合连线，点击下钻 kind → 文件 → anchor，右侧列出该文件的逐条引用与 `path:line`，
未解析引用红色标注。**同源断言**已在测试里钉住：图的未解析集合与 `spec validate` 的 findings 逐条相等。
- **风险**：节点规模（大项目 flow/capability 很多）→ 只渲染 kind 层，展开才取子层；
  不引入图形库，用固定层级 + 确定性布局（同一份 spec 每次布局一致，便于截图比对）。

### N2 编辑器内引用高亮 ✅ 已完成

- **目标**：编辑器把可解析引用渲染成 chip，未解析引用红色下划线并提示「目标未定义，点击去补」；
  点击 chip 跳到目标 anchor。
- **落点**：
  1. `spec-structure.ts` 给每个提取器补「返回位置区间」的出口（`extractRefSpans(line) -> [{ kind, value, start, end }]`），
     现有 `extractModelRefs` 等改为在其上取值——**同一组正则、两个出口**，避免高亮与校验各写一套语法。
  2. 新增 `POST /api/projects/{id}/spec/references`（body `{ content }`）返回
     `{ tokens: [{ line, start, end, kind, value, resolved }] }`。支持传草稿正文，因此不必先落盘；
     服务端算而不是前端算，是为了不让客户端重新实现领域语法（ADR 0007）。
  3. 编辑器改「透明 textarea + 镜像层」：镜像层把 token 区间包成 `<span class="ref ref-unresolved">`；
     滚动、字体、内边距与 textarea 严格一致；输入去抖 200ms 调一次 `/spec/references`。
  4. 点击 chip → 跳到目标 anchor（如 `specs/models.md#实体：Colony`）。
- **验收**：打开 `specs/rules.md` 时 `模型：Building` 为已解析 chip，改成 `模型：Nope` 后 300ms 内变红并有提示；
  中文输入法组合期不闪烁、不错位；2000 行 spec 打字无可感知卡顿。

实施结果：`spec-structure.ts` 新增 `extractRefSpans(line)`（同一组正则，返回**行内区间**），
五个取值函数改为在其上取值（语义不变，原有测试未改一行仍全绿）；`POST /spec/references` 对**草稿正文**返回
`{ line, start, end, kind, value, resolved }`；`SpecEditor.vue` 用「透明 textarea + 镜像层」渲染 chip：
已解析为蓝底 chip、未解析为红底波浪线，并在编辑器下方给出「L7 Ghost」这类跳转按钮；
输入去抖 200ms、IME 组合期暂停刷新、镜像层与 textarea 共用同一套字体/内边距/换行样式。
- **风险**：textarea 与镜像层的像素级对齐（换行、滚动、Tab）；IME 组合期抖动；大文件 token 数量。
  缓解：两者共用同一 CSS；`compositionstart/end` 期间暂停刷新；token 数超上限时只请求视口附近。

### N3 Job 持久化 ✅ 已完成

- **目标**：serve 重启后任务中心、change 运行日志、eval 报告仍在；过期任务可回收。
- **落点**：
  1. `domains/server/jobs.ts` 增加持久化：记录写 `.cometflow/runtime/jobs/<id>.json`（`atomicWriteJson`），
     日志追加写 `.cometflow/runtime/jobs/<id>.log`（`appendLineAtomic` + 1MiB 轮转，与 change journal 同款）。
  2. `JobManager` 启动加载最近 N 条（默认 100）到内存；完成/失败时落盘；`clearFinished()` 同时删文件。
  3. 落盘前过 `platform/io/redact.ts`（H2 已落地）：agent stdout 里可能带凭证。
  4. 接入 `domains/workflow/evidence-retention.ts`：`collectEvidenceUsage` 统计 jobs 占用，
     `planEvidenceGc` / `applyEvidenceGc` 增加回收候选。
     **保留策略（决策）**：「最近 200 条已完成」与「30 天」双阈值，**满足任一即保留**——
     单按时间会在密集调试期（一天上百次运行）把最需要复盘的昨天清掉，单按条数又会在低频项目里留一年垃圾。
     运行中的任务永不回收；单任务日志 1 MiB 轮转；回收默认 dry-run、只走 `change gc`，
     dry-run 的可回收量进 `doctor` 输出。
- **验收**：跑一次 eval → 重启 serve → 任务中心仍有该任务与报告（`GET /api/jobs` 带 `finishedAt` 与 `result`）；
  日志轮转后读取端仍返回「摘要 + 最近 N 行」；日志含 `sk-` / `Bearer ` 形态时不落原文；
  `change gc --apply` 只回收已结束任务。
- **风险**：写放大（每 job 两个文件）→ 只在状态变化时写记录、日志按行追加；磁盘上限由保留期 + 上限共同约束。

实施结果：新增 `domains/server/job-store.ts`（记录 `runtime/jobs/<id>.json` 原子写、日志 `<id>.log`
追加写 + 1 MiB 轮转、读取回拼尾部、`planJobGc`/`applyJobGc` 双阈值回收）；
`JobManager` 接 `resolveProjectRoot` 并新增 `hydrate`/`flush`：serve 启动后首次访问 `GET /api/jobs`
即把各项目落盘的任务读回内存，**重启后任务与结果仍在**；日志落盘前过 `redactSecrets`（脱敏）；
`doctor` 报告占用与可回收量，新增 `doctor --clean-jobs` 执行回收（默认只报告）。
测试新增 `test/domains/job-store.test.ts`（5 例：往返、脱敏、轮转、双阈值回收、JobManager 落盘 + 清理）
与 `serve-jobs-api` 的「重启后仍能读到任务与报告」端到端断言。

### N4 并发写保护

- **目标**：CLI 与 serve（或两个 CLI 会话）同时操作同一项目时，不再「后写的静默覆盖前写的」。
- **两层方案**（先乐观、后悲观，避免到处加锁）：
  1. **单文件乐观 CAS**：写入前记录目标文件的内容哈希与 mtime，提交前再读一次比对，不一致则按下面的
     两段式策略处理。**覆盖范围（决策）**：事实源文件全部在内——`specs/**`、`.cometflow/plans/*.yaml`、
     `changes/<name>/comet-state.yaml`、`.cometflow/config.yaml`、`.cometflow/spec-lock.json`；
     派生产物（`web/dist`、`node_modules` 等）不在内。理由是这里真正的风险不是「覆盖」而是「静默」：
     spec 有版本仓，覆盖只会让版本链多一版（restore 甚至已经做到覆盖前先记账），
     但并发写发生时用户完全不知道自己的改动被盖掉了——CAS 把这件事从静默变成显式。
  2. **多文件事务锁**：涉及多文件一致性的动作（`change archive` 的 `applyProposedSpecs`、`plan freeze`、
     `spec restore`、UI 批量写）先取 `.cometflow/runtime/lock`：内容 `{ pid, host, started_at, action }`，
     TTL 默认 120s；取不到锁立即失败并提示「另一个进程正在执行 <action>（pid/host/时间）」；
     `doctor` 把滞留锁报 error，并给出 `cometflow doctor --force-unlock`（人工确认后清理）。
- **落点**：新增 `platform/fs/file-lock.ts`（`acquireLock` / `releaseLock` / `readLock` / `inspectStaleLock`）
  与 `platform/fs/cas-write.ts`（`writeWithCas`）；写入点改造集中在 `change-store` / `task-plan-store` /
  `spec-version` / `spec-lock` / `project-config`；API 层把冲突映射成 **409 `concurrent-modification`**。

#### N4 的两段式上线与「到期硬提醒」（决策）

分两步上线是为了先用真实数据校准，又不会因为「忘了改」永久停在宽模式。机制不依赖任何人的记忆：

| 阶段 | 行为 | 用户可见性 |
|---|---|---|
| `warn`（默认，30 天时间盒） | 冲突照旧写入，但**处处留痕**：响应体带 `warning`、journal 记 `cas-conflict-warn`、`metrics` 计数、`doctor` 报 warning、UI 顶部横幅提示「目标已被他处改写，你覆盖了 X」 | 每次冲突都能看到，而不是静默通过 |
| 到期（`concurrency.warnUntil` 过后） | `doctor` 与 `spec verify` 各报 **error `concurrency-warn-expired`** → CI 的 `spec-gates` 因此变红 | 想忘也忘不掉，只剩两条出路 |
| `fail`（终态） | 冲突中止并返回 **409 `concurrent-modification`**（附路径与两次哈希） | 界面提供「重读并重试 / 确认覆盖」两个动作 |

- **到期后的两条出路**（唯一合法选择）：
  1. 切 `fail`：`concurrency.specWrites: fail` 并删掉 `warnUntil`；
  2. 显式延长：把 `warnUntil` 往前推，同时写 `warnReason` 说明为什么继续观察。
     延长期本身也会再次到期——这是一次有痕的决策，而不是静默的「以后再说」。
- **配置落点**：`.cometflow/config.yaml` 的 `concurrency.{specWrites, warnUntil, warnReason}`；
  `validateProjectConfig` 校验（`warn` 必须带未来的 `warnUntil`；`fail` 不允许留 `warnUntil`）。
- **可见性**：`cometflow doctor` 与 `status` 输出「当前并发策略 + 距到期天数 + 累计 warn 命中数」；
  UI 设置页只读展示同一组值，并提供「切换 / 延长」入口（走配置校验，不绕过校验直接改文件）。
- **验收（追加三条）**：
  1. `warn` 阶段：并发冲突下写入仍成功，响应带 `warning`、journal 出现 `cas-conflict-warn`；
  2. 到期：把 `warnUntil` 设为过去时间后，`doctor` 与 `spec verify` 各出现 `concurrency-warn-expired`（error），
     `scripts/spec-gates.mjs` 退出非零；
  3. `fail` 阶段：并发冲突返回 409 且目标文件内容不变（两个进程并发写同一文件的脚本断言）。
- **验收**：两个进程同时 `change archive` 同一个 change → 一个成功、另一个明确 409 并给出冲突文件与哈希；
  持锁进程被杀 → 下次取锁按 TTL 判陈旧并自动接管，journal 记一条 `lock-recovered`；
  `doctor` 对陈旧锁给 error 与修复命令；并行**读**不受影响（只对写加锁）。
- **风险**：Windows/NFS 锁语义差异（用「创建即独占」的文件 + TTL，不依赖 OS advisory lock）；
  时钟漂移让 TTL 误判（同时校验 pid 是否存活）；过度加锁拖慢长任务 → agent 运行期间不持锁
  （它本来就只写 `changes/<name>/`），只在多文件提交窗口持锁。

### N5 UI 编辑 spec 的语义（草稿 vs 立即版本）✅ 已完成

- **目标**：把「在界面上改 spec 意味着什么」写清楚，并给出撤销路径。
- **三个选项**：

  | 选项 | 做法 | 代价 |
  |---|---|---|
  | A 立即版本（现状） | 保存即 `refreshSpecBaseline`，新版本 + 新 lock | 语义最诚实（内容变了就是新版本），但误编辑直接落到契约上 |
  | B 新造草稿存储 | `.cometflow/spec-drafts/` + 提交动作 | 引入第二事实源，违反 ADR 0001 |
  | C 用 change 的提案 spec 当草稿载体 | 草稿写在 `changes/<name>/specs/`（已有机制：`readProposedSpecs` 会读它，`spec diff --impact --change` 能预演影响） | 需要一个 change 容器；纯 spec 维护场景略重 |

- **建议：A + C**。默认仍是 A，但补两件事：
  1. 保存前先看 diff：编辑器加「预览变更」，展示相对最新版本的 unified diff
     （数据来自 `GET /spec/version?ref=<path>@<最新版本>` 与当前正文的对比），确认后才提交；
  2. 一键撤销到上一版（等价 `spec restore <path>@<上一版>`，W2 已实现端点）；
  3. 需要「先改契约、暂不动 canonical」时明确引导到 C（用 change 的提案 spec，W3 的证据页签已能展示提案）。
     **一键存提案的前置条件（决策）**：目标 change 必须已存在且处于 `shape` 阶段
     （提案的语义就是「这个 change 打算改成什么」，shape 本来就是改契约的阶段）；
     不允许「先存提案再建 change」，否则它会变成绕开契约的暗道。保存路径固定
     `changes/<change>/specs/<相对路径>`，与 `readProposedSpecs` 一致，不新增存储；
     按钮旁写明「这不改 canonical spec，归档时才应用」。
  4. **反向入口也要有**：编辑器打开某份 spec 时，若已存在提案版本，顶部提示「当前有提案（change X）」，
     并提供一键 diff（复用 `spec/impact?change=` 与版本预览）。这样 N5 不是「草稿态」的变体，
     而是给已有机制补一个 UI 入口，仍然守住 ADR 0001。
- **落点**：`web/src/views/panels/SpecsPanel.vue` 的编辑器加「预览变更 / 撤销上一版」；
  复用 `domains/spec/spec-version.ts` 已有的 `readSpecBlob` / `resolveSpecVersionRef`；无需新端点。
- **决策（ADR 0020）**：界面不引入第二事实源；草稿只有 change 提案一种形态；每次保存都是一次版本；
  一键存提案带上面两个前置条件。
- **验收**：保存前必出 diff；撤销后 `spec verify` 通过、lock 与版本链一致；USAGE §12 与 ADR 0020 互相引用。

实施结果：编辑器工具栏新增「预览变更（相对当前版本）」「撤销到上一版」「存为提案」；
预览用无依赖的行级 LCS diff（`web/src/utils/diff.ts`，超长文件退化为整块替换而不是卡住界面），
撤销复用 `spec restore`（当前内容先记账，实测 toast 会显示「已撤销到 v1，当前内容已登记为 v3」）；
新增 `POST /spec/proposal`（只允许「已存在且处于 shape 阶段」的 change，路径固定
`changes/<change>/specs/<spec 相对路径>`）与 `GET /spec/proposals[?path=]`（带 path 时回正文），
编辑器打开时反查提案并显示「当前有提案版本：X」与「与提案对比」——草稿只有这一种形态（ADR 0020）。

### N6 收尾项

1. **token 一次性 ticket**：SSE 现在只能把 token 放查询串（`web/src/api/client.ts` 的 `eventStreamUrl`），
   于是 token 会进浏览器历史与可能的代理日志。改为 `POST /api/session/ticket`（用 Authorization 换 30 秒有效、
   单次使用的 ticket）→ `GET /api/events?ticket=...`。验收：EventSource URL 不再出现长期 token，ticket 重放被拒。
2. **面板级错误边界**：目前面板加载失败只有 toast，主区域可能一直停在「加载中」。
   给每个面板加统一 wrapper：失败时渲染错误卡片 + 「重试」，且不影响侧栏与其它面板。
3. **发布链路纳入前端构建**：`scripts/release/package-e2e.mjs` 增加 `web/dist/index.html` 存在性与
   `pnpm web:build`（或直接调 vite 构建）；并校验 `package.json` 的 `files` 含 `web/dist`。
4. **文档复核**：008 完成度标记、USAGE §12、README 的目录结构与脚本说明对齐到 W1–W5 + 本计划的产出。

## 4. 里程碑

| 里程碑 | 内容 | 完成标志 |
|---|---|---|
| M1 可见性 | N1 + N2 | 图上能看见引用关系与未解析边；编辑器里错误引用即时变红并可跳转 |
| M2 可信度 | N3 + N5 | 重启 serve 后任务与日志仍在；spec 编辑有 diff 预览与撤销，语义写进 ADR 0020 |
| M3 并发与发布 | N4 + N6 | 并发写冲突返回 409 且有恢复路径；N4 的 `warn` 时间盒到期能自动让 `doctor`/CI 报错（不会静默停在宽模式）；发布链路一次构建同时产出 CLI 与前端并做校验 |

## 5. 完成定义（DoD）

每一项都必须同时满足：

1. 有单元或端到端测试，且覆盖**失败路径**（未解析引用、并发冲突、重启恢复、脱敏命中）；
2. 在 `experiments/regression-fixture` 增加回归场景并接入 `run-regression.sh`；
3. CLI 与 API 共享同一投影（新能力先在 `domains/` 落地，再加端点与命令，不在客户端重实现领域逻辑）；
4. 用户可见行为变化更新 `docs/USAGE.md`；涉及语义决策的补 ADR；
5. 浏览器端到端走查一遍（本地 serve + 真实项目），控制台无 error/warning。

## 6. 决策记录（2026-09-14）

四条问题已定；语义级的决策另写在 ADR 0020 / 0021，下面保留原问题作为背景。

1. **N4 的 CAS 粒度 → 覆盖 `specs/**`，分两步上线**（ADR 0021）。
   原问题是「覆盖到 `specs/**` 会不会太严」。结论是覆盖，但先 `warn`（默认 30 天）后 `fail`：
   本地单用户场景下 spec 并发编辑少见，一旦发生却是「静默覆盖别人的契约」；warn 阶段既能拿到真实冲突数据，
   又不卡住日常操作。**防遗忘不靠记忆**：`warnUntil` 到期后 `doctor` 与 `spec verify` 报
   `concurrency-warn-expired`（error），CI 的 `spec-gates` 直接变红，只能「切 fail」或「显式延长并写下理由」——
   见 §3 N4「两段式上线与到期硬提醒」。
2. **N3 的保留策略 → 「最近 200 条 + 30 天」双阈值取更宽**。
   单按时间会在密集调试期清掉昨天最需要复盘的证据；单按条数会在低频项目里留下一年无用日志。
   回收默认 dry-run、只走 `change gc`，dry-run 结果进 `doctor`。
3. **N1 暴露 CLI → 提供 `spec graph --json`，但只做投影**：
   不设退出码、不进 CI 门禁；「未解析引用数」的判定统一从 `spec validate` 的 findings 取，
   避免第二个判定源。
4. **N5 一键存提案 → 提供**（ADR 0020）：前置 change 已存在且处于 `shape` 阶段；路径固定
   `changes/<change>/specs/`；并补「已有提案」的反向提示与 diff 入口。它不是新的草稿存储，
   而是已有提案机制的 UI 入口，因此不违反 ADR 0001。

> 留给实施时用真实数据校准、不阻塞开工的三点：
> a) N4 的多文件事务锁 TTL（默认 120s）是否够——取决于最慢事务（archive 的 applyProposedSpecs）耗时；
> b) Job 日志轮转阈值（默认 1 MiB）是否需要按项目配置；
> c) N2 单文件 token 上限（默认 2000，超出只高亮视口附近）是否需要 UI 可调。
>
> 实施中新发现（建议随 M3 一起处理）：`platform/io/redact.ts` 的 aggressive 规则在**超长同字符行**
> （如一行 600 KB 的 `xxxx…`）上会出现灾难性回溯，把调用方钉在 100% CPU。job 日志按行脱敏、
> agent 输出不可控，因此建议给单行长度设上限（先截断再脱敏）或改写该组正则。

## 7. 与现有机制的关系（复用清单）

| 本计划要用到的既有机制 | 出处 |
|---|---|
| 原子写 / 追加写 / rename 重试 | `platform/fs/atomic-write.ts`（H1-1） |
| 凭证脱敏（提示词与落盘两档） | `platform/io/redact.ts`（H2-2） |
| 证据占用统计与回收（dry-run / apply） | `domains/workflow/evidence-retention.ts`（H2-3） |
| 规范和哈希（域标签、键序无关） | `domains/state/canonical-hash.ts`（H1-3） |
| spec 版本仓与回放 | `domains/spec/spec-version.ts`（ADR 0012） |
| 提案 spec（change 内草稿） | `changes/<name>/specs/` + `readProposedSpecs` |
| 写入门禁与 current-change 指针 | `domains/guard/hook-guard.ts`（H3-3） |
| 引用语法提取（纯函数） | `domains/spec/spec-structure.ts` |

> 本计划不引入新的事实源，也不改变 spec 的权威性：所有新增能力都是「读同一份状态 + 多一个视角」，
> 唯一的写语义变化是 N4 的并发冲突从「静默覆盖」变成「显式失败」。
