# 010 Init 脚手架：按项目类型裁剪 spec kind

状态：已批准（实施前基线）  
批准日期：2026-09-07  
关联：[009-spec-artifact-taxonomy.md](./009-spec-artifact-taxonomy.md)、[005-cli-and-workflow.md](./005-cli-and-workflow.md)、[ADR 0011](../decisions/0011-init-kind-scaffolding.md)

## 背景

当前 `cometflow init`（`app/commands/init.ts`）只生成 `COMETFLOW.md` 模板、空的 `specs/`、`.cometflow/{config.yaml,goals,plans}` 和 `.gitignore`，**不生成任何 spec kind 文件**。009 引入 12 个 kind 后，需要一个明确回答：人类起步时要手写哪些 spec 文件。

结论：**不是 12 个都写**。init 根据项目类型只生成真正需要的 kind，其余留空并由机器记录「本项目不需要」的结论。

## 目标

1. 让人类起步时只面对最小必要的 spec 意图，其余由 agent 出 `[DRAFT]` 或按需后补。
2. kind 是否需要由 `COMETFLOW.md` 的 `## 技术栈` 表 + 少量交互问题共同确定，而不是人类自己判断。
3. 生成结果可复现、幂等、不覆盖人类已有修改。

## 原则

1. **COMETFLOW.md 仍是唯一事实源**：能从 `## 技术栈` 推断的 kind，绝不再问一遍。
2. **init 只生成、不覆盖**：目标文件已存在即跳过；`scaffold` 补缺时同样不覆盖。
3. **「不需要」也要留痕**：写入 `.cometflow/init-manifest.yaml`，让 `spec validate` 区分「有意缺席」与「遗漏」。

## 探测模型

### 第一层：从 `## 技术栈` 推断（零交互）

| 条件（来自 project-context） | 生成的 kind |
|---|---|
| `frontend` ≠ `无` | `pages` |
| `database` ≠ `无` | `models` |
| 技术栈已填写（任意一维非占位） | `constraints`（默认给安全/性能骨架） |

`constraints` 是非功能约束（安全/性能/数据/高可用/部署/离线依赖），对纯前端、CLI 同样适用，因此不依赖「有没有后端」；仅当技术栈整体未知（占位或未填）时标 `deferred`。

### 第二层：交互问题（仅 `--interactive` 或推断不了时）

| # | 问题 | 生成 kind |
|---|---|---|
| Q1 | 是否有对外网络接口，或需调用外部 HTTP/网络接口？ | `protocol` |
| Q2 | 是否有运行时配置键（端口/密钥/连接串）？ | `config` |
| Q3 | 是否有跨接口/跨模块的业务场景？ | `flow`（创建 `specs/flows/` 目录） |
| Q4 | 是否有常驻后台进程或定时循环？ | `process`（`specs/processes.md`） |
| Q5 | 是否有领域规则/业务不变量（策略、匹配判定、外部 DSL 语义）？ | `rules` |
| Q6 | 鉴权方式？(无需/机机/角色矩阵) | `permissions` |
| Q7 | 是否需要独立的错误码目录（跨接口错误码较多时选是）？ | `errors`（否则并入 `protocol` 的「错误码」表） |

### 非交互默认

`cometflow init [path]`（不带 `--interactive`）使用保守默认：

- 只生成 `project` +（有 DB 时的）`models` +（技术栈已知时的）`constraints`；
- 其余 kind 标记为 `deferred`（待定），`spec validate` 对其只告警、不报错；
- 人类之后可 `cometflow spec scaffold --interactive` 补。

## 脚手架产物示例

纯后端服务（前端=无、数据库=PostgreSQL、有网络/配置/鉴权）init 后：

    project/
    ├─ COMETFLOW.md              # project（必填）
    ├─ specs/
    │  ├─ models.md              # 数据库≠无 → 生成
    │  ├─ protocol.md            # Q1=是 → 生成
    │  ├─ config.md              # Q2=是 → 生成
    │  ├─ constraints.md         # 技术栈已知 → 生成
    │  ├─ permissions.md         # Q6=机机 → 生成
    │  ├─ errors.md              # Q7=否 → 并入 protocol 的「错误码」表，不单独生成
    │  └─ flows/                 # Q3=否 → 目录留空（或按需后补）
    ├─ .cometflow/
    │  ├─ config.yaml
    │  ├─ init-manifest.yaml     # 记录每个 kind 的 present/deferred/absent
    │  ├─ goals/
    │  └─ plans/

## init-manifest 投影

`.cometflow/init-manifest.yaml`（机器生成，不手工编辑）：

    schema: cometflow.init-manifest.v1
    kinds:
      project:    { present: true,  reason: always }
      models:     { present: true,  reason: "database != none" }
      protocol:   { present: true,  reason: "network: yes" }
      config:     { present: true,  reason: "runtime config: yes" }
      constraints:{ present: true,  reason: "non-functional constraints apply to all projects" }
      permissions:{ present: true,  reason: "auth: machine" }
      rules:      { present: false, reason: "no domain dsl" }
      process:    { present: false, reason: "no background loop" }
      pages:      { present: false, reason: "frontend == none" }
      errors:     { present: false, reason: "merged into the 错误码 table of specs/protocol.md" }
      flow:       { present: false, reason: "no cross-api scenario" }
      capability: { present: false, reason: "derived from goals, not init" }

`spec validate` / `doctor` 读此文件：`present: false` 的 kind 缺席不报错，`present: true` 但文件缺失才报错。

## kind 模板清单

每个 kind 的脚手架骨架（最小结构，人类只填语义）：

| kind | 生成文件的骨架 |
|---|---|
| `project` | 现有 `COMETFLOW_TEMPLATE`（保持不变） |
| `models` | `# 数据模型` + `## 实体：<Name>` 字段表 + `## 枚举` + `## 状态机`（占位注释） |
| `protocol` | `# 通信协议` + 传输方式/压缩/请求头/响应包络/状态码总表 |
| `errors` | `# 错误码目录` + `| code | 语义 | 触发接口 |` |
| `config` | `# 运行时配置` + `| 键 | 类型 | 默认值 | 必填 | 敏感 |` |
| `constraints` | `# 非功能约束` + 安全/性能/数据/高可用/部署/离线 六节 |
| `permissions` | `# 认证与鉴权` + 机机认证或角色×API 矩阵（按 Q6 二选一） |
| `rules` | `# 领域规则` + DSL 字段/操作语义/判定语义 |
| `process` | `# 后台进程` + `## 进程：<Name>`（触发/输入/处理/输出/异常） |
| `pages` | `# 前端页面` + 页面/交互/路由（无前端则不生成） |
| `flow` | 目录 `specs/flows/` + 可选模板（前置/步骤/后置） |
| `capability` | **init 不生成内容**；由 `plan generate` 的 spec-authoring 任务起草，或 `spec scaffold --capability <name>` 建骨架后由人类誊写（工标/固定接口规范场景直接照抄） |

> 表里所有骨架（`capability` 与各 root kind）落盘时 front-matter 都带 `status: draft`：
> 机器产的是占位内容（`<Name>` / `EXAMPLE` 这类），在被人工确认（`cometflow spec approve <spec-file>`）
> 之前不算契约，不能参与 `plan freeze`；`spec verify` 会以 `spec-is-draft` warning 让它保持可见。

## CLI 形态

    cometflow init [path]                    # 非交互：推断 + 保守默认，记录 deferred
    cometflow init [path] --interactive      # 交互：推断 + 逐项问答
    cometflow spec scaffold [--interactive]  # 增量补 kind（不覆盖已有文件）
    cometflow spec scaffold --list           # 列出当前各 kind 状态
    cometflow spec scaffold --capability <n> # 建 specs/<n>/spec.md 骨架（可重复）

## 与现有 init 的差异

改造 `app/commands/init.ts`：

1. 保留：`COMETFLOW.md` 模板、`.cometflow/config.yaml`、`.gitignore`、目录创建、已存在即报错。
2. 新增：读/推断 kind 需要性 → 写 `init-manifest.yaml` → 生成需要的 kind 骨架。
3. 新增模块 `domains/project/scaffold.ts`：`detectKindNeeds(ctx, answers)` + `scaffoldKinds(root, needs)` + 模板注册表。

## 与 spec validate / plan generate 的联动

- `spec validate`：按 `init-manifest.yaml` 区分 `present:false`（跳过）与 `present:true` 但缺失/无结构（报错）。
- `plan generate`：仍按目标 scope 生成 spec-authoring 任务补 capability spec；**与 init 的 root-kind 脚手架互补，不重复**。
- `spec scaffold`：补 deferred 的 kind，补完后把 manifest 对应项置 `present: true`。

## 幂等与增量

- `init` 在 `COMETFLOW.md` 已存在时失败（保持现状）。
- `scaffold` 对所有目标文件「存在即跳过」，绝不覆盖人类已写内容。
- 重跑 `scaffold` 只生成缺失文件并更新 manifest，结果稳定。

## 落地顺序

1. `domains/project/scaffold.ts`：kind 需要性判定 + 模板注册表 + 幂等写入。
2. `init-manifest.yaml` 读写 + `spec validate` 接入（区分 present/deferred/absent）。
3. CLI：`init --interactive`、`spec scaffold` 子命令。
4. 回归：`experiments/regression-fixture` 增加 init 裁剪场景（前端=无 → 无 pages；数据库=无 → 无 models；补 scaffold 后 manifest 更新）。

## 验收

- 交互与非交互 init 各生成一份符合预期的 kind 集合。
- 重跑 scaffold 不覆盖、结果幂等。
- `spec validate` 对 `present:false` 的缺席 kind 不报错，对 `present:true` 的缺失报错。
