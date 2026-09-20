# spec 的作者与把关：草案标记、审核策略、capability 骨架入口

状态：**G1–G4 已实施**（2026-09-16；实施结果见 §7）
来源：2026-09-16 复核「`specs/<capability>/spec.md` 是不是都必须人写」时，逐个落到代码上对账
关联：[ADR 0003](../decisions/0003-plan-review-policy.md)（拆解审核三档）、
[ADR 0010](../decisions/0010-spec-artifact-kind-model.md) / [ADR 0011](../decisions/0011-init-kind-scaffolding.md)（kind 与脚手架）、
[010-init-scaffolding](../design/010-init-scaffolding.md)、[003 任务规划](../design/003-task-planning.md)、
[web-ui-coverage-audit.md](./web-ui-coverage-audit.md)（C18）

## 0. 背景：capability spec 现在有四条产出路径

| 路径 | 谁产出内容 | 落点 |
|---|---|---|
| 手写 | 人（编辑器 / Web「Spec 文件」页签） | `POST /specs` 写文件后立即 `refreshSpecBaseline({ note: 'web edit' })` |
| `spec scaffold --capability <name>`（可重复） | 机器给**骨架**，内容仍要填 | `capabilityTemplate()`：front-matter + `## GET /example` + `## Acceptance / A1：<…>`，幂等、不覆盖 |
| `plan generate` → `spec-authoring` 任务 | **Agent** | 缺 spec 时发任务（标题「起草 `<cap>` capability spec」，`spec_ref: null`），由 Builder 执行 |
| `spec import`（CLI / Web 导入页签） | 机器从表格生成 | `renderCapabilitySpec()`；已存在的 capability 不带 `force` 会跳过 |

结论：**内容不必须由人写**。但下面四处让「谁写、谁把关」要么只停在文档里，要么只覆盖半条链路。

## 1. G1｜`[DRAFT]` 草案标记只有文档，没有实现

**证据**：`rg "DRAFT" domains app` 只命中 `docs/USAGE.md` 一处文档；`domains/spec/**` 里没有草案概念。

**影响**：无法区分「人批准过的契约」与「Agent 刚起草的稿」。`spec validate` 只看结构，`spec lock` 只记 hash，
两者都不体现作者或批准状态——所以今天无法回答「这个 anchor 有没有被人确认过」。

**候选修复**

- A｜spec front-matter 增加 `status: draft / approved`：`spec parse` 读出、`spec verify` 对 draft 报 warning、
  `plan freeze` 拒绝 draft 参与冻结。状态随 spec 文件走，跨机器可携带。
- B｜只在计划层表达：不引入新字段，`plan freeze` 要求「spec 自上次 review 后未被改动」。

**倾向**：A，但要先定「谁把 draft 改成 approved」——那是 G2。B 作为兜底（不引入字段，但状态不随文件走）。

**验收**：`spec verify` 对 draft spec 给出可识别 finding；`plan freeze` 在 spec 仍为 draft 时拒绝；两条都有测试。

## 2. G2｜`plan_review` 策略配置未被消费

**证据**：`plan_review?: string` 只在 `domains/project/config.ts` 声明与默认（`high-risk`），`rg plan_review` 没有任何消费点；
`plan review` / `plan approve` 是纯状态迁移（`app/commands/plan.ts` 的 `markTaskPlanReviewed` / `markTaskPlanApproved`）。

**影响**：ADR 0003 的 `auto / high-risk / human` 三档至今是空配置——「谁来 review」只取决于谁敲命令。
2048 的 `config.yaml` 写着 `plan_review: auto`，但平台不会因此自动放行，也不会因此停下。

**候选修复**

- A｜最小语义：`auto` → `plan generate` 后自动 review + approve；`human` → 维持现状（必须人工敲）；
  `high-risk` → 先显式报「未实现」（高风险规则要先定义，不在本批编造）。
- B｜暂不实现，只把该键标为「未实现」并在 config 写入时拒绝，避免继续误导。

**倾向**：A 的最小版；`high-risk` 的规则另开条目。

**验收**：策略为 `auto` 时，`plan generate` 之后的计划直达 approved 且 journal 记录来源；`human` 保持现状；两档都有测试。

## 3. G3｜Web 端不能为 capability 建骨架（同时登记为审计 C18）

**证据**：`POST /spec/scaffold`（`domains/server/api.ts:647`）只接受 `kinds` / `answers`，走 `scaffoldKinds` / `scaffoldProject`；
`--capability` 只在 CLI（`app/cli/index.ts:687` → `specScaffoldCommand` → `scaffoldCapabilities`）。
Web「脚手架」页签的请求体也只有 `answers`（`web/src/views/panels/specs/ScaffoldTab.vue`）。

**影响**：四条产出路径里，界面只暴露「手写 / 导入」两条。新建项目（向导只做 root kind）之后，
想在界面上给新的 capability 起个骨架只能切回 CLI；而「缺 spec → `spec-authoring` 任务」这条路也要先跑 `plan generate`（同样是 CLI）。

**候选修复**：端点接受 `capabilities: string[]`（复用 `scaffoldCapabilities`，幂等语义不变），
页签加可重复的 capability 输入 + 「生成骨架」；同时把返回的 `skipped` 显式呈现（现在是静默跳过）。

**验收**：在 Web 上为一个不存在的 capability 建骨架后，Specs 面板出现该文件、`spec validate` 无新增 error；
对已存在的 capability 再点一次不改变文件内容。

## 4. G4｜`spec-authoring` 任务的护栏是空的

**证据**

- `plan validate` 对 `spec-authoring` 直接 `continue`（`domains/task-plan/task-plan-validate.ts:46`）——不查 anchor、不参与 coverage；
- `plan freeze` 把它原样冻结（`domains/task-plan/task-plan-freeze.ts:31`）——不解析 spec、不绑 hash / anchor / acceptance；
- `change run` 的提示词在 `state.spec_ref` 为空时直接返回空段落（`domains/workflow/change-execution.ts:109`）——
  Agent 实际只拿到 `brief.md`（标题 + 两条 DoD）；
- `validateVerifierCoverage` 拿 `state.acceptance_ids` 做对照（`domains/workflow/change-verifier.ts:163`），
  spec-authoring change 这份清单是空的，于是「覆盖 0 条」也算通过。

**影响**：Agent 起草的 spec 可以不经过任何结构校验就随计划冻结；验收环节也盖不出「这份 spec 合不合格」的结论——
只有事后单独跑 `spec validate` 才知道。

**候选修复**：给 spec-authoring 任务补最小验收——冻结前要求目标文件已存在、且 `spec validate` 对该文件无 error
（失败则禁止冻结，理由写进 findings）；`change run` 的提示词至少带上该 goal 的范围与成功标准。

**验收**：spec-authoring 任务在文件仍缺失时无法 `plan freeze`；提示词里出现 goal 的成功标准；两条都有测试。

## 5. 完成定义（DoD）

沿用前端两批的 DoD：①端点 / 域函数有测试且覆盖失败路径；②与 CLI 同源（同一份判定函数，不复制规则）；
③`scripts/regression.mjs` 补对应场景；④`docs/USAGE.md` 同步（§1.5 所有权表、§13 语义节）；
⑤浏览器端到端走查；⑥回填本计划与 `docs/plan/README.md` 的状态列。

## 6. 明确不做

- 不做 LLM 智能拆解：ADR 0007 已把 `plan generate` 的 LLM 版列为未来项，本批只补「谁写、谁把关」的机制；
- 不引入第二套事实源：草案状态只能落在 spec 自身（G1 的 A）或计划记录里（G1 的 B），不新建数据库或旁挂索引。

## 7. 实施结果（2026-09-16）

| 项 | 落点 | 验证 |
|---|---|---|
| G3 capability 骨架入口 | `POST /spec/scaffold` 接受 `capabilities[]`（复用 `scaffoldCapabilities`）；脚手架页签可点名生成，分别显示 created / skipped / invalid | 回归新增 8 步；`serve-spec-api` 新增 2 例（幂等、非法名不落盘、同一请求里合法项照建） |
| G3 顺带修复 | 端点缺 stack 时改用 `loadProjectContext` 推导 root kind：此前空串会被判成 `absent`，点一次「生成 / 补全」就把 models/pages/constraints 写成「本项目不需要」 | 新增用例：临时把 project-context 的 database 改成 PostgreSQL → models 必须为 present |
| G2 审核策略 | 新增 `domains/task-plan/plan-review-policy.ts`，`plan generate` / `plan regenerate`（CLI 与 HTTP 共用）按其推进：`auto` 校验通过即 review+approve，校验有 error 则停在 draft；`human` 停在 draft；`high-risk` 与未知值按 `human` 兜底并在 note 里说明 | 新增 `plan-review-policy.test.ts` 6 例；Plans 面板显示当前策略与上次结论；回归断言 auto 下 G3 计划直达 approved |
| G1 草案标记 | front-matter 新增 `status`（缺省=approved，存量项目不受影响）；`spec scaffold` / `spec import` 产物写 `status: draft`；`spec verify` 报 `spec-is-draft`（warning）；`plan freeze` 拒绝草案；新增 `cometflow spec approve <spec-file>` 与 `POST /spec/approve`；Spec 文件页签显示定稿状态并可一键批准 | 新增 `spec-status.test.ts` 5 例 + API 1 例（含出界路径 400、重复批准不改文件） |
| G4 起草任务护栏 | ① 起草类 change 不再被 `confirm-acceptance` 的 acceptance 门槛卡死（`task_kind: spec-authoring` 例外，其余不变）；② `change verify` / `change archive` 前必须确认产物存在且 `spec validate` 无 error；③ 提示词从空段落改为「产物路径 + 写作要求（含 `status: draft`）+ goal 的范围 / 成功标准 / 非目标」 | 新增 `spec-authoring-guard.test.ts` 3 例；回归新增 10 步（含「缺产物时验收被拒」） |

两处与原计划的偏差，都以代码事实为准记录在此：

1. **G4 的拦截点从 `plan freeze` 改到 `change verify` / `change archive`**。冻结发生在起草**之前**——
   「spec 缺失」正是产生这条任务的原因，在冻结时要求产物存在等于让这条路走不通。原计划 §4 的验收项
   「spec-authoring 任务在文件仍缺失时无法 `plan freeze`」按事实改为「无法通过验收 / 归档」。
2. **G4 还发现了一条更深的堵点**：`applyChangeTransition(confirm-acceptance)` 要求
   `acceptance_ids` 非空，而起草类任务的 acceptance 天然为空——起草 change 连 `shape → build` 都走不过去，
   「先起草 spec」这条设计好的路径此前是死的。现在只对 `task_kind: spec-authoring` 放开这一条。

3. **G1 补漏（2026-09-20）**：`spec scaffold` 的 root kind 模板（models / protocol / errors / config /
   constraints / permissions / rules / process / pages）当时没写 `status: draft`——同一条命令产出的
   `capability` 骨架是草案，root kind 骨架却按「缺省即已定稿」进盘，与本节「`spec scaffold` 产物写
   `status: draft`」的结论不符（测试只覆盖了 capability 路径，所以没被抓住）。现在 `scaffoldKinds`
   写盘前统一过 `setSpecStatus(template, 'draft')`，并补了单元断言（root kind 与 capability 同口径）
   与回归步骤（重建出来的 root kind 必须是草案；`spec verify` 报 `spec-is-draft` warning 但不判失败）。

测试与验证：全量 `npx vitest run` **80 文件 / 480 例全绿**；`scripts/regression.mjs` **132 步 PASS**；
`tsc --noEmit` 与 `vue-tsc --noEmit` 通过；`pnpm build`（tsc + vite）通过。
