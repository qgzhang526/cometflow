# 打开项目即接入：只有 COMETFLOW.md + specs/ 的目录怎么进平台

状态：**规划中**（2026-09-18 起草；§2.2 的清单合并规则已先行为「日常新建 capability」落地，见 §6）
来源：2026-09-18 复核「规格-导入 只支持粘贴，整包 specs 怎么进来」时，把真实工作流逐个落到代码上对账
关联：ADR [0011](../decisions/0011-init-kind-scaffolding.md)（init kind 脚手架）、
design [010-init-scaffolding](../design/010-init-scaffolding.md)、
[spec-authoring-plan.md](./spec-authoring-plan.md)（draft / approve 口径）、
design [011-spec-versioning](../design/011-spec-versioning.md)（版本与 lock）、
[capability-map.md](./capability-map.md) §1「建项目 / 接入已有项目」行

## 0. 真实顺序是「先有规格，后有项目」

本平台的目标用法里，`COMETFLOW.md` 与 `specs/`（12 kind + 各 capability）是**先跟 AI 对话产出的**，
把它们交给平台才是「创项目」这一步。也就是说，规格包在项目之前就存在，此时目录里：
有 `COMETFLOW.md`、有 `specs/`，**没有** `.cometflow/`、没有目标投影、没有 spec-lock、没有版本记录。

问题：这算「打开已有项目」还是「新建项目」？

**结论：算打开项目，而且它就是打开项目的主路径。** 但现实现把打开做成了「登记」（register），
用户真正需要的是「接入」（adopt）——登记 + 把 init 会派生出来的那批状态补齐。

这也解释了**为什么「规格-导入」页签不该承担这件事**：那个页签的语义是「从清单**生成**草案」，
而这里是「**承认**一份已经存在的规格包」。两者唯一的共同点是都往 `specs/` 写文件。

## 1. 现状对账（每条都有代码出处）

| 环节 | 现状 | 依据 |
|---|---|---|
| 打开入口 | `POST /api/projects/import` 只校验 `COMETFLOW.md` 存在，然后 `registerProject`，就此结束 | `domains/server/api.ts:333-350` |
| 新建入口 | `POST /api/projects` → `initializeProject` 在 `COMETFLOW.md` 已存在时抛错，所以这类目录只能走「打开」 | `domains/project/init.ts:67-74` |
| 缺 `.cometflow/config.yaml` | 不致命：读配置 ENOENT 时回退全局默认 | `domains/project/config.ts:191-203` |
| 缺 goals / plans 目录 | 不致命：状态采集宽容读取 | `domains/dashboard/collector.ts:33-42` |
| 目标面板 | **空白**：`GET /goals` 只读 `.cometflow/goals/*.yaml`，没 `goal sync` 就永远没有目标，`plan generate` 无目标可选 | `domains/server/api.ts:560-563`、`domains/goal/goal-sync.ts:113` |
| 版本与基线 | **没有**：`spec verify` 直接报 `missing-spec-lock`；版本页签空，`spec diff` / `impact` 没有可比的基线 | `domains/spec/spec-verify.ts:114-119` |
| 12-kind 状态 | **撒谎**：`/init-manifest` 为 null → 显示「还没有 init-manifest」，而磁盘上 12 类文件都在 | `web/src/views/panels/specs/KindsTab.vue:19` |
| `.gitignore` | 只有 init 会写 `.cometflow/` 条目，接入路径不写 | `domains/project/init.ts:46-59` |
| `spec validate` / 「Spec 文件」页签 | **是好的**：它们直接扫盘 | `domains/spec/spec-index.ts:43` `listSpecEntries` |

所以故障不是「看不见文件」，是**文件的派生状态没有建立**。这也意味着补起来不难：动作都是现成的领域函数。

## 2. 设计判断

### 2.1 术语：register vs adopt

- register（现状）：把项目路径写进 workspace 清单。
- adopt（本计划）：register + `goal sync` + `spec lock` + manifest 重算 + 目录与配置补齐。

界面上仍然叫「打开已有项目」，adopt 是它的实现，不是要新增一个用户概念。

### 2.2 init-manifest 必须按磁盘事实重算

`detectKindNeeds`（`domains/project/scaffold.ts`）是从 tech stack + 问答**倒推** kind 状态的。
接入时文件已经在磁盘上，倒推会和磁盘打架：问答里 domainDsl 选「否」而 `specs/rules.md` 确实存在，
manifest 会写 `absent`，KindsTab 于是再次显示与事实相反的状态。

**规则：磁盘事实 > 问答。**

| kind | present 判据 |
|---|---|
| project | `COMETFLOW.md` 存在（恒为 present） |
| capability | 至少一个 `specs/<cap>/spec.md` 存在 |
| flow | `specs/flows/` 下存在 `.md` |
| models / protocol / errors / config / constraints / permissions / rules / process / pages | 对应的 `ROOT_KIND_FILES[kind]` 存在（`domains/spec/kind.ts`） |

合并规则（必须能重复执行）：

1. 文件存在 → `present`，reason 写「磁盘上已存在（来自规格包）」；
2. 文件不存在、且旧 manifest 里该 kind 是 `absent` → **保留 `absent`**（尊重此前显式表达的「本项目不需要」）；
3. 其余 → `deferred`，reason 写「规格包中未包含，需要时用 `spec scaffold` 补骨架」。

第 2 条是关键：不能把「用户明确说过不需要」降级成「还没补」，否则每次打开项目都会抹掉一次明确的裁剪决定。
第 3 条同样重要：缺失 ≠ 本项目不需要，所以用 `deferred` 而不是 `absent`，不编造裁剪结论。

### 2.3 补齐动作（幂等，只补缺失，不覆盖内容）

| 动作 | 落点 | 语义 |
|---|---|---|
| 建目录 | `.cometflow/goals`、`.cometflow/plans` | `mkdir recursive` |
| 补配置 | `.cometflow/config.yaml`（`CONFIG_TEMPLATE`） | 仅在缺失时写；已存在**不动** |
| 补 `.gitignore` | 追加 `.cometflow/` 条目 | 复用 `ensureGitignore`（需从 `init.ts` 导出） |
| 目标投影 | `syncGoals`（COMETFLOW.md → `.cometflow/goals/*.yaml`） | 已是幂等派生 |
| 规格基线 | `refreshSpecBaseline({ note: 'adopt' })`（登记版本 + 写 spec-lock） | 已是幂等派生 |
| kind 状态 | 按 §2.2 重算 init-manifest | 合并，不是整体覆盖 |

**不碰 `specs/` 里的任何内容**：不生成模板、不覆盖、不改 `status`。

### 2.4 草案状态原样保留

包里带 `status: draft` 的 spec 接入后仍是草案，由 `spec verify` 的 `spec-is-draft` 警告自然暴露；
接入报告给出草案计数并指到「Spec 文件」页签。接入不替用户 approve。

理由：approve 是「人确认过契约」的声明，接入只是搬运。自动 approve 等于伪造一次人工确认。

### 2.5 失败语义

接入全程可重入：任何一步失败，再点一次即可（所有动作都是「补缺失」或「幂等重算」）。
因为不覆盖内容，重复执行不会破坏人工修改——这是它敢做成「点一下就好」的前提。

## 3. 落点与待办

| 项 | 落点 | 状态 |
|---|---|---|
| 领域函数 | 新增 `domains/project/adopt.ts` 的 `adoptProject(projectRoot)`，返回 `AdoptReport`（识别到的 capability / kind 文件 / 补齐项 / validate 结果 / 草案计数）；复用 `init.ts` 的模板与 `ensureGitignore`，不复制 | ⬜ |
| manifest 重算 | `domains/project/scaffold.ts` 新增 `detectKindNeedsFromDisk(projectRoot)` 与 `reconcileInitManifest(projectRoot)`（§2.2 的三条合并规则） | ⬜ |
| 端点 | `POST /api/projects/import` 升级为 adopt，返回 `{ project, report }`；`registerProject` 退化为内部步骤 | ⬜ |
| 界面 | 首页「打开已有项目」：选中目录后先给**接入预告**（识别到 N 个 capability / M 个 kind 文件、将补齐哪些派生状态、会写哪些文件），确认后执行并显示报告 | ⬜ |
| 测试 | `domains/project/adopt.test.ts`：只补缺失、二次执行零变化、§2.2 三条合并规则各一例、draft 原样保留；`serve-projects-api.test.ts`：只有 `COMETFLOW.md` + `specs/` 的目录 → 打开后 goals / lock / manifest 都就绪 | ⬜ |
| 回归 | `scripts/regression.mjs` 加一步：临时目录只放 `COMETFLOW.md` + `specs/` → 接入 → 目标投影与 spec-lock 存在、`spec verify` 不再报 `missing-spec-lock` | ⬜ |
| 文档 | `docs/USAGE.md` 的「打开项目」一节改写成「打开即接入」，列出会补什么、不做什么；`capability-map.md` §1 那一行的自验改成接入后的命令 | ⬜ |
| CLI（可后置） | `cometflow project adopt [path]`，与界面共用同一个 `adoptProject` | ⬜ |

## 4. 完成定义（DoD）

沿用前端几批的惯例：①领域函数有测试且覆盖失败路径；②与 CLI 同源（若本次做 CLI）；
③回归补场景；④`docs/USAGE.md` 与 `capability-map.md` 同步；⑤浏览器走查；
⑥回填本文件与 `docs/plan/README.md` 的状态列。

验收：

1. 一个只有 `COMETFLOW.md` + `specs/` 的目录（12 kind 齐全、含若干 capability、含 1 份 draft）：
   打开后目标页有目标、12-kind 页与磁盘一致、版本页签有记录、`spec verify` 不再报 `missing-spec-lock`；
2. **同一个目录再打开一次，文件零变化**（幂等，含 `config.yaml` 与 `init-manifest.yaml`）；
3. 原来被显式标成 `absent` 的 kind，在文件仍不存在时保持 `absent`（§2.2 第 2 条）；
4. 规格包里没有的 kind 显示 `deferred`，reason 说明「规格包中未包含」，而不是「本项目不需要」；
5. 报告与磁盘对账一致：报告说识别到 N 个 capability，`GET /specs` 里就是 N 个；
6. 若本次做 CLI：界面与 `cometflow project adopt` 走同一个领域函数，行为逐条一致。

## 5. 明确不做

- **不把这件事做进「规格-导入」页签**：那个页签的语义是「从清单生成草案」，接入是「承认已存在的规格包」。
  真要支持「把别的目录的 specs 搬进来」，是另一个场景（搬运 = 新增 / 冲突 / 覆盖预览 / 状态保留），另开条目；
- **不生成、不覆盖、不删 `specs/` 内容**：包括不给缺失的 kind 生成骨架模板——那是「脚手架」页签的事；
- **不自动 approve 草案**（见 §2.4）；
- **不做 zip / 目录上传**：`/api/fs/list` + `DirPicker.vue` 已经能选到本地目录，接入对象本来就是本机目录；
- **不清理陈旧的 goal 投影**：`syncGoals` 现状只写不删，重复接入不会删掉已从 COMETFLOW.md 移除的目标。
  这是既有行为，本计划不顺带改（改了会牵动调度顺序语义），另开条目。

## 6. 已落地的部分（2026-09-18）：清单合并规则先行用在「日常新建 capability」上

§2.2 那套「磁盘事实优先、合并而非覆盖」的规则不必等到接入才用——它本身就是 12-kind 页
在**已打开项目**里撒谎的原因：`detectKindNeeds` 把 capability 写死成 `absent`，而
`scaffoldProject` 用推断结果整体覆盖 manifest，于是新建多少个 capability 骨架，那一行都还是
`absent | derived from goals, not init`，点一次「生成 / 补全」还会把其它 kind 的判定一起冲掉。

先落地的是这一半（接入本身仍未做）：

| 项 | 落点 | 语义 |
|---|---|---|
| 磁盘证据 | `detectKindEvidence(projectRoot)`（`domains/project/scaffold.ts`） | 只回答「specs/ 下有没有这个 kind 的文件」，`COMETFLOW.md` 单独判；缺文件不下任何结论 |
| 清单合并 | `mergeKindEntries()` + `reconcileInitManifest()`（同文件） | 四支优先级：①文件在且旧判是 present → 连 reason 一起保留；②文件在且推断也 present → 用推断；③文件在但推断说 absent/deferred → 判 present（capability 永远走这支）；④文件不在 → 用推断（`absent` 是显式决定，`deferred` 是待补，都不被「这次没扫到文件」推翻） |
| 收尾入口 | `scaffoldProject()` 内联合并；`POST /spec/scaffold` 与 `cometflow spec scaffold` 回显 `changedKindStatuses()` 的差异；`POST /specs`（新建 spec 文件）也校正一次 | 「改了什么」靠校正前后两份快照对比得出——`scaffoldProject` 自己就会合并，只看事后那次校正会漏报 |
| 界面 | 「脚手架」页签：新增输入处**本地校验**（非法名不发请求）、提前提示「已存在、本次跳过」、下方列出已有 capability（草案 / 已定稿）并可直接点开编辑 | 事前知道结果，不用等事后那行 skipped |

证据：`test/domains/scaffold.test.ts` 新增 4 例（磁盘证据、只校正 capability 且保留其它判定、
没有 manifest 时不凭空造、`scaffoldProject` 合并而非覆盖）；`test/domains/serve-spec-api.test.ts`
新增 1 例（先退回按技术栈推的错状态，跑脚手架后 capability 变 present 且第二次不再改写）；
`scripts/regression.mjs` 新增 1 步（脚手架回显 `init-manifest updated: capability → present`），总计 **153 步 PASS**；
全量 `npx vitest run` 100 文件 / 580 例全绿；`tsc` / `vue-tsc` 通过。

仍未做（本计划主体）：接入本身（打开只有 `COMETFLOW.md` + `specs/` 的目录时补齐目标投影、
spec-lock、`.cometflow` 目录与配置），以及 §2.2 第 3 条「缺失 → deferred 而不是编造裁剪结论」
在**没有 manifest**时的那一半。

同一份 `reconcileInitManifest` 也被表格导入复用（导入即校正 12-kind）；导入的记账补全与
「版本」页签的建立基线入口记在 [spec-write-bookkeeping-plan.md](./spec-write-bookkeeping-plan.md)。
