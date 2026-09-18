# 0030 spec 绑定口径：只认 capability；非绑定声明靠反向引用闭环

状态：已批准（2026-09-18）
关联：[009 工件分类与事实所有权](../design/009-spec-artifact-taxonomy.md)、
[011 spec 版本化](../design/011-spec-versioning.md)（Anchor 身份）、
[spec-anchor-scope-plan.md](../plan/spec-anchor-scope-plan.md)

## 背景

上一轮把 anchor 收敛成 **capability spec 的契约标题**（`docs/plan/spec-anchor-scope-plan.md`）：
flow 的三段式骨架、models 的实体清单、constraints 的各条约束都不再被当成锚点。
留下一个缺口：**非 capability 的声明没有任何机制保证"有人用"**。
`spec validate` 只做**正向**引用校验（引用的模型/错误码/配置键/协议头必须存在、flow 步骤引用的 API 必须存在），
没有**反向**的——声明了实体或规则却没有任何接口引用它，今天静默通过。

## 决策

### 1. 任务绑定单位只认 capability（`pages` 是唯一的将来项）

- **可绑定**：`specs/<capability>/spec.md` 的契约标题（`## POST /login` 这类）；
- **将来**：纯前端项目里 `specs/pages.md` 是同一性质的行为层文档，届时纳入同一口径；
- **永不绑定**：`models` / `rules` / `protocol` / `errors` / `config` / `constraints` / `process` / `flow` 的标题。
  它们是数据、规则、目录与结构——按 `plan generate` 派任务只会得到"实现实体：Session"这类假任务，
  并让 `anchor_coverage_rate` 永远偏低（详见下一节的理由）。

### 2. 非绑定声明靠**反向引用完整性**闭环

`spec validate` 增加两项检查（**warning**）：

| code | 判据 | 消息要点 |
|---|---|---|
| `unreferenced-model` | `specs/models.md` 的每个 `## 实体：<X>` 至少被一个**行为层**文件引用 | 补 `- 模型：X`，或删掉这个实体 |
| `unreferenced-rule` | `specs/rules.md` 的每条 `## 规则：<X>` 至少被一个**行为层**文件引用 | 补 `- 规则：X`，或删掉这条规则 |
| `unresolved-rule-reference` | 引用的规则必须存在（正向，配 `规则：X` 语法） | 名为 X 的规则不在 `specs/rules.md` |

**"行为层"= capability / flow / process**（009 的引用方向表里，这三类才是引用方；`rules` 只引 `models`，
`permissions` 引 `capability`，`constraints` 不引用任何东西）。

### 3. 传递一次：`rules → models` 不算"被使用"

实体被算作"有人用"的来源是：行为层直接引用，**或**它被一条**本身被行为层引用**的规则引用
（009 的 `rules → models` 是合法的数据层内部引用）。没人用的规则不能顺带把实体也"洗白"。

### 4. 为什么只查 models 与 rules

- `errors` / `config` / `protocol` 里"定义了但暂未使用"是**合法预留**（预留错误码、预留配置键、
  协议头/状态码本来就未必每个都被引用）——查它们只会产生噪音；
- `constraints` 是横切 NFR，落在多个实现里，靠 gates 与人工判断，不做引用闭环；
- `models` 实体与 `rules` 规则不同：它们定义**数据与不变量**——没人用就意味着多了一份没人兑现的事实来源，
  正是 009 第 1 条原则（每个事实只有一个 owner，其余只引用）要防的情况。

### 5. 严重度是 warning，不阻断

"有没有人用"有时需要人工判断（为下一个迭代预留的实体是常见情况），做成 error 会让存量项目
在 CI 上直接变红。要卡门禁时用 `gate check --findings` 的既有通道，或在后续批次加配置项升级为 error。

## 后果

正面：

- 悬空声明（没人用的实体/规则）从"静默通过"变成"可见的 warning"，且**不需要**给它们造假任务；
- 与 009 的事实所有权原则闭环：数据/规则层被行为层引用，行为层才是交付单位；
- 复用同一份引用语法（`模型：X` / `规则：X`），编辑器高亮与引用图自动认识新语法，不新增第二套。

负面与边界：

- "预留实体"会误报——用 warning + 消息给出"补引用或删掉"两条出路来缓解；
- 扫描成本 = 多读一遍行为层文件（本地几 KB，可忽略）；
- **不做**：不检查 `errors` / `config` / `protocol` / `constraints` 的反向引用；不给非 capability 文档加绑定能力。

## 实施记录（2026-09-18）

| 落点 | 实现 |
|---|---|
| 引用语法 | `domains/spec/spec-structure.ts` 的 `REF_RULES` 新增 `rule`：`(?:[-*]\s+)?规则[:：]\s*<name>`，`SpecRefKind` 增加 `'rule'`；`extractRuleRefs()` 与既有 extract* 同源（编辑器高亮 / 引用图自动认识） |
| 正向检查 | `spec-validate.ts` 的 `checkRuleRefs()`：引用的规则必须存在于 `specs/rules.md`（缺失文件时降级为 `missing-reference-target` warning） |
| 反向检查 | `checkUnreferencedDeclarations()`：扫描行为层（capability / flow / process）的 `模型：` 与 `规则：` 引用，算出被引用的实体与规则（含 `rules → models` 传递一次），未被引用的实体报 `unreferenced-model`、规则报 `unreferenced-rule` |
| 引用图 | `spec-graph.ts`：`rule` 纳入引用类型（`OWNER_KIND` / `REF_LABEL` / 目标索引 / `filesExist.rules`），并补 `capability/flow/process → rules` 三条 kind 边——图与 validate 必须同源，否则 `spec graph` 会在解析新引用时崩（实测踩到） |
| 夹具 | `experiments/regression-fixture` 的 `specs/session/spec.md` 在 `## 验收` 块里补 `- 规则：会话有效期`（放在验收块内 → **不动 anchor 正文哈希**，G4/T1 不会漂移），随后 `spec lock` 刷新锁 + `plan freeze G4` 重新登记 `spec_hash`/`plan_hash`，`gate check` 仍 PASS（含 metrics baseline） |

验证：

- `spec-cross-refs.test.ts` 新增 4 例：未引用实体 → warning（且 `valid` 仍为 true）、未引用规则 → warning、
  补 `- 规则：X` 后 warning 消失、引用了不存在的规则 → error、被"被遵守的规则"引用的实体经传递算已使用
  （而只被"没人遵守的规则"引用的实体仍然悬空）；
- 回归：只读阶段断言"夹具没有悬空声明"、改动副本里加一个 `## 实体：Orphan` → `spec validate` 报
  `unreferenced-model` 且仍是 `spec validate: OK`（**不挡门禁**）→ **155 步 PASS**；
- 真实项目（`cometflow-ui-demo`）：`spec validate` 命中一条 `unreferenced-rule`（规则 `会话有效期` 没有任何
  行为层引用），正是这条检查要暴露的情况；
- 全量 `npx vitest run` 99 文件 / 576 例；`tsc` / `web:typecheck` / `build` / `package-e2e` 全通过。
