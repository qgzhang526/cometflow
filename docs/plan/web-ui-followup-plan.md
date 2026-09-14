# Web 前端后续计划（引用图 / 引用高亮 / Job 持久化 / 并发写 / 编辑语义 / 收尾）

状态：计划，待评审
来源：[web-ui-enrichment-plan.md](./web-ui-enrichment-plan.md) 的 §5 P2 与 §8 开放问题、
[008 客户端可视化](../design/008-client-visualization.md) §8.6②④、
[comet-hardening-plan](./comet-hardening-plan.md) 遗留
前置：W1–W5 已完成（Vue 3 迁移、P0 修复、spec 内核、change 审计、任务收口、资产覆盖）
关联 ADR：0001（spec 单一事实源）、0007（UI 只走 headless service）、0012（spec 版本即产物）、0014（原子与可恢复状态）

## 1. 范围与排序

| 编号 | 事项 | 来源 | 规模 | 依赖 |
|---|---|---|---|---|
| N1 | spec 引用关系图（kind → 文件 → anchor/接口三级） | 008 §8.6② | L | 无（复用 spec-index / spec-validate / spec-structure） |
| N2 | 编辑器内引用高亮（可解析引用 chip + 未解析红字） | 008 §8.6④ | M | N1 的引用投影 |
| N3 | Job 持久化（重启后任务与日志仍在） | 计划 §8 开放问题 5 | M | H2 的 evidence-retention（回收）与 redact（脱敏） |
| N4 | 并发写保护（CLI 与 serve 同时写同一项目） | 计划 §8 开放问题 3、008 风险 3 | L | N3（都落在 runtime 状态上） |
| N5 | UI 编辑 canonical spec 的语义（草稿 vs 立即版本） | 计划 §8 开放问题 2 | S（决策）+ S（实现） | 需要 ADR 0019 |
| N6 | 收尾：token 一次性 ticket、面板级错误边界、发布链路含前端构建 | 计划 §5 P2 | S | 无 |

排序原则：

1. **先补可见性**（N1 → N2）：这两项是 008 里唯一还没落地的设计内容，且共用同一份「引用提取」，
   先做 N1 等于把 N2 的数据源先建好。
2. **再补可信度**（N3 → N5）：任务重启后还在、spec 编辑的语义写清楚，都属于「证据能不能信」。
3. **最后动并发与发布**（N6 → N4）：N6 改动小、能先固定发布基线；N4 会改写入路径的面最广，
   放在状态类改动都稳定之后。

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

### N1 引用关系图

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
  3. 前端 Specs 面板新增「引用图」页签：SVG 分层布局，12 个 kind 节点固定位置，点击展开到文件/anchor；
     边按 refKind 分色，`resolved=false` 红色虚线；悬停显示 `path:line`。
  4. deferred/absent kind 置灰；只渲染当前项目、逐级展开。
- **验收**：把 `specs/rules.md` 的「模型：Building」改成不存在的模型 → 图上出现红色虚线边且悬停指到该行；
  点 capability 节点能展开到 `POST /buildings` 这类 anchor；`spec graph` 与 `spec validate` 的未解析集合完全一致。
- **风险**：节点规模（大项目 flow/capability 很多）→ 只渲染 kind 层，展开才取子层；
  不引入图形库，用固定层级 + 确定性布局（同一份 spec 每次布局一致，便于截图比对）。

### N2 编辑器内引用高亮

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
- **风险**：textarea 与镜像层的像素级对齐（换行、滚动、Tab）；IME 组合期抖动；大文件 token 数量。
  缓解：两者共用同一 CSS；`compositionstart/end` 期间暂停刷新；token 数超上限时只请求视口附近。

### N3 Job 持久化

- **目标**：serve 重启后任务中心、change 运行日志、eval 报告仍在；过期任务可回收。
- **落点**：
  1. `domains/server/jobs.ts` 增加持久化：记录写 `.cometflow/runtime/jobs/<id>.json`（`atomicWriteJson`），
     日志追加写 `.cometflow/runtime/jobs/<id>.log`（`appendLineAtomic` + 1MiB 轮转，与 change journal 同款）。
  2. `JobManager` 启动加载最近 N 条（默认 100）到内存；完成/失败时落盘；`clearFinished()` 同时删文件。
  3. 落盘前过 `platform/io/redact.ts`（H2 已落地）：agent stdout 里可能带凭证。
  4. 接入 `domains/workflow/evidence-retention.ts`：`collectEvidenceUsage` 统计 jobs 占用，
     `planEvidenceGc` / `applyEvidenceGc` 增加「已结束且超过保留期（默认 14 天）」候选；`doctor` 报告占用与可回收量。
- **验收**：跑一次 eval → 重启 serve → 任务中心仍有该任务与报告（`GET /api/jobs` 带 `finishedAt` 与 `result`）；
  日志轮转后读取端仍返回「摘要 + 最近 N 行」；日志含 `sk-` / `Bearer ` 形态时不落原文；
  `change gc --apply` 只回收已结束任务。
- **风险**：写放大（每 job 两个文件）→ 只在状态变化时写记录、日志按行追加；磁盘上限由保留期 + 上限共同约束。

### N4 并发写保护

- **目标**：CLI 与 serve（或两个 CLI 会话）同时操作同一项目时，不再「后写的静默覆盖前写的」。
- **两层方案**（先乐观、后悲观，避免到处加锁）：
  1. **单文件乐观 CAS**：写入前记录目标文件的内容哈希与 mtime，提交前再读一次比对，不一致则中止并报
     `concurrent-modification`（附路径与两次哈希），由调用方决定重读还是放弃。适用：`task-plan.yaml`、
     `comet-state.yaml`、`config.yaml`、`specs/**`、`spec-lock.json`。
  2. **多文件事务锁**：涉及多文件一致性的动作（`change archive` 的 `applyProposedSpecs`、`plan freeze`、
     `spec restore`、UI 批量写）先取 `.cometflow/runtime/lock`：内容 `{ pid, host, started_at, action }`，
     TTL 默认 120s；取不到锁立即失败并提示「另一个进程正在执行 <action>（pid/host/时间）」；
     `doctor` 把滞留锁报 error，并给出 `cometflow doctor --force-unlock`（人工确认后清理）。
- **落点**：新增 `platform/fs/file-lock.ts`（`acquireLock` / `releaseLock` / `readLock` / `inspectStaleLock`）
  与 `platform/fs/cas-write.ts`（`writeWithCas`）；写入点改造集中在 `change-store` / `task-plan-store` /
  `spec-version` / `spec-lock` / `project-config`；API 层把冲突映射成 **409 `concurrent-modification`**。
- **验收**：两个进程同时 `change archive` 同一个 change → 一个成功、另一个明确 409 并给出冲突文件与哈希；
  持锁进程被杀 → 下次取锁按 TTL 判陈旧并自动接管，journal 记一条 `lock-recovered`；
  `doctor` 对陈旧锁给 error 与修复命令；并行**读**不受影响（只对写加锁）。
- **风险**：Windows/NFS 锁语义差异（用「创建即独占」的文件 + TTL，不依赖 OS advisory lock）；
  时钟漂移让 TTL 误判（同时校验 pid 是否存活）；过度加锁拖慢长任务 → agent 运行期间不持锁
  （它本来就只写 `changes/<name>/`），只在多文件提交窗口持锁。

### N5 UI 编辑 spec 的语义（草稿 vs 立即版本）

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
- **落点**：`web/src/views/panels/SpecsPanel.vue` 的编辑器加「预览变更 / 撤销上一版」；
  复用 `domains/spec/spec-version.ts` 已有的 `readSpecBlob` / `resolveSpecVersionRef`；无需新端点。
- **需要决策**：写 **ADR 0019《UI 编辑 spec 的语义》**，明确「界面不引入第二事实源；草稿只有 change 提案一种形态；
  每次保存都是一次版本」。
- **验收**：保存前必出 diff；撤销后 `spec verify` 通过、lock 与版本链一致；USAGE §12 与 ADR 0019 互相引用。

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
| M2 可信度 | N3 + N5 | 重启 serve 后任务与日志仍在；spec 编辑有 diff 预览与撤销，语义写进 ADR 0019 |
| M3 并发与发布 | N4 + N6 | 并发写冲突返回 409 且有恢复路径；发布链路一次构建同时产出 CLI 与前端并做校验 |

## 5. 完成定义（DoD）

每一项都必须同时满足：

1. 有单元或端到端测试，且覆盖**失败路径**（未解析引用、并发冲突、重启恢复、脱敏命中）；
2. 在 `experiments/regression-fixture` 增加回归场景并接入 `run-regression.sh`；
3. CLI 与 API 共享同一投影（新能力先在 `domains/` 落地，再加端点与命令，不在客户端重实现领域逻辑）；
4. 用户可见行为变化更新 `docs/USAGE.md`；涉及语义决策的补 ADR；
5. 浏览器端到端走查一遍（本地 serve + 真实项目），控制台无 error/warning。

## 6. 开放问题（需要先决策）

1. **N4 的粒度**：CAS 覆盖到 `specs/**` 会不会太严？本地单用户场景下 spec 并发编辑少见，
   但一旦发生就是「静默覆盖别人的契约」——建议默认覆盖，用 409 + 明确提示换安全。
2. **N3 的保留策略**：保留期取 14 天，还是「最近 100 条 + 30 天」双阈值？回收必须默认 dry-run。
3. **N1 是否暴露给 CLI**：`cometflow spec graph --json` 对脚本与 CI 有用（可把「未解析引用数」纳入门禁），
   但要确认它与 `spec verify` 的职责边界（图是投影，verify 是门禁）。
4. **N5 的 C 选项体验**：从「编辑 spec」到「建一个 change 承载草稿」之间需要引导，
   是否提供「把当前编辑内容存成提案」的一键动作（等价写 `changes/<name>/specs/`）。

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
