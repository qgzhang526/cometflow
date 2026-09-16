# Web 前端可见性计划（把「后端算出来了但只能敲命令」清零）

状态：**V1 / V2 已完成**（见 §3.1、§3.2，均含测试与浏览器走查）；V3–V4 只排序、未细化
分支：`codex/enrich-ui`（本计划的所有改动与提交都在该分支，完成后再合并回 `main`）
基线：`main @ 2a4d54f`（含平台侧 P1–P5）+ 本分支的审计文档 `94795ca` 起
来源：[web-ui-coverage-audit.md](./web-ui-coverage-audit.md) 的 §9 候选清单（本计划把 §9 变成可开工的批次）
关联：ADR 0007（UI 只走 headless service）、ADR 0013（验收必须可执行）、
ADR 0018（current-change 路由与 fail closed）、ADR 0021（并发写保护）、ADR 0023（平台 hook）、ADR 0025（git 提交门禁）、
[platform-next-plan-2.md](./platform-next-plan-2.md)（同一件事的后端半场）、
[web-ui-enrichment-plan.md](./web-ui-enrichment-plan.md) / [web-ui-followup-plan.md](./web-ui-followup-plan.md)（前两批前端工作）

## 0. 与平台侧计划的关系（避免重复劳动）

`platform-next-plan-2.md` 的 P1–P5 做的是**后端/CLI 的那一半**：doctor 能汇总写保护状态、门禁能在提交时挡住、
metrics 阈值可配、findings 有统一投影。本计划做的是**可见性的另一半**：把这些已经算出来的结论搬到界面上。

所以本计划**不新增业务逻辑**，也不做第二判定源——每个端点都只是已有领域函数的薄封装，
每个界面结论都必须与对应 CLI 命令逐字同源（这是 ADR 0007 的做法，也是前两批前端工作的 DoD）。

## 1. 范围与排序

| 批次 | 事项 | 来源 | 后端现状 | 规模 | 依赖 |
|---|---|---|---|---|---|
| **V1-1** | 统一 findings 端点 + 总览「问题清单」卡 | 审计 §5.1 新增 | `domains/gates/findings.ts`（`collectFindings` / `dedupeFindings` / `formatFinding`） | S | 无 |
| **V1-2** | `metrics` 端点 + 总览「质量与健康度」卡 | 审计 C2 | `collectMetrics` / `MetricsReport` / P3 的阈值回显 | M | 无 |
| **V1-3** | current-change 指针端点 + Changes 面板与 Hook 预览入口 | 审计 C3 | `readCurrentChange` / `selectCurrentChange` / `clearCurrentChange` | S | 无 |
| **V1-4** | doctor 三个维护动作端点 + 总览按钮 | 审计 C1 | `removeOrphanTempFiles` / `applyJobGc` / `forceUnlock`，且 dry-run 数字已在 `runDoctor` 里算好 | M | V1-1（同一张卡承载 findings 与动作） |
| ✅ V2-1 | `change gc` 端点 + 证据占用 | 审计 C4 | `planEvidenceGc` / `applyEvidenceGc` | S | 无 |
| ✅ V2-2 | `evolve rollback` 投影 + Evolve 面板回滚指引 | 审计 C6 | `evolution-service.ts` | S | 无 |
| ✅ V2-3 | 写保护状态表（hook 安装/版本/CLI 解析） | 审计 C11 | `hookStatus`（P1 已补齐 `guardOutdated` / `cli`） | M | V1-4（同一套「维护/守卫」面板语言） |
| V3-1 | `gate check` / `gate status` 可见性 | 审计 §5.1 新增 | `domains/gates/spec-gates.ts`、`git-hook.ts` | M | V1-1（findings 已统一） |
| V3-2 | `plan trace` 端点 + Plans 面板追溯视图 | 审计 C7 | `task-plan-trace.ts` | S | 无 |
| V3-3 | `spec import` 端点 + Specs 面板导入页签 | 审计 C8 | `spec-import.ts` | M | 无 |
| V3-4 | `spec anchors` 平铺视图 | 审计 C9 | `buildSpecIndex` | S | 无 |
| V4-1 | Eval 历史对比 | 审计 C15 | 任务已持久化（`job-store`） | M | 无 |
| V4-2 | TopBar 健康徽章 | 审计 C14 | V1-1 的 findings | S | V1-1 |
| V4-3 | 目标单条编辑/删除 | 审计 C16 | `goal-sync` + COMETFLOW.md 分段写 | M | 无 |
| V4-4 | Classic 定位（补最小闭环或明确标注 CLI-only） | 审计 C10 | `domains/classic/*` | 决策 + S | 需先定方向 |
| V4-5 | B 类两个冗余端点清理（`/config/project`、`/spec-index`） | 审计 §6 | — | S | 无 |

排序原则：

1. **V1 只做「薄封装 + 已经算好的结论」**：四个事项都不新增领域逻辑，做完之后界面上不再有「后端有、前端零可见」的
   整块空白，剩下的都是表达力问题。
2. **先 findings，再 metrics/doctor**：`collectFindings` 已经把「spec verify + doctor 两个来源」统一成一份带
   `code/subject/severity` 的列表，V1-1 一次就把 C1 的展示层和 C14 的数据源都建好；doctor 的三个维护动作挂在同一张卡上，
   才不会出现「一张卡说问题、另一张卡说清理」的割裂。
3. **写操作最后做**：V1-4 是 V1 里唯一有破坏性的批次（删临时文件、删任务证据、强制解锁），放在三个只读项之后，
   且必须复用 dry-run 数字 + 二次确认。
4. **V2 补「用户会卡住」的收尾动作**（证据回收、回滚指引、写保护可见），V3/V4 是表达力与余项。

## 2. 现状证据

| 事项 | 现状落点 | 为什么现在不够 |
|---|---|---|
| 统一 findings | `domains/gates/findings.ts:47` 的 `collectFindings(projectRoot)` 并发跑 spec verify 与 doctor，`dedupeFindings:29` 按 `(code, subject)` 去重并丢掉 doctor 对 verify 的镜像，`formatFinding:77` 给人类读法；CLI 走 `gate check --findings` / `spec verify --with-doctor` | 这份投影**没有 HTTP 端点**，界面上只有 `OverviewPanel.vue` 把 doctor 的 findings 逐条 `[severity] code message` 打出来（且只有 doctor 一个来源，没有 spec verify、没有去重、没有 subject 跳转） |
| 度量投影 | `domains/metrics/metrics-service.ts:16` 的 `collectMetrics`，返回 `MetricsReport { rebuild, spec_health }`（`types.ts:100`）；`formatMetrics:70` 给 CLI 排版；P3 之后 `cometflow metrics` 还回显生效的门禁阈值 | `domains/server/api.ts` 里搜不到 `metrics`，`web/src` 里也搜不到——重建质量（first_pass / pass / blocked / check_coverage）与 spec 健康度（acceptance_checkable / anchor_coverage / drift / versions）在界面上一个字都没有；CI 基线与开发者看到的不是同一组数字 |
| current-change 指针 | `domains/workflow/current-change.ts` 的 `readCurrentChange:20` / `selectCurrentChange:48`（带 `source: 'manual'`）/ `clearCurrentChange:66`；`hook-guard.ts:50` 在多个活跃 change 且指针缺失时返回 `multiple-active-changes`（fail closed），`:66` 在指针指向已归档 change 时返回 `stale-current-change` | 只有 CLI `change select` 能写这个指针，界面上没有读写入口。于是「界面里写文件被拒」这件事在多活跃 change 的项目里是**无解状态**：用户看得到 `reason` 却没有任何恢复路径（`AssetsPanel.vue` 的 Hook 预览把规则写在文案里，但没有动作） |
| doctor 维护动作 | `doctor.ts:35` 的 `DoctorOptions { cleanTemp, cleanJobs, forceUnlock }`；对应实现 `removeOrphanTempFiles`（`platform/fs/atomic-write.ts`）、`applyJobGc`（`domains/server/job-store.ts`）、`forceUnlock`（`platform/fs/file-lock.ts`）。dry-run 数字在 `runDoctor` 里已经算出来了（`orphans` / `jobPlan` / `inspectLock`） | 端点只有 `GET /project/doctor`（`api.ts:378`），三个开关**只能从 CLI 传**。findings 的文案直接把用户推回终端：`doctor.ts:229/281/342` 分别写着「运行 cometflow doctor . --clean-temp / --clean-jobs / --force-unlock」，`:254` 写「运行 cometflow change gc . --apply 清理」 |

## 3. 分项计划

### V1-1 统一 findings 端点 + 总览「问题清单」卡

- **目标**：界面上回答「这个项目现在有哪些问题」，一次看全（spec verify + doctor 两个来源）、去重、可跳转。
- **落点**：
  1. `GET /api/projects/{id}/findings`：薄封装 `collectFindings(root)`，响应 `{ findings }`；
     与 `gate check --findings` 共用同一份实现，不重新拼装（ADR 0007）。
  2. 前端新增 `FindingsCard`（挂在总览，替换现在那张只列 doctor 的卡）：
     按 `severity` 分组（error → warning → info）、显示 `code` / `subject` / `message`，
     并给出「来源」标记（verify / doctor）。`subject` 能映射到面板时给跳转（change → Changes、spec → Specs、plan → Plans）。
  3. `OverviewPanel.vue` 顶部的 doctor 徽章改为由 findings 的 error 数驱动（现状是只看 `doctor.healthy`）。
- **验收标准**：
  - 界面上看到的条目集合与 `cometflow gate check . --findings` **逐条相等**（含去重结果），有测试钉住；
  - 制造一个 spec 漂移（改冻结任务的 anchor）→ 卡片出现该条，点击能跳到对应 change；
  - doctor 对 spec verify 的镜像条目不重复出现（去重生效）；
  - 端点失败路径有测试（未知项目 404）。

### V1-2 `metrics` 端点 + 总览「质量与健康度」卡

- **目标**：把 CI 用的那组指标搬到界面上，并且把「当前生效的门禁阈值」一起显示——否则就是一条看不见的约束。
- **落点**：
  1. `GET /api/projects/{id}/metrics`：薄封装 `collectMetrics(root)`，响应 `{ report }`。只读、无参数。
  2. 前端新增 `MetricsCard`（总览，可折叠）：
     - 重建质量：`sample_size` 与 `first_pass_rate` / `pass_rate` / `blocked_rate` / `check_coverage_rate`；
       样本不足时显示 `collectMetrics` 已有的提示语（`SMALL_SAMPLE_THRESHOLD` 与 `legacyChanges` 两种提示必须原样透出，不能吞掉）；
     - spec 健康度：`acceptance_checkable_rate` / `anchor_coverage_rate` / `drift` / `versions`；
     - 门禁阈值：复用 P3 的阈值描述函数（`domains/metrics/metric-gates.ts`），显示**当前生效**的
       `min`/`max`/`direction`+`tolerance`，并标注「未配置 → 只许持平或变好」。
- **验收标准**：
  - 卡片数值与 `cometflow metrics . --json` 逐字段相等（测试断言，不靠人眼）；
  - 配置 `gates.metrics.anchor_coverage_rate = { min: 0.9 }`（当前 0.75）→ 卡片显示该阈值且能被看出「不达标」；
  - 空项目（无归档 change）不报错，显示「样本不足」而不是 `NaN`/空白；
  - 只读端点，无写路径（不引入第二条写入通路）。

### V1-3 current-change 指针端点 + 两处入口

- **目标**：多活跃 change 时，用户能在界面上解决 `multiple-active-changes`，而不是被 fail closed 卡住。
- **落点**：
  1. `GET /api/projects/{id}/changes/current` → `{ pointer, resolved }`：`readCurrentChange` 的结果 +
     指针指向的 change 是否仍存在/未归档（`stale-current-change` 的判定依据）；
     `POST /api/projects/{id}/changes/current` body `{ name }` → `selectCurrentChange(root, name, { source: 'manual' })`；
     `{ name: null }` → `clearCurrentChange(root)`。
  2. 语义校验（与 CLI `change select` 一致）：change 必须存在且未归档，否则 409 `change-not-selectable`。
  3. 前端入口①：`ChangesPanel.vue` 列表顶部显示「当前指针：<name> / 未设置」，每个 change 行给「设为当前」，
     指针本身给「清除」；指针指向已归档 change 时给出明确提示。
  4. 前端入口②：`AssetsPanel.vue` 的 Hook 预览在返回 `multiple-active-changes` / `stale-current-change` 时，
     直接列出可选 change 并提供「设为当前 + 重新检查」，把拒绝变成可操作的一步。
- **验收标准**：
  - 两个活跃 change 且无指针时，Hook 预览显示 denied，按新入口设指针后再检查 → allowed（与 `hook check` 结论一致）；
  - 指针指向已归档 change → `GET` 回 `resolved: false` 并给出 `stale-current-change` 的解释；
  - 选中不存在的 change → 409，界面显示人话错误而不是 toast「失败」；
  - 端点有测试覆盖三种状态（无指针 / 有效指针 / 失效指针）。

### V1-4 doctor 三个维护动作端点 + 总览按钮

- **目标**：findings 说「该清理了」时，界面上能就地完成，且**先看到将要删什么**。
- **落点**：
  1. 三个端点（都需要二次确认，见下）：
     - `POST /api/projects/{id}/doctor/clean-temp` → `removeOrphanTempFiles(orphans)`；
     - `POST /api/projects/{id}/doctor/clean-jobs` → `applyJobGc(root, jobPlan)`（双阈值：最近 200 条 + 30 天，运行中的任务永不回收）；
     - `POST /api/projects/{id}/doctor/force-unlock` → `forceUnlock(root)`。
     三者都返回 `{ cleaned, report }`：`cleaned` 是本次实际删除的量，`report` 是运行后的新 `runDoctor` 结果（界面据此刷新卡片，不用再点一次刷新）。
  2. **必须先展示 dry-run 数字**：`runDoctor` 已经把 `orphans` / `jobPlan` / `inspectLock` 算出来了，
     界面在按钮旁直接显示「将删除 N 个残留临时文件 / 回收 N 个任务（X MB）/ 清理持有者 pid=… action=… 的滞留锁」，
     并把同样的数字作为请求体回传（`{ expected: … }`）——数字不匹配则 409，避免「确认时看到的是 A、执行时删的是 B」。
  3. `forceUnlock` 额外要求：持有者信息（pid / host / action / started_at）必须在确认弹窗里显示，
     并且按钮文案写明「确认持有进程已退出」。它是三个人工判断里最危险的一个（清理错误 = 两个进程同时写同一项目）。
  4. 三个端点都不在锁内执行破坏性动作以外的逻辑；`forceUnlock` 不与其他写操作并行。
- **验收标准**：
  - 人为制造残留临时文件（写一半中断）→ 总览显示可清理量 → 点击后文件消失且 findings 里对应条目消失；
  - `clean-jobs` 只回收已结束任务（运行中的任务数量前后不变，测试断言）；
  - 滞留锁场景：`inspectLock` 报 error → 界面显示持有者 → force-unlock 后 `inspectLock` 为空；
  - 不匹配的 `expected` 数字返回 409 且**没有删除任何文件**（这条必须有测试，它是唯一能防止误删的护栏）；
  - 三个端点各自的失败路径有测试（无残留 / 无滞留锁 → 明确回「没有可清理项」而不是静默成功）。

## 3.1 实施结果（V1 已完成，2026-09-16）

四项全部落地，验证方式见下表（"同源"= 测试里把界面数据与对应 CLI 投影直接比对，不靠人眼）。

| 项 | 后端落点 | 前端落点 | 验证 |
|---|---|---|---|
| V1-1 | `GET .../findings`（薄封装 `collectFindings`） | `FindingsCard.vue`；总览徽章改为由 error 数驱动 | 与 `collectFindings` 逐条相等（测试）；真实项目 2048 上显示 28 error / 9 warning |
| V1-2 | `GET .../metrics`（`collectMetrics` + `readMetricsGate` + `describeMetricsGate`） | `MetricsCard.vue`（默认折叠；含生效阈值与口径提示） | 与 `collectMetrics` 的 `rebuild` / `spec_health` 深比相等（测试）；未配置时给出 6 行内置方向表 |
| V1-3 | `GET/POST .../current-change` | Changes 面板指针行（设为当前 / 清除）；资产面板 Hook 预览的恢复入口 | 端到端：无指针 → `multiple-active-changes` 被拒 → 设为 `build-change` → 同一写入 `allowed`（测试 + 浏览器实测） |
| V1-4 | `POST .../project/doctor/{clean-temp,clean-jobs,force-unlock}` + `domains/dashboard/maintenance.ts`（预告与校验的唯一实现） | `MaintenanceCard.vue`（预告 → 确认弹窗 → 执行） | 预告值不匹配 → 409 且文件仍在（测试）；浏览器实测：1 个残留文件 → 确认弹窗显示路径 → 执行后文件消失、卡片归零 |

实现中的两处偏离（以正确性为准，在此登记，不静默改需求）：

1. **指针端点路径取 `/current-change`，而不是计划里的 `/changes/current`**：后者会把一个真叫
   `current` 的 change 永久遮蔽掉（change 名只禁止路径分隔符，其余字符串都合法）。
2. **findings 与维护动作分成相邻的两张卡**，而不是计划里写的「同一张卡」：问题清单长度不可控，
   把破坏性按钮混进长列表更容易误点。两张卡相邻、共用同一次快照取数，仍然满足「不割裂」的初衷。

顺带修掉一个在浏览器走查里暴露的**既有缺陷**：`ProjectView` 的面板 key 只含 `activePanel + panelEpoch`，
切换项目时面板实例被复用，于是面板自取的数据会停在上一个项目的快照上（store 里的 `status` / `doctor`
已经换成新项目）。现在 key 里带上 projectId，切项目即重新挂载，所有面板一起受益。

测试与验证：

- 新增 `test/domains/serve-visibility-api.test.ts`（10 例）：同源断言 2 例；维护护栏 4 例
  （不匹配不删、缺预告值 400、无锁 409、持有者变化 409）；指针流转 2 例；失败路径 2 例。
- 全量 `npx vitest run` → **76 文件 / 448 例全绿**；`pnpm typecheck` 与 `pnpm web:typecheck` 均通过。
- `node scripts/regression.mjs` → **PASS（110 步）**。这里刻意**不新增**回归步：本批的新能力全在 HTTP 层，
  而回归脚本是 CLI 驱动的——它已经覆盖了等价的 CLI 侧行为（末尾的 `change select --clear` →
  `hook check` denied `multiple-active-changes`；P5 加的 `gate check --findings` 步骤）。
  在同一件事上再写一遍 CLI 断言只会增加维护面，HTTP 层交给 `serve-*-api` 系列测试。
- 浏览器走查（`pnpm web:dev` + 真实 serve）：在真实项目 2048 上看三块卡片，控制台无 error/warning；
  在临时 demo 项目上跑通「设指针 → Hook 放行」与「清残留文件 → 文件真的消失」两条写路径。

## 3.2 实施结果（V2 已完成，2026-09-16）

| 项 | 后端落点 | 前端落点 | 验证 |
|---|---|---|---|
| V2-1 | `POST /project/evidence/clean` + `MaintenancePlan.evidence`（`planEvidenceGc` 的只读预告） | 维护卡新增「change 运行证据」行：按 change 的占用（前 3）+ 可回收项数与体积 + 候选路径 | 预告值不匹配 → 409 且**证据文件仍在**；匹配 → 回收并回带新预告（测试）；浏览器实测 72 B 证据被回收、该行归零 |
| V2-2 | `GET /evolutions/{name}/rollback`（薄封装 `rollbackEvolution`） | Evolve 面板每个提案的「回滚指引」按钮 + 弹窗（只读投影） | 与 `evolve rollback` 输出同源（含 `git revert` 步骤）；未知提案 404（测试）；浏览器实测弹窗显示提案步骤与状态 |
| V2-3 | `GET /hook/status`（三个平台各一次 `hookStatus`） | 资产面板 Hook 页签顶部的「写保护状态」表：支持性 / 条目数 / 守卫脚本 / 守卫调用的 CLI | 支持与不支持、装没装、是否漂移、CLI 能否解析一次看全；测试断言 claude-code `supported=true, installed=false`，另两个平台 `supported=false`（区分「不支持」与「未安装」） |

设计取舍（登记，不静默改需求）：

1. **证据回收并进同一张维护卡**，没有另开一张「证据占用卡」：对用户来说「会删东西的动作」只有一个入口更不容易漏点；
   按 change 的占用明细直接挂在该行下面（取前 3 条），需要看全的走 CLI `change gc`。
2. **`change gc --apply` 的 journal 轮转也算「执行的一部分」**：它不减少占用，只是把超大 journal 挪成 `.1.jsonl`；
   但预告值不匹配时我们**连轮转也不做**——「拒绝」必须是什么都不动，而不是「少动一点」。
3. **写保护状态放在资产面板**（它本来就是守卫与资产的落点），总览的位置留给 findings / metrics / 维护。

测试与验证：新增 6 例（证据回收 3、回滚投影 2、写保护状态 1），`serve-visibility-api` 合计 **16 例**；
全量 `npx vitest run` → **76 文件 / 454 例全绿**；两个 typecheck 通过；浏览器走查覆盖证据回收的真实删除与另两个只读投影。

## 4. 里程碑

| 里程碑 | 内容 | 完成标志 |
|---|---|---|
| V1 可见性清零 ✅ | V1-1 ~ V1-4 | 总览一屏能回答「现在有哪些问题、质量指标如何、谁在阻塞写入、要不要清理」；审计里 C1/C2/C3/C17 全部转 ✓（见 §3.1） |
| V2 收尾动作 ✅ | V2-1 ~ V2-3 | 证据占用、回滚指引、写保护状态都有界面出口；C4/C6/C11 全部转 ✓（见 §3.2） |
| V3 投影补齐 | V3-1 ~ V3-4 | 门禁状态、任务追溯、表格导入、锚点平铺可见；核心可见率回到 85%+ |
| V4 余项 | V4-1 ~ V4-5 | 审计 §1 的「无 UI 入口」只剩安装/运维类命令 |

## 5. 完成定义（DoD）

每个批次都必须同时满足（沿用前两批前端工作的 DoD）：

1. 端点有测试，且覆盖**失败路径**（未知项目、状态不匹配、无可清理项、指针失效），
   风格沿用 `test/domains/serve-*.test.ts` 的「起真服务器」；
2. **同源断言**：界面上展示的结论与对应 CLI 命令的输出逐条相等，测试钉住（findings 与 `gate check --findings`、
   metrics 与 `metrics --json`、指针与 `change select`/`hook check`）；
3. `scripts/regression.mjs` 补对应场景（至少在夹具上跑一次新端点）；
4. `docs/USAGE.md` 同步：§12.1 界面结构、§12.2 REST API 速查，涉及语义的补 §13（13.1 hook / 13.2 metrics / 13.3 gate）；
5. 浏览器端到端走查一遍（本地 serve + 真实项目，控制台无 error/warning），前端部分可在
   `pnpm web:dev` 的热更新会话里现场验；
6. 回填本计划与 `docs/plan/README.md` 的状态列，并同步 `web-ui-coverage-audit.md` §1 的数字。

## 6. 决策记录（2026-09-16，四条均按建议执行）

| # | 问题 | 选项 | 结论 |
|---|---|---|---|
| 1 | 是否把「统一 findings」纳入 V1？（它不在审计 §9 的原始 9 条里，是 P5 落地后新出现的投影） | A 纳入 V1-1；B 放 V3 | **A（已实施）**：它是 C1/C14 的天然数据源，先做它等于少写一套 doctor 专用渲染 |
| 2 | doctor 维护动作的写语义 | A 界面直接执行（带预告数字 + 二次确认）；B 界面只显示命令、让用户回 CLI | **A（已实施）**，其中 `force-unlock` 显示持有者并要求显式确认「持有进程已退出」 |
| 3 | metrics 卡片是否显示门禁阈值 | A 显示；B 只显示指标 | **A（已实施）**：P3 的动机就是「看不见的约束等于没有约束」，界面上同样成立 |
| 4 | 预告值不匹配时的行为 | A 409 拒绝；B 警告后照删 | **A（已实施）**：删除不可逆，宁可让人重看一眼；有测试钉住「拒绝时不删任何文件」 |

## 7. 与既有机制的关系（复用清单）

| 本计划用到的既有机制 | 出处 |
|---|---|
| 统一 findings 模型与去重 | `domains/gates/findings.ts`（P5） |
| 度量指标与门禁阈值描述 | `domains/metrics/metrics-service.ts`、`metric-gates.ts`（P3） |
| current-change 读写与 fail closed 判定 | `domains/workflow/current-change.ts`、`domains/guard/hook-guard.ts`（ADR 0018） |
| 原子写与残留临时文件识别 | `platform/fs/atomic-write.ts`（H1-1） |
| 任务证据保留策略与回收 | `domains/server/job-store.ts`（N3） |
| 多文件事务锁与陈旧锁判定 | `platform/fs/file-lock.ts`（ADR 0021） |
| 统一响应 envelope、SSE、任务中心、面板错误边界 | `domains/server/api.ts`、`web/src/stores/events.ts`、`PanelBoundary.vue` |

> 本计划不引入新的事实源：所有新增能力都是「读同一份状态 + 多一个视角」，
> 唯一的写语义变化是 V1-3（指针可写）与 V1-4（维护动作可写），两者都复用既有领域函数与校验。
