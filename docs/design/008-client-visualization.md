# 008 客户端可视化（UI）架构

状态：设计草案（待评审；2026-09-07 更新：工作区 + 多项目 + 应用外壳 + 页面线框）
关联：005-cli-and-workflow.md、006-roadmap.md、ADR 0007、ADR 0008

## 1. 目标与范围

把 CometFlow 做成一个可用的 Web 应用，用户不敲命令也能完成：

1. 打开应用看到 **CometFlow 首页**：新建项目（选本地路径 → 创建，对应 init）、打开已有项目、最近项目列表；
2. 在「目标」面板查看/编辑 COMETFLOW.md 的总体目标与任务目标；
3. 点击按钮新增目标，再点击「拆解」走 plan generate → validate → review → approve → freeze；
4. 需要修改时走 plan regenerate（--preserve-approved）或 spec diff --impact → reconciliation；
5. change 流程以步骤条呈现：new → confirm-acceptance → run（实时日志）→ verify → archive；
6. 后续扩展 evolve / eval / daemon / doctor 面板。

范围边界（0.1.x）：

- 本机 localhost、单用户；
- serve 管理一个**工作区（workspace）**，工作区内可有多个项目；
- 优先「读 + 触发既有命令」，不新增业务逻辑；
- CLI 保留，不强制迁移到 UI。

## 2. 现状盘点（可直接复用）

| 资产 | 现状 | 对 UI 的价值 |
|---|---|---|
| `domains/*` 领域服务 | 已薄封装、无 UI 依赖 | serve 直接调用，不重写 |
| `domains/dashboard/server.ts` | 只读 dashboard + /api/status | serve 的种子实现 |
| `domains/scheduler/daemon.ts` | 长驻调度 | 未来 daemon 面板的数据源 |
| `domains/dashboard/collector.ts` | 项目状态聚合 | 首页/总览 |
| `app/commands/init.ts` | 生成 COMETFLOW.md 模板 | 「新建项目」直接复用 |
| 状态文件（.cometflow、changes/、evolve/） | YAML/JSON，机器可读 | UI 的单一事实源 |

已存在的状态机（UI 直接驱动它们，而不是发明新状态）：

| 对象 | 状态 | 说明 |
|---|---|---|
| TaskPlan | draft / validated / approved / frozen | `plans/<goal>.task-plan.yaml` |
| TaskRecord | draft / validated / approved / frozen / cancelled | plan 内每个任务 |
| Change | phase: shape / build / verify / archive；status: active / await-user / blocked / done | `changes/<name>/comet-state.yaml` |
| Evolution | draft / verifying / verified / ready-for-review / approved / rejected | `evolve/<name>.yaml` |
| Queue | queued / running / done / failed | `.cometflow/runtime/queue.json` |

## 3. 设计原则

1. **状态机驱动 UI**：按钮 = 事件/命令，按钮可用性 = 当前状态的前置条件；UI 只做「读状态 → 渲染 → 发事件 → 刷新状态」。
2. **单一 headless service**：Web/TUI 只调 serve，不 import domains，不解析 CLI 文本。
3. **Markdown-first**：COMETFLOW.md 是目标唯一事实源，UI 表单写回 Markdown 后再 goal sync。
4. **工作区与项目分离**：serve 管工作区 + 项目注册表，项目文件仍在用户选定的本地路径；projectId 间接寻址，绝对路径不进 URL。
5. **长任务 job 化**：任何可能超过秒级的操作都走 job + SSE，避免 HTTP 长连接卡死。
6. **本地优先安全**：serve 默认绑 127.0.0.1 + token；写操作返回可确认元数据，危险写操作二次确认。
7. **渐进演进**：先 serve + 首页 + 项目页，再做核心面板，TUI 后置；CLI 一直是兜底和脚本入口。

## 4. 目标架构

```text
                ┌───────────────────────────────────┐
                │  Web UI（Vue3 SPA，静态托管）        │
                │  首页/项目列表页 + 项目内面板          │
                └────────────────┬──────────────────┘
                                 │ fetch / EventSource(SSE)
                ┌────────────────▼──────────────────┐
                │   cometflow serve                 │
                │   REST + SSE + JobManager         │
                │   workspace + 项目注册表            │
                │   （127.0.0.1，token）             │
                └──────┬──────────────────┬─────────┘
                       │                  │
            ┌──────────▼────────┐  ┌──────▼───────────┐
            │ workspace.json    │  │ domains/* 服务    │
            │ （项目注册表）      │  │ platform/agents  │
            └───────────────────┘  └──────┬───────────┘
                                          │
                               ┌──────────▼──────────────────────────┐
                               │ 项目文件（每项目独立事实源，与 CLI 共享）│
                               │ COMETFLOW.md / .cometflow / changes/ │
                               └─────────────────────────────────────┘
```

## 5. 应用外壳与信息架构

### 5.1 全局壳

```text
┌──────────────────────────────────────────────────────────────┐
│ ◆ CometFlow  当前项目: 2048 (D:\...\experiments\2048)  [切换] │  ← TopBar
├───────────────┬──────────────────────────────────────────────┤
│ 总览          │                                              │
│ 目标 Goals    │              内容区（当前面板）                │
│ 规格 Specs    │                                              │
│ 计划 Plans    │                                              │
│ 变更 Changes  │                                              │
│ 进化 Evolve   │                                              │
│ 评估 Eval     │                                              │
│ 调度 Daemon   │                                              │
│ 诊断 Doctor   │                                              │
└───────────────┴──────────────────────────────────────────────┘
   SideNav                                    Content
```

TopBar 元素：

- 左侧：Logo + 网站名 **CometFlow**（中文候选名「恒彗」可作副标题）。
- 中间：当前项目名 + 本地路径；点击可切换项目。
- 右侧：Agent 可用性徽章（opencode / claude-code）、项目健康徽章（doctor: OK / NEEDS ATTENTION）、进行中的 job 指示器。

### 5.2 页面清单

| 页面 | 作用 | 对应命令/服务 |
|---|---|---|
| 首页 / 项目列表 | 新建项目、打开项目、最近项目 | init、project 注册 |
| 总览 Overview | 项目状态摘要 + 快速入口 | collectProjectStatus |
| 目标 Goals | 编辑总体目标/技术栈/任务目标 | mission.md 读写、context/goal sync |
| 规格 Specs | 12-kind 状态/脚手架/跨文件引用图/校验 | init-manifest、spec scaffold、spec-index、spec validate |
| 计划 Plans | 拆解向导 | plan generate/validate/review/approve/freeze/regenerate |
| 变更 Changes | 步骤条 + 运行日志 | change new/transition/run/verify/archive |
| 进化 Evolve | 提案评审 | evolve propose/verify/submit/approve/reject |
| 评估 Eval | 提交与报告 | eval |
| 调度 Daemon | 队列/模式/日志 | daemon start 等 |
| 诊断 Doctor | 检查结果卡片 | doctor |
| 设置 Settings | Agent/模型/调度器配置 | config 读写、agent list/check |

### 5.3 首页与项目选择（无项目或未选择时）

- 大标题 **CometFlow** + 一句话定位「全时运行的自主 Agent 开发平台」。
- 两个主按钮：**[+ 新建项目]**、**[打开已有项目]**。
- 最近项目卡片列表：名称、路径、goals/plans/changes 摘要、最近打开时间。

### 5.4 新建项目流程（对应 init + 12-kind 脚手架）

新建项目是一个三步向导，而不是单个弹窗：

1. **基本信息**：项目名称 + 本地路径（目录选择器 + 可手输）。
2. **项目类型（12-kind 裁剪）**：
   - 技术栈提示（前端/后端/数据库）与 COMETFLOW.md「技术栈」表一致，用于第一层推断（frontend≠无 → pages、database≠无 → models、有后端 → constraints）；
   - 七个交互问题（对应 Q1-Q7）：网络接口、运行时配置、跨接口流程、后台进程、领域 DSL、鉴权方式（无需/机机/角色矩阵）、错误码是否较多（>20）。
3. **预览并创建**：展示 12-kind 清单（present/deferred/absent + reason + 目标文件），点「创建」→ POST /api/projects（带 stackHints + scaffoldAnswers）→ 服务端 init + scaffold，生成 kind 骨架与 init-manifest.yaml；前端跳转到 Specs 面板。

## 6. 页面线框

### 6.1 首页 / 项目列表

```text
┌──────────────────────────────────────────────────────┐
│  CometFlow                                            │
│  全时运行的自主 Agent 开发平台                          │
│                                                       │
│  [+ 新建项目]     [打开已有项目]                        │
│                                                       │
│  最近项目                                              │
│  ┌──────────────────────────┐ ┌─────────────────────┐ │
│  │ 2048                     │ │ my-api              │ │
│  │ D:\...\experiments\2048 │ │ D:\...\my-api       │ │
│  │ 9 目标 · 26 任务 · 24 change│ │ 2 目标 · 3 任务      │ │
│  │ 3 分钟前                 │ │ 昨天                 │ │
│  └──────────────────────────┘ └─────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

新建项目三步向导：

```text
① 基本信息              ② 项目类型              ③ 预览创建
┌─ 新建项目 ──────────────────────────────────────┐
│ 项目名称   [__________________________]         │
│ 本地路径   [________________] [浏览…]            │
│ 技术栈  前端 [无 ▼] 后端 [Go ▼] 数据库 [SQLite ▼] │
│                                                │
│ ── 项目类型（决定生成哪些 spec kind）──────────── │
│ [✓] 对外网络接口/协议    [ ] 运行时配置键          │
│ [✓] 跨接口业务场景       [ ] 后台进程             │
│ [ ] 领域 DSL            鉴权方式 [机机 ▼]         │
│ [ ] 错误码 > 20 个                               │
│                                                │
│ [取消]                                [下一步]   │
└────────────────────────────────────────────────┘
        ↓ 下一步
┌─ 预览 12-kind ──────────────────────────────────┐
│ ● present   models / protocol / config /        │
│             constraints / permissions           │
│ ○ deferred  rules / flow / pages / process      │
│ — absent    capability（由 plan 生成）            │
│ [取消]                                  [创建]  │
└────────────────────────────────────────────────┘
```

### 6.2 Goals（目标）面板

```text
┌ Goals ─────────────────────────────── [同步] ┐
│ 总体目标（项目使命，可编辑）                    │
│ ┌────────────────────────────────────────┐ │
│ │ 构建一个内部数据查询平台                   │ │
│ └────────────────────────────────────────┘ │
│ 技术栈 / 运行环境（从 COMETFLOW.md 表格投影）   │
│ ┌────────────────────────────────────────┐ │
│ │ 前端: 无 · 后端: Golang · 数据库: SQLite │ │
│ └────────────────────────────────────────┘ │
│ 任务目标                                     │
│ ┌ G1 用户邮箱登录        [编辑] [删除]      ┐ │
│ ┌ G2 数据查询权限         [编辑] [删除]     ┐ │
│ [+ 添加目标]                                 │
│ 上次同步: 12:03:11 · goal sync OK            │
└─────────────────────────────────────────────┘
```

### 6.3 Plans（拆解）向导

```text
┌ Plans ─────────────── 目标: [G1 ▼] ────────────┐
│ 状态: draft ──► validated ──► approved ──► frozen │
│ [生成] [校验] [评审] [批准] [冻结] [重新生成]       │
│ ┌─ 任务列表 ────────────────────────────────┐  │
│ │ T1 实现 auth - POST /login      draft     │  │
│ │ T2 实现 auth - POST /logout     draft     │  │
│ │     依赖: T1 · acceptance: A1,A2          │  │
│ └───────────────────────────────────────────┘  │
│ ┌─ 校验结果 ────────────────────────────────┐  │
│ │ ⚠ ERROR missing-coverage: specs/auth#...  │  │
│ │ ✔ WARNING 堆栈命令不匹配                    │  │
│ └───────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

### 6.4 Changes（执行）步骤条

```text
┌ Changes ──────────────────────────────────────┐
│ 列表: [auth-login ▸] [auth-logout] ...        │
│ ──────────────────────────────────────────── │
│ auth-login:  shape → build → verify → archive │
│                 ●                            │
│ [确认验收] [运行 Builder] [验收] [归档]         │
│ ┌─ 运行日志（SSE 实时）──────────────────────┐ │
│ │ $ opencode run ...                        │ │
│ │ [job.log] implementing POST /login ...     │ │
│ └───────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

### 6.5 通用元素

- **Toast 通知**：SSE 的 `state.changed` / `job.completed` / `job.failed` 弹角标。
- **Job 指示器**：TopBar 显示进行中的 job（spinner + 名称），可展开日志。
- **确认对话框**：危险写操作（freeze、archive、approve、写 mission.md）二次确认。
- **空状态引导**：无目标/无计划/无 change 时显示说明 + 主按钮，降低上手成本。

### 6.6 Settings（设置）

```text
┌ Settings ──────────────────────────────────────┐
│ Agent 与模型                                     │
│ 默认 Agent   [opencode ▼]   ● available         │
│ 默认模型     [deepseek-v4-flash        ]        │
│ ┌ 按 Agent 分模型 ──────────────────────────┐   │
│ │ opencode     [deepseek-v4-flash]         │   │
│ │ claude-code  [claude-sonnet-4-5    ]      │   │
│ └───────────────────────────────────────────┘  │
│ 调度器（daemon 默认参数）                         │
│ 模式 [idle ▼]  间隔 [60000]ms  预算 [0]ms        │
│ 空闲 CPU 阈值 [1.0]                              │
│ [保存配置]                                       │
└─────────────────────────────────────────────────┘
```

### 6.7 Specs（规格）面板

```text
┌ Specs ─────────────────────────────────────────────────┐
│ [kind 状态] [引用图] [校验] [文件]                        │
│ ┌ 12-kind 状态 ──────────────┐ ┌ 引用关系图 ─────────────┐ │
│ │ ● models     specs/models.md│ │        ┌ project ┐     │ │
│ │ ● protocol  specs/protocol. │ │            │ scope      │ │
│ │ ○ flow      deferred        │ │        ┌ capability ┐  │ │
│ │ — capability 由 plan 生成    │ │   ┌────┼─────┐      │  │ │
│ │ [补全 deferred]             │ │ models errors protocol │ │
│ └─────────────────────────────┘ └────────────────────────┘ │
│ ┌ 校验结果 ─────────────────────────────────────────────┐ │
│ │ ✗ unresolved-model-reference  flow/login.md:12       │ │
│ │   「实体 Session」未在 models.md 定义 → [去补]          │ │
│ │ ✔ 0 error / 3 warning                               │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## 7. headless service：cometflow serve

命令：`cometflow serve [--workspace <dir>] --port <port> --token <token>`。缺省端口 4321，缺省绑 127.0.0.1；未指定 token 时随机生成并打印到控制台。静态托管 web 前端构建产物。

### 7.1 工作区与项目端点

| 方法 | 路径 | 说明 | 对应命令 |
|---|---|---|---|
| GET | /api/workspace | 项目注册列表（含状态摘要、最近打开） | — |
| POST | /api/projects | 新建项目（{name, path}）：init + 注册 | `cometflow init` |
| POST | /api/projects/import | 扫描已有项目并注册（{path}） | 检测 COMETFLOW.md |
| GET | /api/projects/{projectId} | 项目详情/状态摘要 | `cometflow status` |
| DELETE | /api/projects/{projectId} | 从注册表移除（不删除项目文件） | — |

### 7.2 项目内端点（前缀 /api/projects/{projectId}）

以下所有路径均相对于 `/api/projects/{projectId}`。

#### 项目 / 目标

| 方法 | 路径 | 对应命令/服务 | 类型 |
|---|---|---|---|
| GET | /api/project/status | collectProjectStatus | 同步 |
| GET | /api/project/doctor | runDoctor | 同步 |
| GET | /api/mission.md | 读 COMETFLOW.md 全文 | 同步 |
| PUT | /api/mission.md | 写 COMETFLOW.md 全文 | 同步 |
| POST | /api/context/sync | context sync | 同步 |
| POST | /api/goals/sync | goal sync | 同步 |
| GET | /api/goals | 读 goals/*.yaml | 同步 |

#### 配置与 Agent

| 方法 | 路径 | 对应命令/服务 | 类型 |
|---|---|---|---|
| GET | /api/config | 读 .cometflow/config.yaml | 同步 |
| PUT | /api/config | 写 .cometflow/config.yaml（含校验） | 同步 |
| GET | /api/agents | agent list（含 available 检测） | 同步 |

#### 规格 Specs

| 方法 | 路径 | 对应命令/服务 | 类型 |
|---|---|---|---|
| GET | /api/init-manifest | 12-kind 状态（present/deferred/absent） | 同步 |
| POST | /api/spec/scaffold | spec scaffold（补 deferred/指定 kind，幂等） | 同步 |
| GET | /api/specs | listSpecEntries（path + kind） | 同步 |
| GET | /api/specs/{path} | 读单个 spec 文件 | 同步 |
| PUT | /api/specs/{path} | 写单个 spec 文件 | 同步 |
| GET | /api/spec-index | buildSpecIndex 投影（apis/models/flows/errors/config） | 同步 |
| POST | /api/spec/validate | spec validate（含 cross-ref findings） | 同步 |

注：`{path}` 是相对路径（如 `specs/models.md`），含斜杠，建议用查询参数或 URL 编码传递。

#### 计划拆解

| 方法 | 路径 | 对应命令 | 类型 |
|---|---|---|---|
| POST | /api/plans/generate | plan generate（{goal}） | 同步* |
| GET | /api/plans/{goal} | 读 task-plan.yaml | 同步 |
| POST | /api/plans/{goal}/validate | plan validate | 同步 |
| POST | /api/plans/{goal}/review | plan review | 同步 |
| POST | /api/plans/{goal}/approve | plan approve | 同步 |
| POST | /api/plans/{goal}/freeze | plan freeze | 同步 |
| POST | /api/plans/{goal}/regenerate | plan regenerate（{preserveApproved}） | 同步* |

\* 当前 generate/regenerate 是确定性扫描，很快；未来接入 LLM Decomposer 时切换为 job，端点不变，返回 202 + jobId。

#### Change 执行

| 方法 | 路径 | 对应命令 | 类型 |
|---|---|---|---|
| GET | /api/changes | change list（含 archived） | 同步 |
| POST | /api/changes | change new（{name,goal,task}） | 同步 |
| GET | /api/changes/{name} | 读 comet-state.yaml | 同步 |
| POST | /api/changes/{name}/resume | change resume | 同步 |
| POST | /api/changes/{name}/transition | change transition（{event}） | 同步 |
| POST | /api/changes/{name}/run | change run（{agent}） | job |
| POST | /api/changes/{name}/verify | change verify | 同步* |
| POST | /api/changes/{name}/archive | change archive | 同步 |

\* verify 内部跑本地 eval，若 eval 变慢可升级为 job。

#### 进化 / 评估

| 方法 | 路径 | 对应命令 | 类型 |
|---|---|---|---|
| GET | /api/evolutions | evolve review-list | 同步 |
| POST | /api/evolutions | evolve propose | 同步 |
| POST | /api/evolutions/{name}/verify | evolve verify（{eval}） | job |
| POST | /api/evolutions/{name}/submit | evolve submit | 同步 |
| POST | /api/evolutions/{name}/approve | evolve approve（{note,commits}） | 同步 |
| POST | /api/evolutions/{name}/reject | evolve reject（{reason}） | 同步 |
| POST | /api/eval/run | eval | job |

#### 任务与事件

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/jobs | 任务列表 |
| GET | /api/jobs/{id} | 任务详情（含日志环形缓冲） |
| GET | /api/events | SSE 流（工作区级，含项目维度） |

### 7.3 统一响应 envelope

```json
{ "ok": true, "data": { }, "requestId": "..." }
{ "ok": false, "error": { "code": "unknown-goal", "message": "..." }, "requestId": "..." }
```

### 7.4 Job 模型

长任务不在 HTTP 请求内等待：

```text
POST /api/projects/{id}/changes/{name}/run
      │
      ▼
202 { "jobId": "job_xxx" }
      │
      ▼ 后台执行 domains/workflow/change-execution.ts
SSE: job.queued → job.started → job.log* → job.completed | job.failed
      │
      ▼ 任一写操作成功后
SSE: state.changed { "projectId", "path" }   ← 前端据此刷新
```

JobRecord（内存态，MVP 不持久化，重启丢失）：

```ts
interface JobRecord {
  id: string;
  projectId: string;
  kind: 'plan-generate' | 'plan-regenerate' | 'change-run' | 'change-verify' | 'evolve-verify' | 'eval-run';
  goal?: string;
  change?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  logTail: string[];
}
```

SSE 事件类型：`job.queued`、`job.started`、`job.log`（{line}）、`job.completed`（{result}）、`job.failed`（{error}）、`state.changed`（{projectId,path}）。MVP 用内存 EventEmitter 广播，单进程单连接即可。

## 8. UI 面板与状态机映射

### 8.1 Goals（目标）面板

- 数据：GET /api/mission.md（总体目标「项目使命」+ 任务目标 G1..Gn）+ GET /api/goals（投影结果）。
- 布局：总体目标文本框；技术栈/运行环境卡片；目标列表；「+ 添加目标」追加一个 `### Gn` 到 COMETFLOW.md；「同步」调 context sync + goal sync。
- 关键：**添加的是目标（G），不是任务（task）**；task 由 plan generate 产生。
- 编辑方式：MVP 整文 Markdown 编辑（结构化表单生成 Markdown 块后写回全文），保持唯一事实源。

### 8.2 Plan（拆解）向导

按钮可用性由 TaskPlan.status 决定：

| 当前状态 | 可用按钮 | 目标状态 |
|---|---|---|
| （无计划） | 生成 | draft |
| draft | 校验 / 评审 / 批准 | validated / validated / approved |
| validated | 批准 / 重新生成 | approved / draft |
| approved | 冻结 / 重新生成(--preserve-approved) | frozen / draft |
| frozen | 只读；改动走 regenerate 或 spec diff | — |

- 展示：任务列表（标题/capability/spec_anchor/acceptance_ids/depends_on/test_scope/DoD），validate 的 findings 按 error/warning 分组高亮。
- 修改路径：① 拆解错 → 直接 regenerate；② 目标错 → 改 COMETFLOW.md → goal sync → regenerate；③ 项目级 spec 错 → spec diff --impact → reconciliation change。

### 8.3 Change（执行）步骤条

四步：shape → build → verify → archive。

| 步骤 | 动作 | 端点 | 说明 |
|---|---|---|---|
| shape | 确认验收 | transition {confirm-acceptance} | 需 acceptance 已冻结 |
| build | 运行 Builder | run（job） | 实时日志流；成功自动 submit-candidate |
| verify | 验收 | verify | 展示 verification.md / eval 结果 |
| archive | 归档 | archive | 应用 proposed specs，置 done |

verify-fail 会回退到 build，步骤条需要能表达「回退」而不只是前进。

### 8.4 Evolve / Eval / Daemon / Doctor（后续）

- Evolve：propose → verify（job，门禁日志）→ submit → approve/reject 表单（note/commits/reason）。
- Eval：提交 job，进度 + 报告可视化（pass@k / pass^k / rubric / judge notes）。
- Daemon：队列、模式、预算、日志；doctor：结果卡片。

### 8.5 Settings（Agent / 模型 / 调度器）配置模型

配置层级（由低到高，高者覆盖低者）：

| 层级 | 位置 | 说明 |
|---|---|---|
| 全局默认 | `~/.cometflow/config.yaml` | agent/model 默认值，跨项目复用 |
| 项目配置 | `<project>/.cometflow/config.yaml` | 覆盖全局，UI 设置页写这里 |
| 单次运行 | change run / run 对话框参数 | 仅当次生效 |
| 环境变量 | `COMETFLOW_AGENT` | 仅 CLI 侧最高优先（现有行为） |

项目 config schema（`cometflow.project.v1`，建议字段）：

```yaml
schema: cometflow.project.v1   # 固定，与 init/migrate 一致
default_workflow: native       # 既有字段
plan_review: high-risk         # 既有字段
agent: opencode                # 必填，必须在 registry 内
model: deepseek-v4-flash       # 可选；空 = 使用 agent 工具自身默认
agents:                        # 可选：按 agent 分别设默认模型
  opencode: { model: deepseek-v4-flash }
  claude-code: { model: claude-sonnet-4-5 }
scheduler:                     # 可选：daemon 面板默认参数
  mode: idle
  intervalMs: 60000
  budgetMs: 0
  idleCpuThreshold: 1.0
  scheduleStartMinutes: null
  scheduleEndMinutes: null
```

存储边界：CometFlow 只存「用哪个 agent + 哪个模型名」，不存 API key / endpoint / 凭证；这些由 agent 工具自身配置（opencode.jsonc / CLAUDE.md / 环境变量）管理。

UI 表现：

- 设置页：默认 agent 下拉（带可用性标记）、默认模型、按 agent 分模型（折叠）、调度器参数；
- Change run 对话框：agent + model 下拉，默认取项目配置，可覆盖；
- TopBar：agent 可用性徽章（数据来自 agent check）。

新增服务：`domains/project/config.ts`（读写/校验 config.yaml），并把 `flow-run.ts` 的 `resolveAgentId` 迁移到该服务（消除 ad-hoc 读取）。

### 8.6 Specs 面板与跨文件引用设计

数据来源（机器投影，不手绘）：

- `.cometflow/init-manifest.yaml`：12-kind 的 present/deferred/absent + reason；
- `.cometflow/spec-index/{models,apis,flows,errors,config}.yaml`：结构投影；
- `spec validate` findings：跨文件引用错误/告警。

**① kind 状态视图**

- 12 个 kind 卡片/表格：状态徽章（present 绿 / deferred 黄 / absent 灰）、canonical 路径、reason；
- 「补全 deferred」→ POST /api/spec/scaffold（幂等，不覆盖人类修改）；
- 点击 kind → 打开对应文件（Markdown 编辑或结构化视图）。

**② 引用关系图（graph）**

- 节点按 kind 聚合；边按 009 的引用方向表生成（capability→models/errors/protocol、flow→capability/models/config、process→capability/models/config、rules→models、permissions→capability、project→capability）。
- 点击 kind 节点展开到文件级/接口级/实体级（如 capability 展开为 `POST /login`；models 展开为实体/枚举/状态机）。
- 悬停边显示引用详情（源 anchor → 目标 anchor）；deferred/absent kind 置灰。

**③ 引用检查面板**

- 按 severity/code 分组：`unresolved-model-reference`、`unresolved-api-reference`、`unresolved-error-code`、`unresolved-config-key`、`missing-reference-target` 等；
- 每条 finding 显示 [severity] code + 源文件:行 + 缺失目标，点击跳转源文件对应位置；
- 顶部统计徽章：0 error / n warning，error 阻断下一步（plan freeze / change new）。

**④ 编辑器内引用高亮**

- 可解析引用渲染为 chip/链接（`POST /login` → capability anchor；`字段 keyword_id` → models 字段；`code 1001` → errors；`键 port` → config）；
- 未解析引用红色下划线 + tooltip「目标未定义，点击去补」；
- models 实体/字段提供「被引用」反向列表，点反向边跳回引用方。

设计原则：引用图与高亮全部由投影 + findings 驱动，用户不手绘；编辑 spec 后自动重跑投影/校验刷新。

## 9. 交互流程示例

```text
1. 打开 CometFlow 首页 → 点「+ 新建项目」→ 三步向导（基本信息→项目类型问答→12-kind 预览）→ 创建（init + scaffold）
2. 进入 Goals，编辑总体目标 + 技术栈 → 点「同步」（context/goal sync）
3. 点「+ 添加目标」新增 G2 → 同步
4. 进入 Plans，选中 G2，点「生成」→ 展示草稿
5. 点「校验」→ 展示 findings（0 error 才允许下一步）
6. 点「评审」→ 展示评审结论 → 点「批准」
7. 点「冻结」→ 任务转为 frozen，进入 Changes 可执行
8. 需要改：点「重新生成 --preserve-approved」回到 draft，已批准任务保留
9. 在 Changes 新建 change → 确认验收 → 运行（看实时日志）→ 验收 → 归档
```

## 10. 前端技术选型（建议，待确认）

- 首选：**Vue 3 + Vite + TypeScript + Pinia**；SSE 用原生 EventSource；UI 组件库可选 Naive UI / Element Plus（内网离线时用最小依赖优先）。
- 备选：React + Vite（团队更熟 React 时）。
- TUI：后置，用 ink（React 终端 UI）或 readline。
- 构建：`web/` 独立 workspace，Vite 产出 `web/dist`，serve 静态托管；CLI 的 `dist` 与 web 产物分离。
- 打包注意：当前 npm `files` 仅含 dist + README，发布带 web 需要新增 web 构建产物目录与 prepublish 步骤（列入 S5）。

## 11. 分阶段实施

### S1 serve 骨架 + 应用外壳（地基）

- `cometflow serve`：token、静态托管、envelope、错误映射；
- 工作区 + 项目注册表（workspace.json）+ 首页/项目列表页 + 新建项目（init）；
- 配置服务（.cometflow/config.yaml 读写 + agent 校验）+ Agent 列表/可用性 + 设置页；
- GET 读端点（status/doctor/mission/goals/plans/changes/evolutions）+ PUT mission.md；
- JobManager + /api/jobs + /api/events（SSE）。

验收：打开首页 → 新建项目 → 进入项目 → curl 读状态 → 订阅 SSE 收到 state.changed。

### S1.5 Specs 面板

- 12-kind 状态视图 + init-manifest + scaffold 补全；
- 引用关系图（kind → 文件 → 实体/接口三级展开）；
- spec validate 跨文件引用检查面板 + 编辑器引用高亮。

验收：新建项目后看到 12-kind 清单；补全一个 deferred kind；故意写错一个跨文件引用，面板能红色定位并跳转。

### S2 Plan 向导

- generate/validate/review/approve/freeze/regenerate 端点 + 前端向导。

验收：网页完成 G1 从「生成」到「冻结」全流程。

### S3 Change 步骤条

- change 端点 + run 的 job 日志流前端。

验收：网页新建 change → run 看实时日志 → verify → archive。

### S4 Evolve + Eval 面板

验收：propose → verify（门禁日志）→ submit → approve；eval 报告可视化。

### S5 打磨与扩展

- doctor/daemon 面板、最近项目摘要增强、写操作二次确认、离线打包。

## 12. 风险与开放问题

1. **plan review 三档 verdict 未落地到命令层**：当前 `markTaskPlanReviewed` 只做 draft→validated，002/003 设计的三档（auto/high-risk/human）尚无显式 verdict 输出。S2 前需确认：是否给 review 增加 verdict 字段，UI 预留 verdict 展示位。
2. **generate 现在是确定性扫描**：未来 LLM Decomposer 接入时直接复用 job 模型，端点不变。
3. **并发写**：CLI 与 serve 同时操作同一项目会 last-write-wins；MVP 限定单写者，后续可在 serve 内加进程级文件锁。
4. **COMETFLOW.md 结构化写回**：需要按段落定位编辑，避免覆盖非目标段落（技术栈表、运行环境表）。
5. **工作区路径安全**：projectId→path 解析必须校验（只允许注册表内已登记路径），防止伪造 projectId 读写任意目录。
6. **离线/打包**：web 前端依赖与构建产物如何进入 npm 包与内网分发。
7. **认证与局域网访问**：MVP 只 127.0.0.1 + token；开放局域网前需会话/CSRF 防护。
8. **敏感配置边界**：API key / endpoint 等凭证由 agent 工具自身管理，CometFlow 配置只存 agent id 与 model 名，防止重复存储与泄露。
9. **引用图规模与刷新**：kind 只有 12 个，但 capability/flow 展开后的接口/实体级节点可能很多；MVP 逐级展开 + 只渲染当前项目，避免全量布局；spec 编辑后自动重跑投影/校验，防止展示陈旧引用。
