# CometFlow 使用说明

> 适用版本：`@zqg/cometflow` 0.2.0（CLI 名 `cometflow`，Node >= 22）。
> 本文上半部分讲**项目整体逻辑**，下半部分讲**怎么用它**。

---

## 1. 定位与整体逻辑

### 1.1 一句话概括

CometFlow 是一个**规格驱动开发（SDD）的自主 Agent 开发平台**。

人类**必须**写的只有 `COMETFLOW.md`：使命 + 每个目标的「范围 / 成功标准 / 非目标」。它派生两件事——`范围:` 里的 capability 决定有哪些 `specs/<capability>/spec.md`，spec 里每个 anchor 决定一个任务。

`specs/` 的**内容**（anchor 与 acceptance）可以由人写，也可以由 Agent 起草：缺 spec 时 `plan generate` 会发一条 `spec-authoring` 任务，`spec scaffold --capability <name>` 只给骨架，`spec import` 从表格导入。定稿要过计划阶段的三道命令——`plan review / approve / freeze`，其中 `freeze` 才把 acceptance 与 spec hash 固化下来。
这三条机器产出路径都会写上 `status: draft`：**草案可以被阅读、被拆解，但不能被 `plan freeze` 绑定成契约**，
确认后运行 `cometflow spec approve <spec-file>` 定稿（缺省没有这个字段的老 spec 视为已定稿）。

剩下的事由两种执行者分担：

- **CometFlow 自己（确定性代码）**：`context / goal sync`、`spec validate / lock / index`、**`plan generate / validate / freeze`**、findings / metrics / 门禁判定。**拆解就在这一步，不调用 Agent**——它按「capability → spec anchor」一对一派生任务。
- **外部编码 Agent（opencode / claude-code 等）**：`change run` 的实现（Builder）、`change verify` 的独立复核（Verifier）、`cometflow run` 试跑、`eval` 的可选 LLM judge；再由调度器（daemon）串成无人值守推进、评估与进化。

它由两个既有项目融合而来：

| 来源 | 贡献的能力 |
|---|---|
| Nightshift | 持续调度、无人值守、空闲算力利用、门禁式自进化 |
| Comet | 可恢复工作流、Skill 生态、Bundle 分发、科学评估（Pass@k/Pass^k）、Hook Guard、Dashboard |

### 1.2 分层架构

```text
┌──────────────────────────────────────────────┐
│                cometflow CLI                  │  app/
│      + cometflow serve / dashboard（Web）      │
└──────────────────────────────────────────────┘
                     │
┌──────────────────────────────────────────────┐
│                Domain Layer                   │  domains/
│ spec-kernel / goal / task-plan / workflow     │
│ scheduler / evolution / eval / skill / bundle │
│ dashboard / server / guard                    │
└──────────────────────────────────────────────┘
                     │
┌──────────────────────────────────────────────┐
│               Platform Layer                  │  platform/
│ agents / fs / process / paths / io            │
└──────────────────────────────────────────────┘
                     │
┌──────────────────────────────────────────────┐
│          External Agent Runtimes              │
│      opencode / claude-code / mock            │
└──────────────────────────────────────────────┘
```

- **app/**：仅做参数解析与输出，不含业务逻辑（如 `app/commands/*.ts`、`app/cli/index.ts`）。
- **domains/**：业务领域，纯函数 + 文件状态，不依赖 UI，也不直接依赖 CLI。
- **platform/**：与操作系统/外部进程交互的薄封装（spawn、读文件、路径、Agent 适配器）。
- **AgentRunner**（`platform/agents`）是唯一的外部 Agent 抽象：`buildCommand / run / check / subagentTool / configTemplate`。新增 Agent 只需实现该接口并注册。

### 1.3 核心闭环

整条主链路（Native 工作流）如下：

```text
人类写 COMETFLOW.md（使命 + 技术栈 + 任务目标 G1..Gn）
人类写 specs/（capability / models / flow / constraints ...）
        │
        ▼
cometflow context sync        # COMETFLOW.md → .cometflow/project-context.yaml
cometflow goal sync           # COMETFLOW.md → .cometflow/goals/G1.yaml
cometflow spec validate       # 校验 spec 结构与跨文件引用
cometflow spec lock / index   # 快照 hash、生成 spec-index 投影
        │
        ▼
cometflow plan generate G1    # 目标 + spec → 任务草稿
cometflow plan validate G1    # 覆盖度 / anchor / acceptance / 依赖环 校验
cometflow plan review G1      # draft → validated
cometflow plan approve G1     # → approved
cometflow plan freeze G1      # → frozen，锁定 acceptance_ids + spec_hash
        │
        ▼
cometflow change new auth-login --goal G1 --task T1   # 取一个 frozen 任务
cometflow change transition auth-login confirm-acceptance  # shape → build
cometflow change run auth-login --agent opencode           # Builder 实现，成功 → verify
cometflow change verify auth-login                         # Verifier 独立验收
cometflow change archive auth-login                        # 归档并应用新 spec
        │
        ▼
cometflow eval / evolve / daemon   # 评估、进化、无人值守持续推进
```

### 1.4 七条设计原则

1. **全时优先，保留闲时能力**：调度模式 `always / idle / schedule / manual`。
2. **人类负责规范与批准，Agent 负责执行**。
3. **Spec 是契约，不是文档**：spec 必须能派生 acceptance，且与任务、代码、验证可追踪。
4. **状态可恢复、可审计、单一权威**：Scheduler 管队列，Workflow 管单任务验收状态。
5. **生成与评价分离**：Builder 与 Verifier 分离，不信任 Agent 自报完成。
6. **进化必须过门禁**：evolve 必须经过真实门禁（typecheck/tests，可选叠加 eval）。
7. **跨平台可分发**：Node + TypeScript 核心，AgentRunner 可插拔，Skill/Bundle 可分发。

### 1.5 单一事实源与文件所有权

**同一个事实只允许有一个 owner，其余文件只引用、不重述。**

| 文件 / 目录 | 内容 | 谁写 |
|---|---|---|
| `COMETFLOW.md` | 使命、技术栈、运行环境、任务目标（人类唯一入口） | 人类 |
| `specs/**` | 项目级 spec（12 类 kind） | 人类定稿；内容可由人类或 Agent 起草（`spec scaffold` 骨架 / `spec-authoring` 任务 / `spec import`）。三条机器产出路径写出的文件带 `status: draft`，**草案不能参与 `plan freeze`**，要先 `cometflow spec approve <spec-file>`（缺省无该字段视为已定稿，存量项目不受影响） |
| `.cometflow/config.yaml` | 项目配置 | 人类 / CLI / Web |
| `.cometflow/project-context.yaml` | 技术栈/运行环境投影 | `context sync`（机器生成） |
| `.cometflow/goals/*.yaml` | 目标投影 | `goal sync`（机器生成） |
| `.cometflow/plans/*.task-plan.yaml` | 任务计划与冻结的关联 | `plan generate/freeze` |
| `.cometflow/spec-lock.json` | spec hash 基线 | `spec lock` |
| `.cometflow/init-manifest.yaml` | 每个 spec kind 的 present/deferred/absent | `init` / `spec scaffold` |
| `.cometflow/spec-index/*.yaml` | models/apis/flows/errors/config 投影 | `spec index` |
| `.cometflow/runtime/queue.json` | 调度队列 | `daemon` |
| `.cometflow/runtime/daemon-state.json` | 调度器最近一次决策的**投影**（只读展示在调度面板） | `daemon` |
| `.cometflow/runtime/safety.bundle` | git 快照（可选） | `daemon --safety-bundle` |
| `.cometflow/eval-report.json` | 评估报告 | `eval` |
| `.cometflow/skills/<name>/` | 已安装 Skill | `skill add/import` |
| `changes/<name>/brief.md` | 任务简述 | `change new` |
| `changes/<name>/comet-state.yaml` | Native change 状态 | Workflow Runtime |
| `changes/<name>/specs/**` | 待归档的 spec 变更 | Agent / 人类 |
| `changes/<name>/verification.yaml` | 独立验收结论 | Verifier（独立 Agent 或人工） |
| `changes/<name>/classic-state.yaml` | Classic change 状态 | Classic Runtime |
| `evolve/<name>.yaml` | 进化提案与决策字段 | `evolve` |
| `evolve/<name>/review.md` | 评审材料与决策记录 | `evolve` |
| `reports/*.md` | 报告产出 | Agent / 人类 |

> 记忆点：**人类只改 `COMETFLOW.md` 和 `specs/`。** `.cometflow/` 下的投影与状态都是机器生成物，不手工编辑。

### 1.6 五条状态机

**任务计划（`.cometflow/plans/<goal>.task-plan.yaml`）**

```text
draft ──► validated ──► approved ──► frozen
  ▲                        │
  └── regenerate ──────────┘（未映射的旧任务 → cancelled）
```

**Native Change（`changes/<name>/comet-state.yaml`）**

```text
shape ──confirm-acceptance──► build ──submit-candidate──► verify ──verify-pass──► archive
                                 ▲                            │                        │
                                 └──────── verify-fail ────────┘        archive-complete │
                                                                                  ▼
                                                              status=done, archived=true
```

**Classic Change（`changes/<name>/classic-state.yaml`）**

```text
full:            open → design → build → verify → archive
hotfix / tweak:  open →          build → verify → archive
```

**进化提案（`evolve/<name>.yaml`）**

```text
draft ──verify（门禁通过）──► verified ──submit──► ready-for-review ──approve──► approved（终态）
              │                                                │
              └──（门禁失败）──► rejected ◄────── reject ──────┘   （终态）
```

**调度队列（`.cometflow/runtime/queue.json`）**：`queued → running → done | failed`

---

## 2. 安装与环境

### 2.1 环境要求

- Node.js >= 22（`package.json` 的 `engines` 强制）
- pnpm（仓库开发）或 npm（使用已发布包）
- 可选：`opencode` 或 `claude-code` CLI，用于真实 Agent 执行；不装也可以用 `--agent mock` 跑通流程

### 2.2 在仓库内直接开发/使用

```bash
pnpm install
pnpm dev -- --help          # 等价于 tsx app/cli/index.ts，开发态直接跑
pnpm typecheck              # tsc --noEmit
pnpm test                   # vitest run（当前 36 文件 / 129 用例）
pnpm build                  # 产出 dist/
pnpm package-e2e            # 发布前的端到端检查
```

构建后可用 `node dist/app/cli/index.js <cmd>`，或 `npm link` 后直接用 `cometflow <cmd>`。

> Windows/pnpm 提示：若 pnpm 因 `ERR_PNPM_IGNORED_BUILDS` 拦截 esbuild 构建脚本，可先 `pnpm approve-builds`，或绕过 bin 直接用
> `node ./node_modules/tsx/dist/cli.mjs app/cli/index.ts <cmd>`。

### 2.3 内网 npm 安装

```bash
npm config set registry http://npm.internal.local
npm install -g @zqg/cometflow@0.2.0
cometflow --version
```

### 2.4 离线安装

仓库 `offline-npm/` 内已备好三个 tarball：

```text
offline-npm/zqg-cometflow-0.2.0.tgz
offline-npm/commander-14.0.3.tgz
offline-npm/yaml-2.9.0.tgz
```

在目标机器上：

```bash
mkdir cometflow-install && cd cometflow-install
npm init -y
npm install --offline \
  /path/to/offline-npm/zqg-cometflow-0.2.0.tgz \
  /path/to/offline-npm/commander-14.0.3.tgz \
  /path/to/offline-npm/yaml-2.9.0.tgz
./node_modules/.bin/cometflow --version
```

---

## 3. 快速开始（最小闭环）

```bash
# 1. 初始化
cometflow init my-project --interactive   # 交互式：按项目类型裁剪 spec kind
cd my-project

# 2. 填写 COMETFLOW.md（使命 / 技术栈 / 运行环境 / 任务目标 G1..）
#    填写 specs/（至少为每个 capability 建 specs/<cap>/spec.md，含 ## Acceptance）

# 3. 投影与校验
cometflow context sync .
cometflow goal sync .
cometflow spec validate .
cometflow spec index .

# 4. 拆解到冻结
cometflow plan generate G1 .
cometflow plan validate G1 .
cometflow plan review G1 .
cometflow plan approve G1 .
cometflow plan freeze G1 .

# 5. 执行一个任务（Native 工作流）
cometflow change new auth-login --goal G1 --task T1 --path .
cometflow change transition auth-login confirm-acceptance .
cometflow change run auth-login . --agent opencode
cometflow change verify auth-login .
cometflow change archive auth-login .
```

只想先验证流程而不接真实 Agent：

```bash
cometflow change run auth-login . --agent mock
```

---

## 4. 项目初始化（`init`）

```bash
cometflow init [path]                # 默认当前目录
cometflow init [path] --interactive  # 回答 7 个问题并按项目类型生成 spec kind
```

非交互 `init` 会生成：

```text
my-project/
├─ COMETFLOW.md              # 模板：使命 / 技术栈 / 运行环境 / 任务目标
├─ specs/                    # 空目录
├─ .cometflow/
│  ├─ config.yaml            # schema: cometflow.project.v1
│  ├─ init-manifest.yaml     # 12-kind 的 present/deferred/absent
│  ├─ goals/
│  └─ plans/
└─ .gitignore                # 追加 .cometflow/
```

`COMETFLOW.md` 已存在时 `init` 直接报错，不会覆盖。

> 注意：不带 `--interactive` 时 `COMETFLOW.md` 还是模板（技术栈是 `[无/框架]` 这类占位符），
> 因此第一层推断只能得到 `deferred`，`init` 不会生成任何 kind 文件。
> 填好 `COMETFLOW.md` 后再跑 `cometflow spec scaffold .`，才会按真实技术栈生成对应文件。

### 4.1 12 个 spec kind 与裁剪规则

`init` 不会把 12 个 kind 全写出来，而是按项目类型裁剪：

**第一层（零交互，来自 `## 技术栈` 表）**

| 条件 | 生成的 kind |
|---|---|
| `前端 ≠ 无` | `pages` |
| `数据库 ≠ 无` | `models` |
| 技术栈已填写（任意一维非占位） | `constraints` |

> `constraints` 是非功能约束（安全/性能/部署/离线依赖），对纯前端、CLI 同样适用，因此不依赖「有没有后端」。

**第二层（`--interactive` 或 `spec scaffold --interactive` 的 7 个问题）**

| # | 问题 | 对应 kind |
|---|---|---|
| Q1 | 有对外网络接口，或需调用外部 HTTP/网络接口？ | `protocol` |
| Q2 | 有运行时配置键（端口/密钥/连接串）？ | `config` |
| Q3 | 有跨接口/跨模块的业务场景？ | `flow`（建 `specs/flows/`） |
| Q4 | 有常驻后台进程或定时循环？ | `process`（`specs/processes.md`） |
| Q5 | 有领域规则/业务不变量（策略、匹配判定、外部 DSL 语义）？ | `rules` |
| Q6 | 鉴权方式？（无需 / 机机 / 角色矩阵） | `permissions` |
| Q7 | 是否需要独立的错误码目录（跨接口错误码较多时选是）？ | `errors`（否则并入 `protocol` 的「错误码」表） |

> Q7 选「否」时错误码写在 `specs/protocol.md` 的 `## 错误码` 表里，`spec validate` 会把它当作与 `specs/errors.md` 同等的错误码来源解析，不会报缺失。

**完整 kind 表**

| kind | 单一职责 | canonical 位置 |
|---|---|---|
| `project` | 使命、技术栈、运行环境、模块归属、当前目标 | `COMETFLOW.md`（唯一） |
| `models` | 唯一数据字典：实体、字段、枚举、状态机 | `specs/models.md` |
| `protocol` | 传输契约：传输方式/gzip/请求头/响应包络/状态码总表 | `specs/protocol.md` |
| `errors` | 全局错误码目录 | `specs/errors.md` |
| `config` | 运行时配置契约（键/类型/默认值/必填/敏感） | `specs/config.md` |
| `capability` | 接口契约：路径/方法/认证/请求响应/错误码 | `specs/<capability>/spec.md` |
| `flow` | 一次性场景：前置/步骤/分叉/轮询/后置 | `specs/flows/<name>.md` |
| `process` | 常驻/后台进程：触发/输入/处理/输出/异常 | `specs/processes.md` |
| `rules` | 领域不变量与外部 DSL 语义 | `specs/rules.md` |
| `constraints` | 非功能约束：安全/性能/数据/高可用/部署/离线 | `specs/constraints.md` |
| `permissions` | 认证鉴权：角色×API 矩阵 / 机机认证 | `specs/permissions.md` |
| `pages` | 前端页面/交互规格 | `specs/pages.md` |

> `capability` 不由 `init` 生成，也不会由工具凭空撰写内容：它由 `plan generate` 的 spec-authoring 任务起草，或由 `spec scaffold --capability <name>` 建骨架后填写。对照已定标准（工标/接口规范）开发时，直接把标准里的接口与工作流誊写进这些 spec 作为唯一真相源，再 `spec lock` 冻结、`plan generate` 派生实现任务。
>
> 起草类任务（`kind: spec-authoring`）没有 acceptance，因此它**不适用**「验收必须先冻结」那条：
> `change transition <name> confirm-acceptance` 对它直接放行。它真正的验收条件是产物本身——
> `change verify` / `change archive` 会要求 `specs/<capability>/spec.md` 已存在且 `spec validate` 无 error
> （产物应带 `status: draft`，由人确认后 `spec approve` 定稿）。提示词里会带上该 goal 的范围、
> 成功标准与非目标，agent 不再是「凭一行标题写契约」。
> 「本项目不需要」也会留痕：`init-manifest.yaml` 记录 pending 状态，让 `spec validate` 能区分「有意缺席」与「遗漏」。

### 4.2 增量补 spec kind

```bash
cometflow spec scaffold .                          # 按技术栈推断，补缺失 kind（不覆盖已有文件）
cometflow spec scaffold . --interactive            # 逐项问答
cometflow spec scaffold --list .                   # 只列出各 kind 状态
cometflow spec scaffold . --capability order       # 建 specs/order/spec.md 骨架（可重复）
cometflow spec approve specs/order/spec.md          # 草案 → 定稿（之后才能 plan freeze）
cometflow spec scaffold . --capability order --capability payment
```

`scaffold` 对已存在的目标文件一律跳过，幂等可重跑；`--capability` 只建骨架，不写任何业务语义。

### 4.3 批量导入既有接口清单

对照已定标准（工标 / 外部接口规范）开发时，接口与工作流是给定的，不应由 agent 发明。把清单整理成表格后一次导入：

```bash
cometflow spec import <清单文件> [path] [--force] [--module <代码模块>]
```

支持 **CSV / TSV / markdown 表格 / .docx**——把 Excel、企业标准表格里的内容复制出来即可，Word 文档直接传文件。列名中英文均可识别：

| 字段 | 可识别的列名 | 必填 |
|---|---|---|
| 能力（capability） | 能力 / 模块 / 功能 / 领域 / capability / module / domain | 否（缺省归入 `api`） |
| 方法 | 方法 / 请求方法 / method | 是 |
| 路径 | 路径 / 接口 / 接口路径 / 接口地址 / url / path / endpoint | 是 |
| 认证 | 认证 / 鉴权 / auth | 否 |
| 请求 / 响应 | 请求 / 入参 / 请求体 / 响应 / 出参 / 响应体 / request / response | 否 |
| 错误码 | 错误码 / 异常 / errors（多个用逗号分隔） | 否 |
| 代码模块 | 代码模块 / 模块路径 / code_module（或 `--module`） | 否，但建议填 |
| 说明 | 说明 / 描述 / 备注 / notes | 否 |

样例：

```csv
模块,方法,路径,认证,请求,响应,错误码,代码模块
order,POST,/api/orders,机机,items[],orderId,DUP_ORDER,internal/order
order,GET,/api/orders/{id},机机,,orderId;status,NOT_FOUND,internal/order
```

导入行为：

- 按「模块」列分组，每组生成一个 `specs/<模块>/spec.md`，每个接口一个 `## METHOD /path` anchor，并自动补 `## Acceptance`。
- 生成的文件带 `capability:` / `module:` front-matter，`module` 会成为拆解时任务的代码边界（不填会得到 `missing-module-declaration` 警告）。
- 默认**不覆盖**已存在的 spec（加 `--force` 覆盖），幂等可重跑。
- 导入后自动跑 `spec validate`：字段/错误码/API 引用对不上会直接报出来。
- 生成的文件带 `status: draft`：导入物是机器誊写的，对照原始标准确认后
  `cometflow spec approve specs/<模块>/spec.md` 才算定稿（草案不能参与 `plan freeze`）。

#### Word（.docx）

`.docx` 走内置的 Word 解析，无需 Office 或额外依赖（ZIP 解包用 Node 内置 zlib，正文直接走 WordprocessingML），识别两种常见写法：

1. **接口表格**：文档里的表格若含 `方法` + `路径` 列，按上面的列名规则整表导入。
2. **标签式章节**：`请求方式：POST` / `请求地址：/pay` 这类标签行（标签与值可同行也可分行，`POST /pay` 简写也认）；其后的「请求参数 / 响应参数」表格会取第一列字段名，折叠进 `- 请求：` / `- 响应：`。

章节标题用于推断 capability：`3.2 订单模块` → `specs/订单模块/spec.md`（自动去掉章节号，中文章节名直接作为目录名）。无法识别的表格和缺少方法/路径的接口会以 issue 形式打印出来，不会静默丢弃。

#### 其他来源（PDF、扫描件、图片）

PDF 与扫描件需要 OCR，且表格结构容易串行，本项目暂不内置。正确姿势是先用对应工具抽成表格或文本，再走同一条 `spec import` 通道。不要让 agent 直接从 PDF 生成 spec 而跳过人工核对——标准一旦被抄错，后面所有实现都会错，所以流程固定为「抽取 → 导入为草稿 → 人工对照原文审核 → `spec lock` 冻结」。

---

## 5. Spec 内核

### 5.1 命令

```bash
cometflow spec validate [path]              # 校验结构、acceptance、跨文件引用
cometflow spec anchors [path]               # 列出所有可绑定 anchor
cometflow spec lock [path]                  # 登记版本 + 刷新 .cometflow/spec-lock.json
cometflow spec diff [path]                  # 对比当前 spec 与 lock（added/modified/removed）
cometflow spec diff [path] --impact         # 锚点级影响分析（可加 --change <name> 预览提案）
cometflow spec drift [path] [--json]        # 找出已冻结但 spec 内容已漂移的任务
cometflow spec checks [path] [--json]       # 列出验收项与其可执行 check
cometflow spec versions [path] [--spec <ref>]   # spec 版本历史
cometflow spec show <path>@<n>|<hash> [path]    # 打印历史版本原文
cometflow spec restore <path>@<n>|<hash> [path] # 从版本仓恢复 canonical spec
cometflow spec verify [path] [--json]       # 一致性门禁（失败退出码 1）
cometflow spec scaffold [path] [--list] [--interactive] [--capability <name>]
cometflow spec import <file> [path] [--force] [--module <代码模块>]   # file: .csv/.tsv/.md/.docx
cometflow spec index [path]                 # 生成 .cometflow/spec-index/*.yaml 投影
```

### 5.2 Spec Anchor 与 Acceptance

**anchor** = capability spec 中的**契约标题**（二级标题，如 `## POST /api/auth/email-login`），任务通过它绑定 spec。
若整份文件没有二级标题，则退化为三级标题：

```markdown
---
capability: auth
---

# auth capability

## POST /api/auth/email-login

登录接口。

## Acceptance

- A1：未注册邮箱可以获取验证码
- A2：验证码错误返回 401 INVALID_CODE
```

- `## POST /api/auth/email-login` 是一个 anchor（建议用 `METHOD /path` 形式，便于交叉引用校验）；`### 请求`、`### 响应` 属于它的正文，不是独立 anchor。
- `## Acceptance`（或 `## 验收`）段落内的 `- A1：...` / `- A1: ...` 会被提取为验收项。
- `plan freeze` 时把 anchor 的 acceptance 提取为 `A1..An`，并连同 `spec_version`、`spec_hash`、`anchor_hash` 一起锁定。

**哪些标题不是 anchor**（它们不参与任务绑定，也不进 `anchor_coverage` 覆盖率）：

- `## Acceptance` / `## 验收`：验收项容器；
- **非 capability 文档的结构标题**：flow 的 `## 前置条件 / ## 步骤 / ## 后置条件` 三段式骨架
  （`spec validate` 强制要求这三段；flow 的可绑定单位是**步骤** `### 步骤N …`）、
  models 的实体清单、rules 的规则表、constraints 的各条约束……
- 因此「验收覆盖」页签里的**可绑定锚点**表只列 capability 的契约标题（与 `cometflow spec anchors`、
  指标 `anchor_coverage_rate` 同一口径）。曾经把 flow 的三段骨架当锚点，那张表里会混进
  `前置条件 / 步骤 / 后置条件` 这类噪音——已修。

### 5.3 跨文件引用规则

引用方向单向：**行为层 → 数据/契约层**，永不反向。

| 引用方 | 可引用 | 写法 |
|---|---|---|
| `capability` | `models` / `errors` / `protocol` / `rules` | `模型：User`、`错误码：INVALID_CODE`、`协议头：User-Agent`、`状态码：401`、`规则：会话有效期` |
| `flow` | `capability` / `models` / `config` / `rules` | 步骤里 `调用 POST /api/auth/email-login`、`配置：PORT`、`规则：<name>` |
| `process` | `capability` / `models` / `config` / `rules` | 同上 |
| `rules` | `models` | `实体：KeywordRule` |
| `permissions` | `capability` | 矩阵首列写 `POST /api/xxx` |
| `constraints` | 不引用 | 独立 NFR |

`spec validate` 会据此报出 `unresolved-model-reference` / `unresolved-error-reference` /
`unresolved-config-reference` / `unresolved-api-reference` / `unresolved-rule-reference` 等错误或警告。

**反向也要查**（ADR 0030）：`models` 的每个实体、`rules` 的每条规则都必须被**行为层**
（capability / flow / process）引用——声明了却没人用就是悬空的事实来源，`spec validate` 报
`unreferenced-model` / `unreferenced-rule`（**warning**，不挡门禁：为下个迭代预留实体是合法需求）。
修法二选一：在引用它的行为层 spec 里补一行 `- 模型：<Name>` / `- 规则：<name>`，或删掉这条声明。
（`rules → models` 的内部引用只在"那条规则本身被行为层引用"时才传递一次；`errors` / `config` /
`protocol` / `constraints` 不查反向——"暂未使用"对它们是合法预留。）

错误码有两个合法来源：`specs/errors.md`，或小项目 `specs/protocol.md` 的 `## 错误码` 表（两者都会被解析，`unresolved-error-reference` 表示两边都查不到）。

### 5.4 常见 validate 结果

| code | 级别 | 含义 |
|---|---|---|
| `missing-project-context` | error | 缺 `COMETFLOW.md`，先 `context sync` |
| `missing-kind-file` | error | manifest 标记 present 但文件缺失 |
| `deferred-kind-file` | warning | manifest 标记 deferred，可 `spec scaffold --interactive` 补 |
| `no-anchors` / `no-acceptance` | error | capability spec 缺 anchor 或缺验收项 |
| `duplicate-anchor` | error | 同文件 anchor 标题重复（任务绑定会指向错误段落） |
| `missing-module-declaration` | warning | capability spec 未声明 `module` 代码模块边界 |
| `module-scope-mismatch` | error（plan validate） | 任务 `test_scope` 与 spec 声明模块不一致 |
| `missing-coverage` | error（plan validate） | spec 的某个 anchor 没有对应任务 |
| `dependency-cycle` | error（plan validate） | 任务依赖成环 |
| `stack-command-mismatch` | error（plan validate） | DoD 里出现了与技术栈不符的命令（如 Go 项目写 `npm test`） |

---

### 5.5 Spec 版本管理（spec 即产物）

`specs/` 是唯一事实源，但「唯一事实源」要成立，被引用的那一版内容必须真的能取回来。因此 CometFlow 把 spec 正文按内容哈希存档：

```text
.cometflow/spec-versions/<sha256>.md   # 正文，同内容只存一份
.cometflow/spec-history.json           # 版本链：spec_version / hash / parent / change / note
```

| 概念 | 含义 |
|---|---|
| `spec_version` | 每个 spec 文件独立递增，从 1 开始；内容不变不产生新版本 |
| `hash` | 行尾归一化后的 sha256，同时是版本仓里的地址 |
| `change` | 该版本由哪个 change 产出，用于溯源 |
| `spec_hash` | 冻结任务记录的文件级哈希 |
| `anchor_hash` | 冻结任务记录的 anchor 正文哈希（不含标题与 Acceptance 段） |

记账时机：`spec lock`（人工建立基线）、`plan freeze`（冻结任务）、`change archive`（归档写回 canonical spec）。归档会自动刷新 `spec-lock.json`，不会再出现「归档完 lock 立刻过期」。

**anchor 规则**：可绑定的 anchor 是二级标题（如 `## POST /api/auth/email-login`）；`### 请求`、`### 响应` 是段落而非 anchor；`## Acceptance` 是验收容器。同一文件里 anchor 标题重复会直接报 `duplicate-anchor`。

**模块边界由 spec 声明**：capability spec 可用 front-matter 指定实现放在哪个代码模块，拆解、校验与 Builder 提示词都会继承它：

```markdown
---
capability: auth
module: internal/auth
---
```

`plan generate` 把 `module` 写进任务的 `module` 与 `test_scope`；`plan validate` 在 `test_scope` 与声明不一致时报 `module-scope-mismatch`；`change run` 会要求在 `internal/auth` 内实现。未声明时 `spec validate` 给 `missing-module-declaration` 警告。

**影响分级**（`spec diff --impact`）：

| 变化 | severity |
|---|---|
| 新增 anchor、同文件其他位置变化 | low |
| anchor 改名、anchor 正文变化、新增验收项 | medium |
| 删除 anchor 或 spec 文件、删除或改写验收项 | high |

`--impact` 出现 high 时命令返回退出码 1，适合放进 CI 或 pre-commit。

**归档冲突（CAS）**：`change new` 时会拍一份 canonical spec 全量基线；`change archive` 前重新比对。若本 change 会写入或绑定的 spec 被外部改过，归档会被拒绝并打印冲突文件，必须先评估再决定：

```bash
cometflow spec diff . --impact
cometflow change rebase <name> .    # 确认无影响：重新冻结到新版本（退回 build，需重新验证）
# 有影响：按 ADR 0004 创建 reconciliation change，不要 rebase
```

**一致性门禁**：`cometflow spec verify` 一次性检查 lock 新鲜度、版本仓完整性、anchor 唯一性与漂移、验收项漂移、活跃 change 的基线冲突。任何 error 都会让退出码为 1。

**代码丢失后的重建**：

```bash
cometflow spec verify .                          # 确认版本仓完整、任务绑定可解析
cometflow spec restore specs/auth/spec.md@3 .    # 需要时先恢复 spec
cometflow goal sync .
cometflow plan regenerate G1 . --preserve-approved
cometflow plan validate G1 . && cometflow plan freeze G1 .
cometflow change new auth-login-v4 --goal G1 --task T1 --path .
cometflow change run auth-login-v4 . --agent <agent>
cometflow change verify auth-login-v4 .
cometflow change archive auth-login-v4 .
```

Builder 的提示词里会直接带上冻结版本的 anchor 原文与全部 acceptance，因此重建的目标与当初冻结时一致，而不是「照当前工作区猜」。

---

### 5.6 可执行验收（acceptance check）

spec 的验收项可以直接携带可执行命令，让「代码能不能用」有客观答案：

```markdown
## Acceptance

- A1：验证码正确时可以登录
  - check: go test ./internal/auth -run TestEmailLogin
- A2：验证码错误返回 401
  - check: go test ./internal/auth -run TestWrongCode
- A3：登录日志不落敏感字段
  # 暂时无法自动化：留空，由独立 Verifier 或人工判定
```

- 缩进 2 空格以上的 `- check: <command>` 属于上一个验收项。
- 命令在项目根目录执行，退出码 0 视为通过，支持引号（`node -e "..."`）。
- `spec validate` 会对没有 check 的验收项给出 `acceptance-without-check` 警告；`spec checks` 列出全部未覆盖项。

`change verify` 的判定优先级：

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | `check` 命令 | 机器事实，任何 agent 与文档都不能推翻 |
| 2 | 独立 Verifier | 覆盖 check 未覆盖的验收项 |
| 3 | `changes/<name>/verification.yaml` | 兼容既有流程 |
| 4 | 项目 eval | 兜底 |
| 5 | 都没有 | `blocked`，判定为不通过 |

### 5.7 模块边界强制与实现范围

`spec front-matter` 的 `module` 会一路传导到写入守卫与归档闸门：

| 环节 | 行为 |
|---|---|
| `plan generate` | 任务继承 `module` 与 `test_scope` |
| `plan validate` | `test_scope` 与声明模块不一致 → `module-scope-mismatch` |
| `change run` | 提示词要求只在 `module` 内实现 |
| `hook check` | build 阶段写模块外文件 → `outside-module-scope` 拒绝 |
| `change scope` | 列出本次改动，标出越界文件（越界时退出码 1） |
| `change verify` | 越界改动导致验证不通过 |
| `change archive` | 越界改动直接拒绝归档 |

仓库级共享文件在 **`COMETFLOW.md` 的 `## 模块归属`** 里声明（随仓库分发，换机器依然生效）：

```markdown
## 模块归属

每个 capability 的实现限定在各自 spec front-matter 声明的 module 内。
以下路径跨 capability 共享，允许在模块之外改动：

| 共享路径 | 说明 |
|----------|------|
| bin | CLI 入口，跨 capability 共享 |
| tests | 夹具与验收执行器 |
| package.json | 依赖清单与脚本 |
```

本地临时例外（不想写进 COMETFLOW.md 时）用 `.cometflow/config.yaml` 的 `scope.allow` 覆盖；
注意该目录被 gitignore，不会随仓库分发。

快照会跳过超大文件（>1MB）与超出计数上限的目录；这些跳过会记录为 omission 并让快照标记为不完整。
默认只提示，需要严格把关时：

```yaml
scope:
  omission_policy: fail     # warn（默认）| fail
```

### 5.8 独立 Verifier 与审计流水

```yaml
# .cometflow/config.yaml
verification:
  mode: checks+agent     # checks | checks+agent | agent-required
  agent: claude-code     # 独立 Verifier 使用的 agent
```

| 模式 | 行为 |
|---|---|
| `checks` | 只跑确定性检查，离线可用（默认） |
| `checks+agent` | 检查 + 独立 Verifier 复核未覆盖项；agent 不可用时降级 |
| `agent-required` | 必须由独立 Verifier 给出完整结论，不可用即失败 |

Verifier 的 agent 解析顺序是 `--agent` → `verification.agent` → **项目默认 `agent`**；
调用前先做可用性检查（`<agent> --version`）。不可用时按 `verifier_policy` 处理：

| `verifier_policy` | 行为 |
|---|---|
| `skip` | 静默降级（旧行为） |
| `warn`（默认） | 验证继续，把「本轮没有独立验证」写进 `verification.md` 与 `change journal` |
| `fail` | 把「Verifier 不可用」升级为 violation，验证失败 |

该策略只在 `mode` 为 `checks+agent` / `agent-required` 时生效；默认的 `checks` 模式不要求 Verifier，也不产生提示。
`agent-required` 不受策略影响——没有 Verifier 就是失败。**注意**：`warn` 只改变「Verifier 缺失」的处理，
「验收项没有 check、也没有人判」永远算失败（ADR 0013）。

```yaml
verification:
  mode: checks+agent
  verifier_policy: warn      # skip | warn | fail
```

### 5.9 有界修复循环（停滞停机）

`verify-fail` 不会无限重跑。每轮失败都会算一个**失败结论指纹**（只含未通过的验收项与越界项，不含理由措辞），
连续得到同一指纹就累加 `repair_attempts`；达到上限后 change 变 `blocked` 停机等人：

```yaml
# .cometflow/config.yaml
verification:
  max_repair_attempts: 2     # 默认 3；无人值守建议调小
```

停机时：

- `change run` 直接拒绝，并指向 `changes/<name>/verification.md`；
- `change resume` 不再给下一步 transition，只给人工介入指引；
- 人看过失败原因（改 spec / 改验收 / 改实现方向）之后，用显式动作重置：

```bash
cometflow change unblock <name> . --note "spec 已澄清，重试"
```

「换了失败结论」不会被当作停滞：说明在收敛，计数会重置为 1。

### 5.10 git 来源绑定（漂移阻断）

`change new` 会记录当时的 `base_commit` 与 `base_branch`。`change run` / `verify` / `archive` 推进前校验来源，
只看**祖先关系**：

| 情况 | 判定 | 行为 |
|---|---|---|
| HEAD 就是基准，或基准仍是 HEAD 的祖先 | `ok` | 放行（正常提交、基于基准开分支都属此类） |
| HEAD 是基准的祖先 | `head-rewound` | 阻断（历史被回退） |
| 两者互不为祖先 | `diverged` | 阻断（分叉或切到无关历史） |
| 非 git 仓库 / 老 change 未记录基准 / 基准对象不存在 | `not-a-repo`、`unbound`、`unknown-base` | 只提示，不阻断 |

```bash
cometflow change status <name> .        # 多一行 git: <status>
cometflow change run <name> . --allow-drift        # 显式忽略漂移（会写入审核流水）
cometflow change verify <name> . --allow-drift
cometflow change archive <name> . --allow-drift
```

也可以用项目配置一次性放行（无人值守/沙箱场景）：

```yaml
# .cometflow/config.yaml
git:
  allow_drift: true
```

漂移的 change 会在 `doctor` 里报 `git-provenance-drift`。恢复路径是回到基准提交或从基准拉出分支重做；
放行只应作为例外，且每次放行都会记进 `change journal`。

### 5.11 多 change 并存：current-change 指针

同时存在多个活跃 change 时，hook 无法判断一次写入属于谁，所以需要显式归属：

```bash
cometflow change select <name> .          # 指定当前 change
cometflow change select <name> . --clear  # 清除（回到 fail-closed）
```

| 活跃 change 数 | 指针 | 行为 |
|---|---|---|
| 0 | — | 放行 |
| 1 | 不需要 | 直接用那个 change（与只有一个 change 时一致） |
| 多 | 有效 | 按指针那个 change 的 phase 与 module 判定 |
| 多 | 缺失 | 拒绝 `multiple-active-changes`，提示运行 `change select` |
| 多 | 指向已归档/不存在 | 拒绝 `stale-current-change`，提示重新指定 |

`change new` 会自动把新建的 change 设为当前，`change archive` 归档后自动摘除；
`change status` 会打印 `current-change:` 行便于确认归属。指针写在 `.cometflow/current-change.json`（机器状态，不入库）。

Verifier 使用独立会话、只读提示词，必须对每一条验收项给出 `passed | failed | blocked` 与理由；重复、未知或遗漏任何一条，整份结论作废。失败的 check 不能被 Verifier 判成通过。

```bash
cometflow change verify <name> . --mode checks+agent --agent claude-code
cometflow change scope <name> .          # 本次改动与越界情况
cometflow change journal <name> .        # 追加式审计流水
cometflow change gc [path] [--json]      # 查看 change 运行证据占用与可回收量
cometflow change gc [path] --apply       # 回收：仅 .cometflow/runtime/ 下可重新推导的内容
```

change 的生命周期事件（创建、基线快照、run、验证结论、rebase、spec 应用、归档、回滚）都会写入
`.cometflow/runtime/changes/<name>/journal.jsonl`。

journal 超过 1 MiB 会自动轮转为 `journal.1.jsonl` 并保留一代；`readChangeJournal` 默认返回最近
2000 条事件。落盘的证据（journal、命令输出、验证理由）会经过凭证脱敏，出现 `***redacted***` 属预期；
Builder/Verifier 提示词只裁剪高置信凭证，不会改动 spec 里的契约示例。

归档写入是事务化的：先 stage 提案与被覆盖文件备份，再逐个提交；任一步失败会回滚已写入的目标，
并把事务停在 `rolled-back`。未完成的事务会被 `cometflow doctor` 报为 `incomplete-spec-transaction`。

---

## 6. 任务计划（plan）

### 6.1 命令

```bash
cometflow plan generate   <goal> [path]
cometflow plan regenerate <goal> [path] [--preserve-approved]
cometflow plan validate   <goal> [path]
cometflow plan review     <goal> [path]     # draft → validated
cometflow plan approve    <goal> [path]     # → approved
cometflow plan freeze     <goal> [path]     # → frozen
cometflow plan trace      <goal> [path]
```

`plan generate` / `plan regenerate` 之后是否自动往下走，由 `.cometflow/config.yaml` 的
`plan_review` 决定：`auto` 在机器校验通过后自动 `review` + `approve`，`human` 停在 draft，
`high-risk`（规则未实现）与未知值按 `human` 兜底。命令会把结论打成一行 `plan review: …`。

### 6.2 生成规则

`plan generate` 读取 goal 的 `scope`（capability 列表）与 `specs/`：

- 若 `specs/<cap>/spec.md` **不存在** → 生成一个 `kind: spec-authoring` 任务（先起草 spec）。
- 若存在 → 该 spec 的**每个 anchor 生成一个 `kind: implementation` 任务**。

生成的任务字段示例：

```yaml
- id: T1
  title: 实现 auth - POST /api/auth/email-login
  kind: implementation
  capability: auth
  spec_ref: specs/auth/spec.md
  spec_anchor: "POST /api/auth/email-login"
  acceptance_ids: []        # freeze 后填 A1..An
  spec_version: null
  spec_hash: null
  depends_on: []
  test_scope: internal/auth
  definition_of_done: [所有 acceptance 通过, 相关测试通过]
  status: draft
```

### 6.3 校验项

`plan validate` 会检查：test_scope/DoD 是否齐备、DoD 命令是否与技术栈匹配、
spec 是否存在、anchor 是否存在、是否有 acceptance、依赖是否存在、是否有覆盖遗漏、依赖是否成环。

### 6.4 冻结与重新拆解

- `plan freeze` 写入 `acceptance_ids`、`spec_version`、`spec_hash`，任务状态变 `frozen`。
- 只有 `frozen` 任务能创建 change。
- spec 变化后重新拆解：

```bash
cometflow plan regenerate G1 . --preserve-approved
```

-  未受影响的 `approved/frozen` 任务（key 与 `spec_hash` 都未变）保留；
-  受影响的任务重新生成为 `draft`；
-  目标范围缩小导致的多余任务标记为 `cancelled`。

### 6.5 追踪

```bash
cometflow plan trace G1 .
```

输出 goal/status 与每个任务的 capability、spec、anchor、acceptance、status。

> 注：`.cometflow/config.yaml` 里的 `plan_review`（`auto | high-risk | human`）**已生效**于
> `plan generate` / `plan regenerate`：`auto` 在机器校验通过后自动 review + approve（校验有 error 则停在 draft）；
> `human` 停在 draft 等显式命令；未配置、值不认识、或配了 `high-risk`（高风险识别规则尚未实现）一律按 `human` 兜底。
> 无论哪种策略，`plan review` / `plan approve` / `plan freeze` 仍然可以手动敲。
> `default_workflow` 目前仍只作为配置记录保存。

---

## 7. 工作流 Change

### 7.1 Native 工作流

```bash
cometflow change new <name> --goal <goal> --task <task> [--path <path>]
cometflow change list [path] [--all] [--json]
cometflow change resume <name> [path] [--json]
cometflow change status <name> [path]
cometflow change transition <name> <event> [path]
cometflow change run <name> [path] [--agent opencode|claude-code|mock]
cometflow change verify <name> [path]
cometflow change archive <name> [path]
```

阶段与事件：

```text
shape ──confirm-acceptance──► build ──submit-candidate──► verify ──verify-pass──► archive
                                 ▲                            │
                                 └──────── verify-fail ────────┘
archive ──archive-complete──► done + archived
```

关键行为：

| 命令 | 前置条件 | 行为 |
|---|---|---|
| `change new` | 目标任务 `status=frozen` | 建 `changes/<name>/`，写 `brief.md` 与 `comet-state.yaml`（phase=shape） |
| `change resume` | — | 按当前 phase 给出下一步事件与建议命令（断点续作） |
| `change run` | `phase=build` | 用 Builder prompt 调外部 Agent；exit 0 → `verify` |
| `change verify` | `phase=verify` | 见 7.3；pass → `archive`，fail → 回到 `build` |
| `change archive` | `phase=archive` | 把 `changes/<name>/specs/**` 落地到 `specs/**`（支持 `<capability>/spec.md`、`flows/<name>.md` 与根级 kind 文件），标记 archived |

### 7.2 断点恢复

```bash
cometflow change list .
cometflow change resume auth-login .
```

`resume` 会输出类似 `Next action: verify-pass` 与可直接复制的
`cometflow change transition auth-login verify-pass`。

### 7.3 独立验证（Builder / Verifier 分离）

`change verify` 有两种模式，按是否存在 `changes/<name>/verification.yaml` 决定：

**A. 有独立验证文件（推荐，Builder 与 Verifier 分离）**

```yaml
# changes/auth-login/verification.yaml
schema: cometflow.verification.v1
change: auth-login
acceptance:
  - id: A1
    result: passed     # passed | failed | blocked
    reason: 合法请求返回 200，已由 POST /api/auth/email-login 的集成测试覆盖
```

校验规则：`change` 必须与 change 名一致；acceptance 的 id 集合必须与冻结的
`acceptance_ids` **完全一致**（不多不少）；所有项 `passed` 才判定通过。

**B. 无验证文件 → 回退到本地 eval**

直接执行 `.cometflow/eval.yaml` 的评估任务，用 `report.passed` 作为结论（eval 缺失或失败即判 fail）。

两种模式都会把结果写入 `changes/<name>/verification.md`。

### 7.4 Classic 工作流

> **弃用中（2026-09-16 决策）**：Classic 与 native change 并存属于历史包袱，产品方向是**只保留 native**。
> 界面已经移除 Classic 相关内容（资产面板不再有该页签）；CLI 与 `GET /api/projects/<id>/classic`
> 暂时保留以便存量项目过渡，后续版本会一并移除。新项目请直接用 native change。

用于更传统的阶段式流程：

```bash
cometflow classic new <name> --goal <goal> --task <task> [--profile full|hotfix|tweak] [--path <path>]
cometflow classic status <name> [path]
cometflow classic transition <name> <event> [path]
```

```text
full:            open → design → build → verify → archive
hotfix / tweak:  open →          build → verify → archive

事件：open-complete | design-complete | build-complete | verify-pass | verify-fail | archive-complete
```

> Native 与 Classic 共用 `changes/<name>/` 目录，但状态分别写在 `comet-state.yaml` 与 `classic-state.yaml`。

---

## 8. Agent、单次执行与调度器

### 8.1 Agent 适配器

```bash
cometflow agent list            # opencode / claude-code / mock + 可用性
cometflow agent check <agent>
```

| id | 实际命令 | 说明 |
|---|---|---|
| `opencode` | `opencode run <prompt> [--model m]` | Windows 下继承控制台，避免 pipe stdio 卡住 |
| `claude-code` | `claude -p <prompt> --dangerously-skip-permissions [--model m]` | |
| `mock` | 无外部进程 | 永远 exit 0，用于测试与流程验证 |

### 8.2 单次会话

```bash
cometflow run [path] [--agent opencode] [--model <model>] [--timeout <ms>]
```

它会构造一个"全时自主开发者"prompt（含完整 `COMETFLOW.md`，要求以 specs 为事实源、
只做有冻结计划或明确 acceptance 的工作），调用 Agent 并把 stdout/stderr 透传。
超时退出码 124。

### 8.3 调度守护进程

```bash
cometflow daemon start [path] \
  --mode always|idle|schedule|manual \
  [--budget <ms>] [--interval <ms>] \
  [--agent opencode|claude-code|mock] [--model <model>] \
  [--cpu-threshold <value>] \
  [--start HH:MM] [--end HH:MM] \
  [--safety-bundle] [--max-attempts <n>] [--task-timeout <ms>]

cometflow daemon budget [path] [--reset]   # 查看/清零跨重启累计的已用预算
cometflow daemon pause|resume|stop [path]  # 写控制文件（下一轮生效），不碰进程
cometflow daemon queue rebuild|reset [path] # 重建待办（保留运行时覆盖）/ 清掉覆盖强制重跑
cometflow daemon queue retry <goal:task> [path] # 只把这一条重新排队（细粒度恢复）
```

| 模式 | 行为 |
|---|---|
| `always` | 无条件推进，直到队列空或预算耗尽 |
| `idle` | 仅当 1 分钟 loadavg ≤ `--cpu-threshold`（默认 1.0）时才跑 |
| `schedule` | 仅在 `--start`/`--end` 时间窗内跑（必须同时给出，支持跨夜窗口） |
| `manual` | 不自动跑（用于只做一次安全快照/队列构建） |

要点：

- **daemon 走的是交付通道**（P4）：取到任务后自动建 change（名字由 `goal-task` 确定性派生，如 `G1-T1`）
  → `confirm-acceptance` → 跑 builder → **独立验收** → 归档；「做完了没有」由 acceptance 结论回答，
  不再由 agent 退出码回答。已归档 change 的任务不会重跑。
- **待办是推导出来的**（S3）：`plans` 里 `frozen/approved` 的任务 − 已有归档 change 的 `(goal, task)`，
  再叠加运行时覆盖（在跑的租约、尝试次数、上次结论）。优先级是
  **change 账本（交付）> 运行时覆盖 > 计划推导**；每行在界面上都标明来源。
- **依赖排序**（C2）：计划里的 `depends_on` 是调度准入的一部分——前序任务**已交付**（有归档 change）
  才轮到它。未满足时该条仍算待办，但带 `blocked_by` 标记，界面上显示「等待 T1 交付」，
  调度器会跳过它（`next` 也按"可调度"取）。依赖是链式的，环由 `plan validate` 先拦。
- **goal 级顺序**（ADR 0029，C6）：**先跑哪个 goal** 写在 `COMETFLOW.md` 的 `## 调度顺序` 段落里——
  **位置即顺序**，不用写数字：

  ```markdown
  ## 调度顺序

  - G3
  - G7
  ```

  列出的按清单走；**没列出的按 goal 编号升序兜底排在后面**（`G2` 在 `G10` 之前——旧实现按 plan
  文件名排序，`G10` 会插到 `G2` 前面）。所以**新加的 goal 不用标**：追加到文档末尾、不写进清单就
  自动末位，要插队就把它挪到第一行；**已完成的 goal 不占位**（交付由 change 账本判 `done`，它不再
  参与领取，留在清单里也无害）。顺序**不冻进计划**：调度器每次推导都重读这份文档，改顺序不需要重新
  `plan freeze`；`goal sync` 会回显当前生效顺序，`daemon queue rebuild` 打印同一份（外加每行 `#N`）。
  顺带说清优先级：顺序**只在能领的候选里决定先后**，`blocked_by` 与 module 排除（ADR 0028）优先，
  已经在跑的槽也不会被顺序变化打断（不抢占）。
- **并发**（ADR 0028，C3/C5）：`--concurrency N` / `scheduler.concurrency` 真并行，两条约束——
  ①**同一单元不并行**：并发单元默认是 capability spec（同一 `spec_ref` 永不并行，并行改同一块契约是必然冲突）；
  ②**归属不能有歧义**：装了写保护守卫时，并发单元换成 **module 归属**——守卫按 module 判写入归属，
  所以 module 相等（都写 `src/api`）、互相包含（`src` vs `src/api`）、或没声明 module 的**那几条任务串行**
  （谁都不落在里面、或同时落在多个里，守卫会回落到 current-change 指针与 fail closed）。
  **形态是"领取时跳过它、先跑别人的"，不是"整个项目不许并发"**：不同 module 的任务照常并行，
  冲突的候选等前一条交付/归档后再领。日志会点名"谁在等谁"（`daemon N skip ... module=...`）；
  没槽在跑而候选全被挡时，停止原因是 `waiting-on-active-change`（去看那个 change：归档 / `change unblock` /
  让 module 两两不相交），而不是伪装成"队列空了"。没装守卫的项目不受 ② 约束（还是按 `spec_ref` 去重）。
  `stop` / `pause` / `needs-human` 只停止**领取**新任务，已经跑起来的槽会跑完（不抢占）。
- 同一个任务上已有别的 change（非 daemon 命名）时，daemon 让开并把它标成「在飞」，不做重复劳动；
  它自己上次没跑完的 change 则按 phase 续作。
- 队列文件 `.cometflow/runtime/queue.json` 不再决定「该不该跑」，它是**运行时覆盖 + 上次快照**；
- `daemon queue rebuild` 重新推导并保留覆盖（含老路径留下的 `done`，迁移期不重跑）；
  `daemon queue reset` 清掉覆盖，显式要求全部重跑（已归档 change 的任务仍算已交付）。
- `--budget 0` 表示不限时；`--interval` 默认 60000ms。
- 启动时先做 git 安全快照并打印回滚指引；`--safety-bundle` 额外生成
  `.cometflow/runtime/safety.bundle`（`git bundle create ... --all`）。
- 每个任务按交付结论结算：`delivered` → `done`，可重试的失败 → 回到 `queued`（受尝试上限约束），
  需要人工介入的（spec 冲突 / blocked）→ `failed` 并**停机**，状态投影里写明人工出口。

#### 无人值守前置检查（验收必须可自动判定）

默认配置（`mode: checks`、`verifier_policy: warn`）下，只有文字、没有可执行 `check:` 的验收项判不出来，
一律 `blocked`——这类任务跑到最后必然是"验收不过"，白烧预算。所以 daemon 在执行**之前**先判一次：

```
每条验收都有 check:  →  放行
否则：项目配了 eval（.cometflow/eval.yaml）或独立 Verifier（checks+agent / agent-required 且 agent 可用）
        →  放行（有兜底）
        →  否则：不执行，任务直接失败，daemon 停机交人工
```

开关在 `.cometflow/config.yaml`：

```yaml
verification:
  unattended_preflight: fail   # 默认；warn=照常执行只记一笔；off=不检查（人工在场时用）
```

`spec-authoring` 任务不参与这条检查（它由产物护栏负责：产物存在 + `spec validate` 无 error）。

#### 细粒度恢复

daemon 因"需人工介入"停机后，那条任务在队列里是 `failed`：

```bash
cometflow change unblock auth-login .     # 或 rebase / reconciliation，按停机提示做
cometflow daemon queue retry G1:T1 .      # 只把这一条放回待办（等价界面上的「重新排队」按钮）
cometflow daemon start . --mode always    # 继续无人值守
```

`retry` 只动一条：其余任务的 `running`/失败结论与尝试次数原样保留（这是它与 `reset` 的区别——
不为修一条任务而重置整个队列）。已交付（有归档 change）的任务不会被重排。

#### 暂停 / 停止（ADR 0026）

进程由 CLI 持有（`daemon start` 是唯一 spawn 点），**控制走控制文件**
`.cometflow/runtime/daemon.control.json`：`daemon pause|resume|stop` 与界面按钮都只写这个文件，
daemon 每轮读它——`stop` 退出并写 `stopped_reason=stopped-by-control`（指令随即回落 `idle`），
`pause` 只跳过不退出。控制是**状态**而不是信号，所以换机器、重启后依然有效；界面因此可以「可控」，
但不必拥有进程（界面没有「启动 daemon」按钮）。

#### 内嵌调度器与常驻（ADR 0027）

页面上的「**启动调度器**」= 在 serve 进程里以 **job** 的形式跑调度器（日志在任务中心），
并把这个项目记为**常驻**（`scheduler.autostart: true`）；serve 重启会按它自动恢复。
「停止」会同时清掉常驻标记，所以"停止 = 不再常驻"，想临时让路用「暂停」。

```bash
# 等价的服务端动作（页面点按钮时发生的就是这些）
POST /api/projects/<id>/scheduler/daemon/start   # 202 + jobId（mode 读 config.scheduler.mode）
POST /api/projects/<id>/scheduler/daemon/control {action:"stop"}  # 下一轮退出 + 清 autostart
```

**单实例**：CLI 与内嵌共用一把租约（`.cometflow/runtime/daemon.lease.json`，心跳 10s / 过期 60s）。
已经有调度器在跑时，第二次启动会被拒绝并告诉你**谁在跑**（`pid@host`、mode、起始时间）；
进程被杀导致的过期租约可被接管。CLI 的 `daemon start` 是手动/调试通道，**不读也不写** `autostart`。

`--mode manual` 只做一次回收 / 安全快照 / 状态投影就结束，不进循环——它的定位是"跑一次准备动作"，
不是常驻。

#### 崩溃恢复与重试（ADR 0024）

队列是**至少一次**语义：任务带租约，崩溃后能被收回并重试。

| 机制 | 行为 |
|---|---|
| 租约 | 任务置 `running` 时写下 `lease_until` 与 `owner`（pid@host） |
| 回收 | daemon 启动时与每轮循环各扫一次；过期租约回到 `queued` |
| 失败上限 | 同一任务启动满 3 次（含崩溃那次）仍失败 → 标 `failed`，打印 `daemon giving-up`，需人工介入后重新入队 |
| 预算累计 | 已用时长写 `.cometflow/runtime/budget.json`，重启不重置；`cometflow daemon budget [--reset]` 查看/清零 |
| 单任务超时 | 默认 30 分钟；超时按失败处理（`timed-out`），不会永久阻塞 daemon |
| 退避 | 失败后按尝试次数递增间隔重试，避免立刻重跑同一个必然失败的任务 |

```
daemon budget used=120000ms remaining=1800000ms
daemon reclaimed T3 attempts=2          # 上次崩在 running
daemon 0 T3 done
daemon giving-up T4 attempts=3 （需人工介入）
```

> 因为会回收，**队列任务必须幂等**——重复执行一次不应产生不可逆副作用。

---

## 9. 科学评估（eval）

```bash
cometflow eval [path]
```

读取 `.cometflow/eval.yaml`，对每个 task 重复 `sampling` 次并计算 Pass@k / Pass^k，
结果写入 `.cometflow/eval-report.json`。任一 task 的 pass^k 未通过则整体 FAIL（退出码 1）。

```yaml
schema: cometflow.eval.v1
sampling: 2            # 每个任务重复次数
pass_at_k: 1           # 前 k 次中至少 1 次通过
pass_all_k: 2          # 前 k 次全部通过
tasks:
  - name: typecheck
    command: node
    args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--noEmit"]
  - name: tests
    command: node
    args: ["node_modules/vitest/vitest.mjs", "run"]
    assertions:
      - target: stdout          # stdout | stderr
        operator: contains      # contains | not_contains
        value: "Test Files"
rubric:
  - id: correctness
    description: 核心正确性
    task: tests
judge:
  provider: mock                # mock | langsmith | langfuse
```

> `judge.provider` 为 `langsmith`/`langfuse` 时目前是 contract-only：检测到
> `api_key_env` 环境变量即返回 `blocked`，真实网络调用尚未实现；`mock` 为确定性判定。

---

## 10. 进化评审（evolve）

```bash
cometflow evolve propose <name> --summary <text> [--risk <text>] [--path <path>]
cometflow evolve verify  <name> [path] [--eval]
cometflow evolve submit  <name> [path]
cometflow evolve status  <name> [path]
cometflow evolve review-list [path] [--json]
cometflow evolve approve <name> [path] [--note <text>] [--commits <csv>]
cometflow evolve reject  <name> [path] --reason <text>
cometflow evolve rollback <name> [path]
```

状态流转与命令对应：

| 命令 | 结果 |
|---|---|
| `propose` | 创建提案，`status=draft`，写 `evolve/<name>.yaml` |
| `verify` | 依次跑门禁：`.cometflow/evolve.yaml` 的 `gates`，缺省为 typecheck + tests；`--eval` 叠加科学评估。全通过 → `verified`，否则 → `rejected` |
| `submit` | 仅 `verified` 可提交 → `ready-for-review`，生成 `evolve/<name>/review.md` |
| `approve` | 从 `ready-for-review` **或** `verified` 进入 `approved`（终态），可回填 `--note` / `--commits` |
| `reject` | 从任意非终态进入 `rejected`（终态），必须给 `--reason` |
| `rollback` | 打印回滚指引（不自动执行 git 操作） |
| `review-list` | 列出所有提案及状态，供人工逐项评审 |

门禁配置示例：

```yaml
# .cometflow/evolve.yaml
schema: cometflow.evolve.v1
gates:
  - name: typecheck
    command: node
    args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--noEmit"]
  - name: tests
    command: node
    args: ["node_modules/vitest/vitest.mjs", "run"]
```

决策会同时写入 `evolve/<name>.yaml` 的 `review_note / merged_commits / rejected_reason / decision_at`，
并追加到 `evolve/<name>/review.md` 的 `## Decision` 段落。

---

## 11. Skill 与 Bundle

### 11.1 Skill

Skill 是一个包含 `SKILL.md`（带 YAML frontmatter：`name`/`description`/`version`/`author`）的目录。

```bash
cometflow skill add <source-dir> [--project <dir>] [--overwrite]
cometflow skill list [--project <dir>]
cometflow skill show <skill> [--project <dir>]
cometflow skill import <source-dir> <name> [--project <dir>]
```

- `add` 安装到 `.cometflow/skills/<name>/`；已存在需 `--overwrite`。
- `import` = 安装 + **风险扫描**，会扫描 `network`（http(s) 链接）、`dangerous-command`
  （`rm -rf`/`sudo`/`chmod -R`/`mkfs`/`shutdown`…）、`absolute-path`（`/etc/`、`C:\` 等）并逐条打印。

### 11.2 Bundle

```bash
cometflow bundle create <name> [path]        # 写 .cometflow/bundle.yaml
cometflow bundle compile  [path]             # 列出编译后的文件清单
cometflow bundle distribute [path] --platform <platform>
```

`.cometflow/bundle.yaml` 定义要分发的 skill：

```yaml
schema: cometflow.bundle.v1
name: my-bundle
version: 0.1.0
skills:
  - name: safe-skill
    path: skills/safe-skill
```

支持平台（各分发到对应目录）：`opencode`（`.opencode/skills`）、`claude-code`（`.claude/skills`）、
`codex`（`.codex/skills`）、`qoder`、`codebuddy`、`zcode`、`cursor`、`windsurf`。

---

## 12. Web 客户端（`serve`）

```bash
cometflow serve [--workspace <dir>] [--port <port>] [--token <token>] [--web-dir <dir>] [--host <host>]
```

默认：工作区 `~/.cometflow/workspace`（可用 `COMETFLOW_WORKSPACE` 覆盖）、端口 `4321`、
随机 token、静态目录 `./web`（实际命中 `web/dist`，可用 `--web-dir` / `COMETFLOW_WEB_DIR` 覆盖）、
绑定 `127.0.0.1`。启动后打印：

```text
CometFlow: http://127.0.0.1:4321
token: <random>
```

浏览器打开 `http://127.0.0.1:4321/?token=<token>` 即可，token 会存入 localStorage 并自动清理 URL。
`/api/*` 需要 `Authorization: Bearer <token>` 或 `?token=`。

### 12.1 界面结构

- **首页**：新建项目（三步向导：基本信息 → 项目类型 → 预览 12-kind 并创建）、打开已有项目、最近项目列表。
- **项目内 10 个面板**：总览 Overview、目标 Goals、规格 Specs、计划 Plans、变更 Changes、进化 Evolve、
  评估 Eval、调度 Scheduler、资产 Assets、设置 Settings。
- **任务中心**（顶栏右侧抽屉）：进行中/已完成的 job、实时日志、刷新页面后仍在；
  「清理已完成」只清掉已结束的记录（排队/运行中的保留），带 change 的任务可一键跳到对应 change。
  任务与日志会**落盘**到 `.cometflow/runtime/jobs/`（记录原子写、日志追加写 + 1 MiB 轮转、落盘前脱敏），
  因此 **serve 重启后任务中心与 eval 报告仍在**。保留策略为「最近 200 条已完成 + 30 天」双阈值，
  `doctor` 报告占用与可回收量，`cometflow doctor . --clean-jobs` 执行回收（默认只报告）。
- **并发写保护（ADR 0021）**：spec 的 Web 写入（新建/保存/恢复）带 `ifHash` 做乐观并发检查。
  `concurrency.specWrites: fail` 时冲突返回 **409 `concurrent-modification`**（附期望/实际哈希，界面给「重读并重试 / 确认覆盖」）；
  默认的 `warn` 是**有期限**的过渡态：冲突照旧写入但回带 warning 并记入 `.cometflow/runtime/cas-conflicts.jsonl`，
  `warnUntil` 到期后 `doctor` 与 `spec verify` 报 error（CI 因此变红），只能「切 fail」或「延长并写 warnReason」。
  设置页的「并发写保护（ADR 0021）」卡片直接展示这四项：当前模式、warn 到期（含剩余天数）、延长理由、
  累计 warn 命中数（数据来自 `GET .../config` 的 `concurrencyPolicy` 与 `concurrencyConflicts`），
  并提供「切换为 fail」与「延长 30 天」（理由必填）两个入口——两者都走 `PUT /config` 的同一套校验
  （warn 必须带未来到期日、fail 不许留到期日），界面不是第二条写入通路。
  多文件事务（归档应用提案 spec、计划冻结、恢复历史版本）整段持 `.cometflow/runtime/lock`：
  取不到即 **409 `lock-held`**（说明持有者），`doctor` 报告锁状态，`doctor --force-unlock` 才清理。
- **总览（Overview）的三块投影**：界面不再有「后端算出来了、但只能敲命令」的空白。
  - **问题清单**：与 `cometflow gate check . --findings` **同一份投影**（spec verify + doctor 两个来源，
    按 `code + subject` 去重，同一个判定不会显示两次），按级别分组并给出「去处理」跳转；
    顶部徽章由 error 数驱动（不再是只看 doctor 一个来源）。

    **「去处理」落到能处理它的那一页**（面板 + 页签 + 对象，映射见 `utils/finding-targets.ts`），
    而不是笼统地切到某个面板：`stale-spec-lock` → 规格 · 影响与门禁（那里有「建立基线（spec lock）」
    与影响分析，落地时把那份 spec 挑到差异列表最前并说明两条出路），`missing-version-blob` → 规格 · 版本，
    `anchor-drift` / `spec-is-draft` → 规格 · Spec 文件（对应行加「问题清单指向」标记），
    `change-base-conflict` / `multiple-active-changes` → 变更，`hook-*` → 资产 · Hook 预览，
    并发写策略 → 设置。落地页顶部有一条「来自问题清单：<对象> —— 这里能做什么」的横幅；
    说不出去处的（临时文件、证据占用这类总览自己就能处理的）不给按钮——点进去发现处理不了比没有按钮更糟。
  - **质量与健康度**：与 `cometflow metrics . --json` 同源的指标（首次通过率、check 覆盖、
    验收可执行率、anchor 覆盖率、漂移、版本链），并**把当前生效的门禁阈值一起显示**——
    未配置时显示内置方向表，避免出现「看不见的约束」。
  - **维护动作**：`doctor --clean-temp` / `--clean-jobs` / `--force-unlock` 的界面入口。流程固定为
    「预告 → 二次确认 → 执行」：确认框显示将删除的文件/任务数量与锁的持有者（pid / host / action / 起始时间），
    并把该数字原样回传，服务端在执行前**重新核对**——不一致返回 **409 `stale-maintenance-preview`**，
    且**一个字节都不删**；执行成功后返回新的 doctor 结论，界面直接采用。
    同一张卡还带 **change 运行证据**行（等价 `change gc --apply`）：按 change 列出占用（前 3）、可回收项数与体积、
    候选路径，确认后只回收 `.cometflow/runtime` 下**可重新推导**的中间产物（归档事务的 staged/backup、
    已归档 change 的实现范围基线）；超过阈值的 journal 只轮转不删除。同样有预告值护栏——不匹配时
    连轮转都不做。
- **current-change 指针**：多个活跃 change 时写入门禁会 `fail closed`（reason `multiple-active-changes`）。
  「变更」面板顶部有一张**「当前 change（写保护路由）」卡**：把活跃 change 直接列成可点的
  「设为当前 <name> · <phase>」（等价 `cometflow change select <name>`），并写清后果——
  没设指针时 agent 的写入会被拒绝；**指定之后 doctor 那条 `multiple-active-changes` 会从 warning 降级为 info**，
  不跑 agent 的话可以先放着。卡片下沿还说明了遗留 change 的两条出路（走完流程归档 / 人工删目录）。
  资产面板的 Hook 预览在这两种拒绝原因（`multiple-active-changes` / `stale-current-change`）下就地给出
  change 下拉与「设为当前并重新检查」，把「被拒」变成一步可操作的动作。
- **Evolve 回滚指引**：每个提案卡有「回滚指引」按钮，弹窗内容与 `cometflow evolve rollback <name>` 同源
  （git tag / git show / git revert 步骤 + 当前状态），是纯投影、不改任何状态。
- **写保护状态（ADR 0023）**：资产面板的 Hook 页签顶部列出各平台的支持性、条目数、守卫脚本是否存在/漂移、
  以及守卫实际会调用的 CLI 能否解析。`claude-code` 是唯一支持安装的平台，另外两个显示「暂不支持安装」
  而不是「未安装」；安装与卸载仍走 CLI（会改机器配置，界面只做状态与判定预览）。
- **门禁可见性（ADR 0025）**：总览「门禁」卡给出 `gate check` 的逐项结论（spec validate / spec verify /
  doctor / change gc dry-run / plan validate / metrics 阈值与基线），以及本地提交门禁的安装状态
  （是否 git 仓库、宿主 plain/husky/lefthook、是否链式、内容是否漂移、`core.hooksPath` 指向）。
  「现在能不能提交」和「这个结论会不会被自动执行」是同一个问题的两半，所以放在同一张卡里。
- **任务追溯**：Plans 面板的「追溯」按钮展开「任务 → spec 绑定 → 验收项 → 状态」表
  （未绑定 spec、无验收项的任务显式标注），并附一份与 `cometflow plan trace <goal>` 逐字相同的文本清单。
- **锚点平铺**：Specs 面板「验收覆盖」页签**把两类锚点分开展示**，因为它们的"没有绑定任务"含义不同：
  - 上半部分按锚点分组列验收项，每组带徽章——**契约锚点 · 需绑定**（capability 的契约标题，
    会被 `plan generate` 派成任务、要独立验收）vs **`<kind>` 结构 · 不参与绑定**
    （flow 步骤、models 实体、rules 规则……只做展示与跨文件引用校验）；
  - 下半部分只列**可绑定锚点**（capability 的契约标题）：kind、有效验收项与其中可执行的数量、
    绑定它的 frozen/approved 任务；统计行同时给出「另有 N 个结构标题不参与绑定」，
    「未绑定」= **写了契约但没有任务去实现它**（这才是缺口）。
  口径与 `cometflow spec anchors`、指标里的 `anchor_coverage_rate` 同源。
- **表格导入**：Specs 面板「导入」页签支持粘贴 CSV / TSV / Markdown 表格（Excel 导出直接可用），
  先「预览」再「导入」：预览只解析、不落盘，并列出会新写的能力、因已存在而跳过的能力、能力名非法的项与解析问题；
  勾选「覆盖」才会重写已有 capability spec。解析与分组规则与 `cometflow spec import <file>` 是同一份实现。
- **顶栏健康徽章**：顶栏显示当前项目的 `N error / M warning`，数据与总览「问题清单」是同一份（共享 store），
  点击回到总览。打开项目时就加载，切换项目不会残留上一个项目的数字。
- **Eval 历史与对比**：评估面板列出该项目所有带报告的 `eval-run`（任务中心持久化，重启后仍在），
  可任选一轮作为「对比轮」，得到 Pass@k / Pass^k / 通过轮次的差值与「结论翻转」的任务清单。
- **目标单条编辑/删除**：「目标投影」页签每行有「编辑 / 删除」，只改 `COMETFLOW.md` 里对应的 `### Gn` 块
  （删除前弹窗显示将被删除的原文），保存后自动 `goal sync`；其它目标与段落不动。
- **调度预算**：调度面板显示跨重启累计的「已用预算」（`runtime/budget.json`）；重置走
  `cometflow daemon budget . --reset`（界面只读）。
- **调度器最近一次决策**（C5）：调度面板顶部读 `.cometflow/runtime/daemon-state.json`
  （daemon 在每个决策点写下的投影），显示 mode / agent / 轮次 / pid / 最近活动时间、
  「最近决策跑没跑 + 原因 + 针对哪个任务」、上一次任务的结论与耗时、队列计数与预算快照。
  从未跑过 daemon 时显式说明「这台机器上没写过状态投影」，而不是拿空队列糊弄；
  面板也明说「是不是还在跑」不由界面猜——时间戳是最后一次写状态的时间，pid 只是线索。
  **这些机器词都翻成人话**（`waiting-on-active-change` → 「在等在飞 change 让出 module」、
  `needs-human:verify-failed` → 「需人工介入：验收未通过」…），认不出来的新状态词原样显示，不静默吞掉。
- **「在不在跑」看租约，不看时间戳**（ADR 0027）：`runtime/daemon.lease.json` 每 10s 心跳、60s 过期，
  面板顶部按它显示「调度器在跑 / 没有调度器在跑」并列出持有者；一个任务能跑几十分钟，
  拿状态投影的 `updated_at` 当心跳会把"正在跑"误判成"停了"。
- **调度面板自动跟进度**：租约活着时每 4s 刷新一次（CLI 起的 daemon 只写项目文件、不发事件流）；
  没在跑时降到 20s 探一次——这样**从终端刚起的调度器会被自动发现**，不用手点刷新。
  页面上的控制 / 重建 / 重排 / 启动内嵌调度器仍然即时刷新（走 SSE 的 `scheduler` 区域）。
- **「为什么这条没被领」写在面板上**：并发单元被别的任务占着、或 module 归属与在飞 change 冲突时，
  状态投影记下 `last_skips`（谁挡住了谁、module 是什么），面板在决策卡里逐条列出——
  这些理由过去只出现在 daemon 的 stdout 日志里。
- **调度器的「控制」与「两态并列」**（P4/S4）：面板顶部有暂停 / 继续 / 停止三个按钮，
  它们只写控制文件（下一轮生效，不启停进程）；队列表里每行同时显示**调度状态**
  （queued/running/done/failed + 尝试次数 + 来源）与**交付状态**（change 名、phase、是否已归档、
  blocked 标记），于是「跑过」与「交付过」在界面上是两列而不是一个模糊的 done。
- **Specs 面板 6 个页签**：12-kind 状态、脚手架、Spec 文件、验收覆盖、版本、影响与门禁。
- **脚手架页签的 capability 入口**：root kind 由项目类型推导，capability 不由 init 生成、也无法推断，
  所以在同一页签里可以点名生成 `specs/<capability>/spec.md` 骨架（逗号分隔，可多个）。
  幂等：已存在的文件只报「未覆盖」，非法名字（含路径分隔符 / 隐藏文件）单独列出且不落盘。
- **Spec 文件页签的定稿状态**：每个 spec 显示「草案 / 已定稿」；草案带「批准定稿」按钮
  （等价 `cometflow spec approve <spec-file>`，带二次确认）。草案在 `plan freeze` 时会被拒，
  报错信息直接给出该命令。
- **资产页签的 bundle 分发**（C12）：Bundle 页签按平台列出「分发到 &lt;平台&gt;」按钮
  （平台列表来自 `GET /bundles`，界面不另存一份）。点击是**预告 → 确认 → 执行**：
  先用 `dryRun` 拿到每个 skill 的目标路径与「是否会被替换」，确认框里逐行列出并在有覆盖时
  点明「会被整个替换」，确认后才落盘。分发前会先 `compile` 一遍——清单读不出来时宁可在这里
  失败，也不要在「一半拷进去了」的状态下退出。
- **设置页的「一次性试跑」**：等价 `cometflow run [path] --agent <id>`——把 `COMETFLOW.md` 与 `specs/`
  交给一个 agent 跑一轮，用来确认「agent + 这个项目的上下文」能跑通。它**不绑 change / task / acceptance**，
  产物不进验收账本；日志走任务中心（`job.kind = flow-run`，刷新不丢）。界面会在执行前二次确认并写明
  「写入不受 change 约束，多个活跃变更时可能被写保护守卫拒绝」。
- **引用图页签**（W1 之后新增，共 7 个）：按 009 的引用方向表聚合 kind 之间的引用，
  点击可下钻 kind → 文件 → anchor 并列出该文件的逐条引用与位置；未解析引用红色标注，
  且与 `spec validate` 同源（图上红的就是门禁会报的）。对应 CLI：`cometflow spec graph [--json]`（只做投影，不设退出码）。
- **Spec 编辑器引用高亮**：编辑器里 `模型：X` / `错误码：Y` / `配置键：k` / `协议头：h` / `状态码：n` / `调用 METHOD /path`
  会渲染成 chip，未解析的引用标红并在下方给出跳转按钮；高亮走 `POST /spec/references`（对草稿正文求值，不需要先保存）。
- **Spec 编辑语义（ADR 0020）**：保存即一次 canonical 版本变更。编辑器另提供三个动作——
  「预览变更（相对当前版本）」（行级 diff）、「撤销到上一版」（等价 `spec restore`，撤销前先把当前内容记一版）、
  「存为提案」（写入 `changes/<change>/specs/`，只在 change 已存在且处于 shape 阶段时可用；
  提案不改 canonical spec，归档时才应用；编辑器发现已有提案会提示并可与之对比）。
  - 验收覆盖：每个 anchor 的验收项与其可执行 check；没有 check 的项显式标注（ADR 0013）。
  - 版本：按 spec 列出历史版本（含 hash/时间/来源），可查看历史正文并一键恢复（恢复前先把当前内容记一版）。
  - 影响与门禁：与基线的 diff、锚点级影响分析（可选「预演某个 change 归档后」）、一致性门禁、
    冻结任务漂移、跨文件引用校验，以及「建立基线（spec lock）」。
- **Changes 面板 4 个页签**（选中 change 后）：概览、范围、流水、证据。
  - 范围：实现范围报告——每个改动文件的归属（module / module-prefix / allow-list / OUTSIDE）、
    越界清单，以及快照跳过哪些路径（omission）。没有基线的老 change 明确报告「无法判定」，不猜。
  - 流水：`.cometflow/runtime/changes/<name>/journal.jsonl` 的全部事件（新建、基线捕获、迁移、
    运行、验收结论、rebase、解封、归档），新→旧排列。
  - 证据：`brief.md` / `verification.md` / `verification.yaml` 正文，提案 spec 列表、被 rebase 作废的
    验收记录、以及停在 staged 的归档事务（需要人工确认）。
  - 恢复路径：status=blocked 时出现「解除停机」（等价 `change unblock`）；归档遇到
    `spec-base-conflict`（HTTP 409）时给出两条明确路径——A 重新冻结基线（rebase）、B 按 ADR 0004 建
    reconciliation change。
- **调度面板**：读 `.cometflow/runtime/queue.json` 展示队列与下一个待办；没跑过 daemon 时给出
  「按已冻结计划推导」的待办视图，并只读展示调度器默认参数（改参数在设置页）。
- **资产面板**：四个页签——已安装 Skills（含 SKILL.md 正文）、Bundle（manifest + 编译产物预览 + 平台列表）、
  Classic change（只读列表）、Hook 预览（输入目标路径即可看到这次写入会不会被守卫拦下，以及原因和修复建议）。

界面能力要点：

- 目录选择器基于 `GET /api/fs/list`，Windows 下从盘符开始浏览。
- 新建项目 = `init` + 按技术栈/问答裁剪的 `spec scaffold`。
- Changes 面板运行 Builder 时走 job + SSE 实时日志；日志归属任务中心，离开面板或刷新都不会丢。
- `state.changed` / `job.*` 事件通过 `GET /api/events`（SSE）推送。刷新按区域去抖，并且只刷新受影响的面板；
  编辑 `COMETFLOW.md` / spec 时挂起刷新，避免外部事件覆盖正在输入的内容。
- 长任务（`change run` / `evolve verify` / `eval`）返回 202 + jobId；结果随 job 记录留存，
  刷新页面后从 `GET /api/jobs` 仍能取回（例如 eval 报告的 Pass@k / Pass^k）。
- 设置页保存是**增量合并**：只渲染部分字段的界面不会删掉 `verification` / `scope` 等未展示配置，
  也不会把全局默认固化进项目文件；`GET .../config/project` 可查看项目层真正覆盖了哪些键。

前端为 Vue 3 + Vite + TypeScript（ADR 0019）。开发与构建：

```bash
pnpm install                 # 同时安装 CLI 与 Web 依赖
pnpm web:dev                 # Vite dev server（:5173，/api 代理到 :4321）
pnpm web:build               # 产出 web/dist
pnpm web:typecheck           # 前端类型检查（含 .vue）
pnpm build                   # tsc（CLI）+ vite build（Web）
```

### 12.2 REST API 速查

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/workspace` | 项目列表（含状态摘要） |
| POST | `/api/projects` | 新建项目（init + scaffold + 注册） |
| POST | `/api/projects/import` | 打开已有项目（校验 `COMETFLOW.md`） |
| GET/DELETE | `/api/projects/<id>` | 项目详情 / 从工作区移除 |
| GET | `/api/projects/<id>/project/status` \| `/doctor` | 状态 / 诊断 |
| GET/PUT | `/api/projects/<id>/mission.md` | 读写 `COMETFLOW.md` |
| POST | `/api/projects/<id>/context/sync` \| `/goals/sync` | 上下文 / 目标同步 |
| GET | `/api/projects/<id>/goals` | 目标投影 |
| GET/PUT | `/api/projects/<id>/config` | 配置读写（PUT 为增量合并，带校验） |
| GET | `/api/projects/<id>/config/project` | 项目层覆盖（不含全局默认） |
| GET | `/api/projects/<id>/agents` | Agent 可用性 |
| GET | `/api/projects/<id>/init-manifest` | 12-kind 状态 |
| POST | `/api/projects/<id>/spec/scaffold` \| `/spec/validate` | 脚手架 / 校验（脚手架可带 `{capabilities: string[]}` 点名 capability 骨架；缺 stack 时用项目上下文推导 root kind） |
| GET | `/api/projects/<id>/spec-index` | spec 投影 |
| GET/POST | `/api/projects/<id>/specs` | 列 spec / 新建 spec 文件 |
| GET/PUT | `/api/projects/<id>/specs/content?path=...` | 读写单个 spec |
| GET | `/api/projects/<id>/spec/checks` | 验收项与其可执行 check（含未覆盖计数） |
| GET | `/api/projects/<id>/spec/verify` \| `/spec/diff` \| `/spec/drift` | 一致性门禁 / 基线 diff / 冻结任务漂移 |
| GET | `/api/projects/<id>/spec/impact[?change=]` | 锚点级影响分析（可叠加 change 提案） |
| GET | `/api/projects/<id>/spec/versions[?path=]` | 版本历史 |
| GET | `/api/projects/<id>/spec/version?ref=<path>@<version>\|<hash>` | 回放某一版正文 |
| GET | `/api/projects/<id>/spec/graph` | 引用关系图（kind→文件→anchor + 引用边 + 未解析集合） |
| POST | `/api/projects/<id>/spec/references` | 对给定正文返回带位置的引用 token（编辑器高亮用） |
| GET | `/api/projects/<id>/spec/proposals[?path=]` | 提案索引（带 path 时回正文），用于反查与对比 |
| POST | `/api/projects/<id>/spec/proposal` | 存为提案（只允许 shape 阶段的 change；不改 canonical spec） |
| POST | `/api/projects/<id>/spec/lock` | 建立基线：登记版本 + 刷新 spec-lock |
| POST | `/api/projects/<id>/spec/approve` | 草案 → 定稿（`{path}`；等价 `spec approve`，改完刷新版本与 lock） |
| POST | `/api/projects/<id>/bundles/distribute` | bundle 分发：`{platform, dryRun?}`；默认只回预告（目标路径 + 是否覆盖），`dryRun: false` 才落盘（等价 `bundle distribute`） |
| POST | `/api/projects/<id>/spec/restore` | 恢复历史版本（覆盖前先给当前内容记一版） |
| GET | `/api/projects/<id>/changes/<name>/scope` | 实现范围报告（归属解释 + 越界 + omission） |
| GET | `/api/projects/<id>/changes/<name>/journal[?limit=]` | 审计流水（含崩溃收敛与轮转后的历史） |
| GET | `/api/projects/<id>/changes/<name>/evidence` | 证据文件与提案 spec、未完成归档事务 |
| POST | `/api/projects/<id>/changes/<name>/rebase` | 重新冻结到当前 spec 版本（409 = 不可 rebase） |
| POST | `/api/projects/<id>/changes/<name>/unblock` | 解除停机（409 = 该 change 未停机） |
| GET | `/api/projects/<id>/scheduler/queue` | 调度面板的全部事实：`tasks`（合并视图：推导 + 运行时覆盖 + 交付账本，每行带 `source`/`delivered`/`workflow`）+ `derived` / `queue`（对账）+ `next` + `scheduler` + `budget` + `daemon`（状态投影）+ `control`（未消费的暂停/停止指令） |
| POST | `/api/projects/<id>/scheduler/queue/rebuild` \| `/reset` | 重建待办（保留运行时覆盖）/ 清掉覆盖强制重跑（等价 `daemon queue rebuild|reset`） |
| POST | `/api/projects/<id>/scheduler/queue/retry` | `{task}`：单条任务重新排队（细粒度恢复）；已交付/不存在 → 409 并说明原因 |
| POST | `/api/projects/<id>/scheduler/daemon/control` | `{action: pause\|resume\|stop}`：只写控制文件，不启停进程（ADR 0026） |
| POST | `/api/projects/<id>/scheduler/daemon/start` | 启动**内嵌调度器**（ADR 0027）：202 + jobId（`daemon` job，日志进任务中心）；已有调度器 → 409 并给出持有者；未知 agent → 400 |
| GET | `/api/projects/<id>/skills`、`/skills/<name>` | 已安装 skill 列表 / 单个 skill 详情（含 SKILL.md） |
| GET | `/api/projects/<id>/bundles` | bundle manifest + 编译产物预览 + 支持平台 |
| POST | `/api/projects/<id>/hook/check` | 写入门禁预览（与 `hook check` 同源） |
| GET | `/api/projects/<id>/findings` | 统一 findings 投影（verify + doctor 两源、去重；与 `gate check --findings` 同源） |
| GET | `/api/projects/<id>/metrics` | 度量报告 + 当前生效的门禁阈值（与 `metrics --json` 同源） |
| GET | `/api/projects/<id>/maintenance` | 维护动作的只读预告：残留临时文件 / 任务证据 / 事务锁 |
| POST | `/api/projects/<id>/project/evidence/clean` | 回收 change 运行证据（等价 `change gc --apply`；须回传预告值，不匹配 → 409 且什么都不做） |
| POST | `/api/projects/<id>/project/doctor/clean-temp` \| `/clean-jobs` \| `/force-unlock` | 执行维护动作（须回传预告值；不匹配 → 409 且不删任何文件） |
| GET/POST | `/api/projects/<id>/current-change` | 读写 current-change 指针（POST `{name}` 设定、`{name:null}` 清除；改指针 route 到 changes 面板刷新） |
| GET | `/api/projects/<id>/evolutions/<name>/rollback` | 回滚指引（等价 `evolve rollback`，纯投影） |
| GET | `/api/projects/<id>/hook/status` | 写保护安装状态（等价 `hook status`：条目、脚本漂移、守卫调用的 CLI 解析） |
| GET | `/api/projects/<id>/gate` | 门禁判定（等价 `gate check`）+ 本地提交门禁安装状态（等价 `gate status`） |
| GET | `/api/projects/<id>/spec/anchors` | 锚点平铺（等价 `spec anchors`：kind / 验收项 / 可执行数 / 绑定任务） |
| POST | `/api/projects/<id>/run` | 一次性 agent 试跑（等价 `cometflow run`）：`{agent?, model?, timeoutMs?}` → 202 `{jobId, agent}`；未知 agent 400 |
| POST | `/api/projects/<id>/spec/import` | 表格导入：`dryRun !== false` 只回预览（不落盘），否则写入（`{content, source?, module?, force?}`） |
| GET | `/api/projects/<id>/plans/<goal>/trace` | 任务追溯（等价 `plan trace`：文本清单 + 结构化任务行） |
| GET | `/api/projects/<id>/classic` | Classic change 只读列表 |
| GET/POST | `/api/projects/<id>/plans`、`/plans/generate`、`/plans/regenerate` | 计划列表 / 生成 / 重生成 |
| GET/POST | `/api/projects/<id>/plans/<goal>`、`/plans/<goal>/{validate,review,approve,freeze}` | 计划读写与状态推进 |
| GET/POST | `/api/projects/<id>/changes` | change 列表 / 新建 |
| POST | `/api/projects/<id>/changes/<name>/{resume,transition,run,verify,archive}` | change 操作（`run` 为 job） |

> `archive` 在 canonical spec 被外部改动时返回 **409 `spec-base-conflict`**，`error.details.conflicts`
> 列出每份冲突 spec 的期望/实际哈希；界面据此给出 rebase 与 reconciliation 两条路径，而不是只报一句失败。
| GET/POST | `/api/projects/<id>/evolutions`、`/evolutions/<name>/{verify,submit,approve,reject}` | 进化提案 |
| POST | `/api/projects/<id>/eval/run` | 触发评估（job） |
| GET | `/api/jobs`、`/api/jobs/<id>` | job 列表 / 详情 |
| GET | `/api/events` | SSE 事件流 |
| GET | `/api/fs/list?path=` | 目录浏览 |

> 打包说明：npm 包的 `files` 含 `dist/`、`web/dist/` 与 `README.md`；
> `pnpm build` 会同时产出两者。若从源码运行而没有构建过前端，
> `serve` 会在没有 `index.html` 的目录上报 404，先跑一次 `pnpm web:build` 即可。

---

## 13. 可观测与维护

```bash
cometflow status [path]              # 目标/计划/变更/进化 的 JSON 摘要
cometflow doctor [path] [--json] [--clean-temp]
cometflow gate check [path] [--json] [--update-baseline]   # 只读门禁（与 CI 同源）
cometflow gate install [path] --git-hooks                  # 装进 .git/hooks/pre-commit（链式、可逆）
cometflow gate status [path] [--json]                      # 已装 / 未装 / 内容漂移
cometflow gate uninstall [path] --git-hooks                # 卸载（未改动则逐字还原）
                                     # 健康检查：使命/上下文/spec 错误/无计划/多活跃 change
                                     # + spec 完整性（plan/state 内容哈希）
                                     # + 残留写入临时文件与滞留迁移；--clean-temp 才删除
cometflow dashboard [path] [--port]  # 只读 Dashboard（默认 4321，暴露 /api/status）
cometflow metrics [path] [--json]    # 只读度量：重建质量（首轮通过率/修复轮数/停机率）+ spec 健康度（可判定率/anchor 覆盖/漂移/版本）
cometflow project migrate [path]     # NIGHTSHIFT.md → COMETFLOW.md；.nightshift/config → .cometflow/config.yaml
cometflow hook check <target> [path] --event write|edit   # 写保护判定
cometflow hook install [path] --platform claude-code      # 把写保护装进平台 hook
cometflow hook status [path] [--json]                     # 已装 / 未装 / 守卫缺失
cometflow hook uninstall [path] --platform claude-code    # 卸载（未改动则逐字还原）
cometflow update                     # MVP stub：请重装 npm 包升级
cometflow uninstall [path] --force   # 删除 .cometflow/（必须 --force）
```

### 13.1 Hook / Guard 写保护规则

`evaluateHook` 的判定顺序：

1. 目标在项目外 → 放行（`outside-project`）。
2. 目标在 `.cometflow/` 内 → **拒绝**（机器所有权目录）。
3. 无活跃 change → 放行。
4. 多于 1 个活跃 change → **拒绝**（无法确定归属）。
5. 目标在自己的 `changes/<name>/` 内 → 放行。
6. 目标是 `COMETFLOW.md` 或 `specs/` 内 → 仅 `shape` 阶段放行，否则拒绝。
7. `verify` 阶段任何实现文件写入 → **拒绝**（验收期只读）。
8. 其余情况放行（`build`/`archive` 的实现写入）。

退出码非 0 表示被拒绝，可直接用于 CI 或 Agent 的 hook。

#### 把守卫装进平台

`hook check` 只是判定函数；要让它真正拦得住 agent 的写入，得装进平台的 hook 配置：

```bash
cometflow hook install . --platform claude-code
cometflow hook status .
cometflow hook uninstall . --platform claude-code
```

- 安装位置：`.claude/hooks/cometflow-guard.mjs` + `.claude/settings.json` 的 `hooks.PreToolUse`（matcher `Write|Edit|MultiEdit|NotebookEdit`，
  即 Claude Code 全部会落盘的内置工具；notebook 的路径字段是 `notebook_path`，守卫同样识别）。
- 守卫从 stdin 读工具调用 JSON，取出文件路径后调用 `cometflow hook check ... --event write`；被拒时以**退出码 2** 阻止该次写入。
- Windows 上守卫自己拼命令行并逐个给参数加引号（`shell: true` 下 Node 只按空格拼接、不转义）：
  **项目路径含空格时也必须拦得住**，否则守卫会把截断的路径交给 CLI、判定成 `outside-project` 后静默放行。
  `COMETFLOW_CLI` 自己也是命令行的第一个 token，带空格的裸路径（`C:\Program Files\...` 很常见）同样会被补引号；
  已经自带引号的值（例如 `node "C:/x/cli.mjs"`）原样使用，不再套一层。
- 边界说明：守卫只覆盖上面这些**文件类工具**，不覆盖 `Bash` 等间接写入。它是**流程约束**（让 agent 在越界前就被平台挡下），
  不是安全边界；需要强约束时用 `change verify` / `change archive` 的越界检查兜底。
- 当前仅支持 `claude-code`。`opencode` / `codex` 会**显式报「不支持」并返回非零退出码**，而不是写入猜测出来的配置（猜错会导致静默失效）。
- 守卫调用 `cometflow` 需在 PATH 上；也可用 `COMETFLOW_CLI` 指定可执行文件路径。CLI 确实不可用时守卫放行（避免把环境锁死），
  但判据很窄：**进程起来了 + stdout 为空 + stderr 是 shell 的「命令不存在」措辞**三条同时成立才放行。
  关键是 stdout 为空——CLI 只要真的判定过就会在 stdout 留下 `allowed` / `denied: …`，
  所以任何真实判定都不会被误判成「CLI 不在」而放行。
- 卸载是可逆的：安装时备份原始 `settings.json`；未被用户改动过就逐字还原，改过则只摘除 CometFlow 自己的条目。

#### 用 `doctor` 确认写保护还在生效

装了 hook 不等于写保护还在生效——守卫脚本可能被删、可能是升级前的旧版，`COMETFLOW_CLI` 也可能指向失效路径
（那种情况下守卫按上文**放行**，等于没有防护）。`cometflow doctor` 会把这些一次性报出来：

| 情况 | severity | code |
|---|---|---|
| 条目还在、守卫脚本缺失 | error | `hook-guard-missing` |
| 守卫脚本存在、配置里没有条目 | warning | `hook-entry-missing` |
| 守卫脚本与当前版本的生成器不一致（升级后未重装） | warning | `hook-guard-outdated` |
| 守卫要调用的 CLI 解析不到（会静默放行） | error | `hook-cli-missing` |
| 已安装且可用 | info | `hook-installed` |
| 未安装（写保护是可选增强，不影响健康） | info | `hook-not-installed` |

`hook status --json` 暴露同样的字段（`guardOutdated` / `cli`），面板与 CLI 同源。
另外 `doctor --json` 的**退出码与人类可读模式一致**：不健康时退出码 1，机器可读不影响结论。

### 13.2 度量（metrics）

`cometflow metrics` 把已经记录的证据（journal、change 状态、spec 版本链、漂移）聚合成两组数字，**纯只读**：

```bash
cometflow metrics .            # 人类可读摘要
cometflow metrics . --json     # cometflow.metrics.v1 报告
```

| 指标组 | 指标 | 口径 |
|---|---|---|
| 重建质量 | `first_pass_rate` | 首次验证即通过的 change 占比 |
| 重建质量 | `mean_attempts_to_pass` | 首次通过之前失败了几轮的均值（0 = 一轮就对） |
| 重建质量 | `pass_rate` / `blocked_rate` | 已归档占比 / 因同一失败结论停机占比 |
| 重建质量 | `verdict_sources` | 结论来源分布：check / document / agent / eval / uncovered |
| 重建质量 | `check_coverage_rate` | 结论全部来自 `check` 的 change 占比 |
| spec 健康度 | `acceptance_checkable_rate` | 带 `- check:` 的验收项占比 |
| spec 健康度 | `anchor_coverage_rate` | 被冻结/已批准任务绑定的 anchor 占比（附未覆盖清单） |
| spec 健康度 | `drift` | 漂移数量、按 kind/severity 分布、最早漂移 spec 的变更年龄 |
| spec 健康度 | `versions` | 被跟踪 spec 数、版本总数、出现过多版本的 spec 数 |

口径上有三条刻意设计：

1. **分母分离**：比率类指标只用「至少验证过一次」的 change 作分母（`sample_size`），
   从未走到验证的 change 单独计数（`total_changes`），避免稀释结论。
2. **空即 null**：没有数据时输出 `null` 而不是 `0`，避免把「没测过」读成「表现完美」。
3. **样本量提示**：`sample_size < 5` 时会在 `notes` 里明确写出「不要据此判断趋势」。

度量回答的是两个问题：**按 spec 重建出来的代码一次能不能过**（重建质量），**spec 本身够不够格当判据**（spec 健康度）。
它是后续所有改进的验证手段——例如「acceptance 可判定率」从 0 涨到 100%，就是「spec 能控制实现」的直接证据。

### 13.3 门禁（gate）：本地提交与 CI 用同一套判定

```bash
cometflow gate check . [--json] [--update-baseline]   # 跑全部只读门禁，退出码即结论
cometflow gate install . --git-hooks                  # 装进 .git/hooks/pre-commit
cometflow gate status . [--json]                      # 装没装 / 链没链 / 有没有漂移
cometflow gate uninstall . --git-hooks                # 卸载（逐字还原原有 hook）
```

判定项与 CI 完全一致（实现只有一份：`domains/gates/spec-gates.ts`）：

| 判定 | 说明 |
|---|---|
| `spec validate` | 结构、acceptance、跨文件引用、init-manifest 声明的 kind 是否齐全 |
| `spec verify` | 一致性门禁（lock 新鲜度、版本仓、anchor/验收漂移、plan/state 内容哈希、change 基线冲突） |
| `doctor` | 项目健康（含写保护状态、git 漂移、证据占用、残留临时文件、滞留锁） |
| `change gc (dry-run)` | 证据回收计划可计算（不修改任何东西） |
| `plan validate <goal>` | 计划覆盖度、依赖环、模块归属；跳过故意损坏的 `broken.*` |
| `metrics thresholds` | `gates.metrics` 配置本身合法（未知指标名 / min>max / 非法方向直接算失败） |
| `metrics baseline` | 关键指标只许持平或变好；配了 `min`/`max`/`tolerance` 就按配置判（见 §14.1） |

> 首次在某个项目上使用：先 `cometflow gate check . --update-baseline` 生成 `metrics-baseline.json` 并提交，
> 否则门禁会以「缺少基线」失败（这一条与 CI 完全一致，避免本地和 CI 两套语义）。

安装语义：

- **显式目标**：必须写 `--git-hooks`，不猜用户想装哪儿。
- **装到工具承认的位置**：自动探测宿主，装错地方会被工具重新生成（等于没装）：

  | 项目形态 | 安装位置 | 说明 |
  |---|---|---|
  | 裸仓库 | `.git/hooks/pre-commit`（`git rev-parse --git-path hooks` 解析） | 链式执行原有 hook；若已有 hook，备份为 `pre-commit.cometflow-orig` |
  | husky | `.husky/pre-commit` | 追加带标记的托管块，用户原有内容一字不动；husky 的 `_` 目录是自动生成的，绝不碰 |
  | lefthook | `lefthook.yml` 的 `pre-commit.commands` | **文本插入**（重新序列化 YAML 会丢掉用户注释）；结构不受支持（如 `pre-commit: extends:`）时明确拒绝并给手工步骤 |

  `gate status` 会报出当前用的是哪种集成；`gate install` 会提示前提条件（例如 husky 尚未接管 hooks）。
- **链式**：已有 `pre-commit` 会被备份到 `pre-commit.cometflow-orig`，并**先**执行；它失败就不再往下跑。
  卸载时若你没改过我们的包装脚本，就把它**逐字还原**；改过则拒绝覆盖，只提示你手工处理。
- **写对地方**：用 `git rev-parse --git-path hooks` 解析，尊重 `core.hooksPath`（husky / lefthook 会改它），
  并在 `gate status` 里提示。非 git 仓库直接报错，不写别处。
- **逃生门**：`git commit --no-verify`。这是 git 原生出口，门禁的价值在于默认生效，而不是无法绕过。

> 本轮顺带修掉两个「只打印不设退出码」的缺陷：`spec validate` 与 `plan validate` 此前**恒返回 0**，
> 也就是说 CI 门禁里这两步一直是绿的（与 `doctor --json` 恒返回 0 同源）。现在失败即退出码 1。

#### 一次看全：findings 统一呈现

`spec verify` 与 `doctor` 的 scope 不同，硬合并会让 CI 的红灯失去信号价值，所以**只统一呈现、不合并 scope**：

```bash
cometflow gate check . --findings    # 判定之外，列出合并去重后的逐条 finding（带来源）
cometflow gate check . --json        # 同上，结构化在 findings[] 里
cometflow spec verify . --with-doctor  # 显式要求时，把 doctor 的发现附在后面（另一个 scope，不改退出码）
```

| 来源 | scope | 典型 finding |
|---|---|---|
| `spec-verify` | spec 还是不是唯一根源 | lock 新鲜度、版本仓、anchor/验收漂移、plan/state 内容哈希、change 基线冲突 |
| `doctor` | 项目运行健康 | 写保护状态、git 漂移、残留临时文件、证据占用、滞留锁、并发策略 |

两点约定：

- **去重键是 `(code, subject)`**：两个 change 各自漂移是两个问题，不能被按 code 合并掉。
- doctor 对 spec verify 的镜像（`spec-verify:<code>`）在合并时丢弃，以 `spec verify` 那份为准——
  同一个判定不该出现两次。

---

## 14. 配置

### 14.1 分层

```text
内置默认值  →  全局 ~/.cometflow/config.yaml  →  项目 .cometflow/config.yaml  →  CLI 参数 / 环境变量
```

`agents` 字段在全局与项目之间做浅合并（项目覆盖同名 agent）。

```yaml
# .cometflow/config.yaml
schema: cometflow.project.v1
default_workflow: native        # 记录用字段
plan_review: high-risk          # 拆解审核策略；auto 自动 review+approve，high-risk 暂按 human 兜底
agent: opencode                 # 默认 Agent
model: deepseek-v4-flash        # 默认模型
agents:                         # 按 Agent 覆盖模型
  claude-code:
    model: claude-sonnet-4-5
scheduler:                      # daemon 默认参数
  mode: idle
  intervalMs: 60000
  budgetMs: 0
  idleCpuThreshold: 1.0
  scheduleStartMinutes: 540     # 09:00
  scheduleEndMinutes: 1080      # 18:00
scope:                          # 本地覆盖：允许在 spec 声明模块之外改动的路径
  allow:
    - package.json
    - pnpm-lock.yaml
verification:                   # 验收判定方式
  mode: checks                  # checks | checks+agent | agent-required
  agent: claude-code            # 独立 Verifier 使用的 agent
  model: claude-sonnet-4-5      # 可选，覆盖 Verifier 模型
  max_repair_attempts: 3        # 连续同一失败结论的轮数上限，超过即 blocked
  verifier_policy: warn         # Verifier 不可用时的策略：skip | warn | fail
git:                            # git 来源绑定
  allow_drift: false            # true = 允许在历史回退/分叉后继续推进
gates:                          # 门禁阈值（可选；不配 = 不新增约束）
  metrics:
    anchor_coverage_rate:
      min: 0.8                  # 绝对下限
    drift_count:
      max: 0                    # 绝对上限
    specs:
      direction: up             # 覆盖内置方向（up | down）
      tolerance: 1              # 相对基线允许的波动
```

`gates.metrics` 的三条口径：

1. **不配就不新增约束**：没写的指标沿用内置方向表（只许持平或变好），升级版本不会让项目突然变红。
2. **绝对阈值与相对基线互不替代**：`min`/`max` 判当前值本身；`direction`/`tolerance` 判它相对
   `metrics-baseline.json` 的变化。
3. **配置错误会让门禁变红**：未知指标名、非数字、`min > max`、非法方向都会直接失败并列出可用指标名——
   静默忽略等于给出一条假约束。同一份校验也用在 `PUT /config` 上。

`cometflow metrics` 会在末尾回显**当前生效的阈值**（哪些是默认、哪些被显式配置）。

### 14.2 环境变量

| 变量 | 作用 |
|---|---|
| `COMETFLOW_AGENT` | 覆盖默认 Agent（最高优先，仅 CLI 侧） |
| `COMETFLOW_HOME` | 全局配置根目录（默认 `os.homedir()`），全局配置位于 `$COMETFLOW_HOME/.cometflow/config.yaml` |
| `COMETFLOW_WORKSPACE` | `serve` 的工作区根目录 |

### 14.3 模型解析顺序

`agents.<agentId>.model` → `model` → 未设置（由 Agent 自身默认模型决定）。
凭证、endpoint、API key 一律由 Agent 工具自身管理，CometFlow **不代管**。

---

## 15. 回归验证与测试

平台单测：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm package-e2e
```

长期回归夹具（覆盖 init、spec、plan、change、eval、evolve、skill、bundle、classic、daemon、hook、doctor 等能力）：

```bash
node scripts/regression.mjs                       # 跨平台（Windows / Linux）
bash experiments/regression-fixture/run-regression.sh   # 等价的 shim
```

夹具的 `specs/**` 含**跨文件引用**（capability → models/errors/protocol、flow → capability/models/config、
rules → models 等，例见 `specs/session/spec.md` 与 `specs/flows/session-refresh.md`），因此
`scripts/regression.mjs` 除行为检查外还会断言引用图：`spec graph --json` 的 kind 边、
`target:model:Session` / `target:api:GET /session` 这类目标节点、`summary.unresolved === 0`，
并与 `spec validate` 的 findings 交叉核对（同源：图上绿色的边不该被门禁报成未解析）。

只读门禁（spec 是否仍然是唯一根源，退出码即结论）：

```bash
node scripts/spec-gates.mjs experiments/regression-fixture
node scripts/spec-gates.mjs experiments/regression-fixture --update-baseline   # 指标变好后更新基线
```

`spec-gates` 会跑 `spec validate` / `spec verify` / `doctor` / `change gc`（dry-run）/ `plan validate`，
并把 `metrics` 的关键指标与 `experiments/regression-fixture/metrics-baseline.json` 对比：
`acceptance_checkable_rate`、`anchor_coverage_rate`、`specs`、`capabilities`、`versions_total` 只许持平或变好，
`drift_count` 只许持平或变小。指标退化会让 CI 直接变红。

CI（`.github/workflows/ci.yml`）三个 job：`build-test`（ubuntu + windows）、`spec-gates`、`regression`（ubuntu + windows）。

规则：每实现一项新平台能力，必须补单元测试 + 在夹具中增加回归场景并更新 `scripts/regression.mjs`。
未出现在夹具清单中的能力，不视为具备长期回归保障。

---

## 16. 常见问题

**`cometflow: command not found`**
确认全局安装成功（`npm list -g @zqg/cometflow`）且 npm 全局 bin 在 PATH 中；或改用 `node dist/app/cli/index.js`。

**`spec validate` 报 `missing-project-context`**
先执行 `cometflow context sync .`（需要存在 `COMETFLOW.md`）。

**`plan validate` 报 `missing-coverage` / `unknown-anchor`**
说明 spec 里的某些 anchor 没有对应任务，或任务引用了不存在的 anchor。先修 spec，再
`cometflow plan regenerate <goal> . --preserve-approved`。

**`change new` 报 "Only frozen tasks can create changes"**
先 `cometflow plan freeze <goal> .`。

**`change run` 报 agent 不存在**
`cometflow agent list` 查看可用性；真实执行需安装对应 CLI，测试可用 `--agent mock`。

**`change verify` 总是 fail**
检查是否缺少 `changes/<name>/verification.yaml`（此时会回退跑 eval），或 verification 的
acceptance id 与冻结的 `acceptance_ids` 不一致。

**`spec drift` 报出漂移**
冻结任务的 `spec_hash` / `anchor_hash` 与当前 spec 不一致。输出里的 `kind` 说明漂移类型：
`anchor-modified` / `anchor-renamed` / `acceptance-changed` / `file-changed-anchor-unchanged`。
不要改历史：走 `plan regenerate --preserve-approved`（未开始）或创建 reconciliation change（已完成）。
先跑 `cometflow spec verify .` 可以看到同一条问题的门禁视图。

**`change archive` 报 spec conflict**
change 存续期间 canonical spec 被外部改动过，归档会覆盖那次变更所以被拦下。
先 `cometflow spec diff . --impact` 评估影响；确认无影响再 `cometflow change rebase <name> .`，
有影响则按 ADR 0004 创建 reconciliation change。

**`spec versions` 为空**
还没有登记过版本。运行 `cometflow spec lock .` 建立基线；`plan freeze` 与 `change archive` 也会自动登记。

**`serve` 打开后页面空白 / 401**
用启动时打印的 `?token=<token>` 访问一次。页面空白通常是 `web/dist` 未构建（跑 `pnpm web:build`）
或 `--web-dir` 指到了别处；`--web-dir` 指向 `web/` 时会自动使用 `web/dist/`。

**内网无法安装依赖**
使用 `offline-npm/` 里的三个 tarball 离线安装，或确认内网仓库已发布 `commander` 与 `yaml`。

---

## 17. 相关文档

- 设计文档索引：[`docs/design/README.md`](./design/README.md)
- 项目概览：[`docs/design/001-overview.md`](./design/001-overview.md)
- Spec 内核：[`docs/design/002-spec-driven-kernel.md`](./design/002-spec-driven-kernel.md)
- 任务规划：[`docs/design/003-task-planning.md`](./design/003-task-planning.md)
- spec 变更影响：[`docs/design/004-spec-change-impact.md`](./design/004-spec-change-impact.md)
- CLI 与执行流程：[`docs/design/005-cli-and-workflow.md`](./design/005-cli-and-workflow.md)
- 进化评审工作流：[`docs/design/007-evolution-review-workflow.md`](./design/007-evolution-review-workflow.md)
- 客户端可视化：[`docs/design/008-client-visualization.md`](./design/008-client-visualization.md)
- Spec 工件分类：[`docs/design/009-spec-artifact-taxonomy.md`](./design/009-spec-artifact-taxonomy.md)
- Init 脚手架：[`docs/design/010-init-scaffolding.md`](./design/010-init-scaffolding.md)
- 决策记录：[`docs/decisions/`](./decisions)
- 演示脚本（用 CometFlow 实现 todoscan）：[`docs/demo/todoscan-demo.md`](./demo/todoscan-demo.md)
- 演示命令对照说明：[`docs/demo/todoscan-demo-cli-notes.md`](./demo/todoscan-demo-cli-notes.md)
- 演示脚本（用 CometFlow 设计 CBB 应急运维接入）：[`docs/demo/cbb-emergency-access-demo.md`](./demo/cbb-emergency-access-demo.md)
