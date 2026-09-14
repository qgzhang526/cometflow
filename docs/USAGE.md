# CometFlow 使用说明

> 适用版本：`@zqg/cometflow` 0.2.0（CLI 名 `cometflow`，Node >= 22）。
> 本文上半部分讲**项目整体逻辑**，下半部分讲**怎么用它**。

---

## 1. 定位与整体逻辑

### 1.1 一句话概括

CometFlow 是一个**全时运行的自主 Agent 开发平台**。

人类只写两样东西——**项目使命**（`COMETFLOW.md`）和**项目级 spec**（`specs/`）；剩下的拆解、实现、验证、归档、无人值守推进、评估与进化，由 CometFlow 驱动外部编码 Agent（opencode / claude-code 等）完成。

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
| `specs/**` | 项目级 spec（12 类 kind） | 人类（Agent 只能产出 `[DRAFT]`，批准后才是正式 spec） |
| `.cometflow/config.yaml` | 项目配置 | 人类 / CLI / Web |
| `.cometflow/project-context.yaml` | 技术栈/运行环境投影 | `context sync`（机器生成） |
| `.cometflow/goals/*.yaml` | 目标投影 | `goal sync`（机器生成） |
| `.cometflow/plans/*.task-plan.yaml` | 任务计划与冻结的关联 | `plan generate/freeze` |
| `.cometflow/spec-lock.json` | spec hash 基线 | `spec lock` |
| `.cometflow/init-manifest.yaml` | 每个 spec kind 的 present/deferred/absent | `init` / `spec scaffold` |
| `.cometflow/spec-index/*.yaml` | models/apis/flows/errors/config 投影 | `spec index` |
| `.cometflow/runtime/queue.json` | 调度队列 | `daemon` |
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
> 「本项目不需要」也会留痕：`init-manifest.yaml` 记录 pending 状态，让 `spec validate` 能区分「有意缺席」与「遗漏」。

### 4.2 增量补 spec kind

```bash
cometflow spec scaffold .                          # 按技术栈推断，补缺失 kind（不覆盖已有文件）
cometflow spec scaffold . --interactive            # 逐项问答
cometflow spec scaffold --list .                   # 只列出各 kind 状态
cometflow spec scaffold . --capability order       # 建 specs/order/spec.md 骨架（可重复）
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

**anchor** = capability spec 中的二级标题（如 `## POST /api/auth/email-login`），任务通过它绑定 spec。若整份文件没有二级标题，则退化为三级标题：

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

### 5.3 跨文件引用规则

引用方向单向：**行为层 → 数据/契约层**，永不反向。

| 引用方 | 可引用 | 写法 |
|---|---|---|
| `capability` | `models` / `errors` / `protocol` | `模型：User`、`错误码：INVALID_CODE`、`协议头：User-Agent`、`状态码：401` |
| `flow` | `capability` / `models` / `config` | 步骤里 `调用 POST /api/auth/email-login`、`配置：PORT` |
| `process` | `capability` / `models` / `config` | 同上 |
| `rules` | `models` | `实体：KeywordRule` |
| `permissions` | `capability` | 矩阵首列写 `POST /api/xxx` |
| `constraints` | 不引用 | 独立 NFR |

`spec validate` 会据此报出 `unresolved-model-reference` / `unresolved-error-reference` /
`unresolved-config-reference` / `unresolved-api-reference` 等错误或警告。

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

> 注：`.cometflow/config.yaml` 里的 `plan_review`（`auto | high-risk | human`）与
> `default_workflow` 目前只作为配置记录保存，CLI 尚未按它们自动分支；review/approve 始终是显式命令。

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
  [--safety-bundle]
```

| 模式 | 行为 |
|---|---|
| `always` | 无条件推进，直到队列空或预算耗尽 |
| `idle` | 仅当 1 分钟 loadavg ≤ `--cpu-threshold`（默认 1.0）时才跑 |
| `schedule` | 仅在 `--start`/`--end` 时间窗内跑（必须同时给出，支持跨夜窗口） |
| `manual` | 不自动跑（用于只做一次安全快照/队列构建） |

要点：

- 队列来自 `.cometflow/plans/*.task-plan.yaml` 中 `frozen/approved` 的任务，落盘在 `.cometflow/runtime/queue.json`；已存在则复用。
- `--budget 0` 表示不限时；`--interval` 默认 60000ms。
- 启动时先做 git 安全快照并打印回滚指引；`--safety-bundle` 额外生成
  `.cometflow/runtime/safety.bundle`（`git bundle create ... --all`）。
- 每个任务执行成功/失败都会结算为 `done`/`failed` 并写回队列。

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
随机 token、静态目录 `./web`、绑定 `127.0.0.1`。启动后打印：

```text
CometFlow: http://127.0.0.1:4321
token: <random>
```

浏览器打开 `http://127.0.0.1:4321/?token=<token>` 即可，token 会存入 localStorage 并自动清理 URL。
`/api/*` 需要 `Authorization: Bearer <token>` 或 `?token=`。

### 12.1 界面结构

- **首页**：新建项目（三步向导：基本信息 → 项目类型 → 预览 12-kind 并创建）、打开已有项目、最近项目列表。
- **项目内 8 个面板**：总览 Overview、目标 Goals、规格 Specs、计划 Plans、变更 Changes、进化 Evolve、评估 Eval、设置 Settings。

界面能力要点：

- 目录选择器基于 `GET /api/fs/list`，Windows 下从盘符开始浏览。
- 新建项目 = `init` + 按技术栈/问答裁剪的 `spec scaffold`。
- Changes 面板运行 Builder 时走 job + SSE 实时日志。
- `state.changed` / `job.*` 事件通过 `GET /api/events`（SSE）推送，前端自动刷新。
- 长任务（`change run` / `evolve verify` / `eval`）返回 202 + jobId，前端轮询 `/api/jobs/<id>`。

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
| GET/PUT | `/api/projects/<id>/config` | 配置读写（带校验） |
| GET | `/api/projects/<id>/agents` | Agent 可用性 |
| GET | `/api/projects/<id>/init-manifest` | 12-kind 状态 |
| POST | `/api/projects/<id>/spec/scaffold` \| `/spec/validate` | 脚手架 / 校验 |
| GET | `/api/projects/<id>/spec-index` | spec 投影 |
| GET/POST | `/api/projects/<id>/specs` | 列 spec / 新建 spec 文件 |
| GET/PUT | `/api/projects/<id>/specs/content?path=...` | 读写单个 spec |
| GET/POST | `/api/projects/<id>/plans`、`/plans/generate`、`/plans/regenerate` | 计划列表 / 生成 / 重生成 |
| GET/POST | `/api/projects/<id>/plans/<goal>`、`/plans/<goal>/{validate,review,approve,freeze}` | 计划读写与状态推进 |
| GET/POST | `/api/projects/<id>/changes` | change 列表 / 新建 |
| POST | `/api/projects/<id>/changes/<name>/{resume,transition,run,verify,archive}` | change 操作（`run` 为 job） |
| GET/POST | `/api/projects/<id>/evolutions`、`/evolutions/<name>/{verify,submit,approve,reject}` | 进化提案 |
| POST | `/api/projects/<id>/eval/run` | 触发评估（job） |
| GET | `/api/jobs`、`/api/jobs/<id>` | job 列表 / 详情 |
| GET | `/api/events` | SSE 事件流 |
| GET | `/api/fs/list?path=` | 目录浏览 |

> 打包提醒：npm 包的 `files` 目前只含 `dist/` 与 `README.md`，**不含 `web/`**。
> 从 npm 全局安装时请显式指定 `--web-dir`（指向仓库或随包提供的 web 目录）。

---

## 13. 可观测与维护

```bash
cometflow status [path]              # 目标/计划/变更/进化 的 JSON 摘要
cometflow doctor [path] [--json] [--clean-temp]
                                     # 健康检查：使命/上下文/spec 错误/无计划/多活跃 change
                                     # + spec 完整性（plan/state 内容哈希）
                                     # + 残留写入临时文件与滞留迁移；--clean-temp 才删除
cometflow dashboard [path] [--port]  # 只读 Dashboard（默认 4321，暴露 /api/status）
cometflow project migrate [path]     # NIGHTSHIFT.md → COMETFLOW.md；.nightshift/config → .cometflow/config.yaml
cometflow hook check <target> [path] --event write|edit   # 写保护判定
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
plan_review: high-risk          # 记录用字段
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
```

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
cd experiments/regression-fixture
bash run-regression.sh
```

规则：每实现一项新平台能力，必须补单元测试 + 在夹具中增加回归场景并更新 `run-regression.sh`。
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
用启动时打印的 `?token=<token>` 访问一次；若用 npm 包安装且缺少 `web/`，需指定 `--web-dir`。

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
