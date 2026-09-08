# 009 Spec 工件分类与事实所有权

状态：已批准（实施前基线）  
批准日期：2026-09-07  
关联：[002-spec-driven-kernel.md](./002-spec-driven-kernel.md)、[ADR 0001](../decisions/0001-spec-single-source.md)、[ADR 0010](../decisions/0010-spec-artifact-kind-model.md)

## 背景

NightShift 用 8 类文件组织项目 spec：`NIGHTSHIFT.md`、`models.md`、`api-*.md`、`flow-*.md`、`constraints.md`、`permissions.md`、`rules.md`、`pages.md`，另有游离的 `communicate-protocol.md` 与陪测 `mock-platform.md`。这套分类正交性尚可，但存在三类结构性问题：

1. **同一事实多处重复**：字段 / 枚举 / 状态值同时出现在 `models.md`（存储列）、`api-*.md`（请求/响应 struct）、`rules.md`（下发 config），靠 agent 自觉保持一致。
2. **rules.md 职责过载**：同时承载「外部策略 DSL 语义」「内部后台进程」「指令类型表」三种语义，其中进程部分与 `flow-*.md` 直接重叠。
3. **第一等概念缺位**：传输协议、全局错误码、运行时配置、状态机、枚举字典没有显式 artifact。

## 目标

把 NightShift 的「按文件类型」分类，重排为「按事实所有权」分类，作为 CometFlow spec kind 的实施基线。

## 原则

1. **每个事实只有一个 owner**，其余文件只引用、不重述。
2. **kind 由 canonical 路径/文件名唯一确定**，不依赖人工标注，避免误标。
3. **引用方向单向**：行为层（flow / process / capability）指向数据与契约层（models / errors / protocol / config），永不反向。

## Kind 总表

| kind | 单一职责 | canonical 位置 | NightShift 对应 |
|---|---|---|---|
| `project` | 使命、技术栈、运行环境、项目结构、模块归属、当前目标 | `COMETFLOW.md`（仓库根，唯一实例） | `NIGHTSHIFT.md` |
| `models` | **唯一数据字典**：实体、字段、枚举（对照表）、状态机 | `specs/models.md` | `models.md` |
| `protocol` | 传输契约：HTTPS/gzip、请求头、响应包络、状态码总表 | `specs/protocol.md` | `communicate-protocol.md` |
| `errors` | 全局错误码目录（含跨接口错误码与语义） | `specs/errors.md` | 散落各 api-*.md（新增） |
| `config` | 运行时配置契约（键、类型、默认值、必填） | `specs/config.md` | 散落 prose（新增） |
| `capability` | 接口契约：路径 / 方法 / 认证 / 请求响应 / 错误码 | `specs/<capability>/spec.md`（多个） | `api-<module>.md` |
| `flow` | 一次性场景：前置 / 步骤 / 分叉 / 轮询 / 后置 | `specs/flows/<name>.md`（多个） | `flow-<name>.md` |
| `process` | 常驻/后台进程：触发 / 输入 / 处理 / 输出 / 异常 | `specs/processes.md` | `rules.md` 内进程部分（拆出） |
| `rules` | 领域不变量与外部 DSL 语义 | `specs/rules.md` | `rules.md`（收窄） |
| `constraints` | 非功能约束：安全/性能/数据/高可用/部署/离线 | `specs/constraints.md` | `constraints.md` |
| `permissions` | 认证与鉴权：角色×API 矩阵 / 机机认证 | `specs/permissions.md` | `permissions.md` |
| `pages` | 前端页面/交互规格（纯前端项目选填） | `specs/pages.md` | `pages.md` |

## 事实所有权与引用方向

引用永远从行为层指向数据/契约层，数据层之间不互相重述字段：

| 引用方 | 可引用 | 说明 |
|---|---|---|
| `capability` | `models`、`errors`、`protocol` | 请求/响应体按字段名引用 models；错误码引用 errors；请求头/状态码引用 protocol |
| `flow` | `capability`、`models`、`config` | 步骤引用 API 路径；后置条件引用实体与配置 |
| `process` | `capability`、`models`、`config` | 输入/输出引用配置键与实体 |
| `rules` | `models` | DSL 对象引用 models 中的实体，不重述字段 |
| `permissions` | `capability` | 权限矩阵按 API 路径引用 |
| `constraints` | （不引用） | 独立 NFR；与 `project` 技术栈关联 |
| `project` | `capability`（经 scope） | `## 任务目标` 的 `范围：<capability>` 指向 capability kind |

反例（禁止）：在 `capability` 里重新定义 `KeywordRule` 的字段表；在 `rules` 里把注册/心跳流程写成伪代码步骤（应归 `flow` 或 `process`）。

## 各 kind 结构要点

### models（唯一数据字典）

- 实体以 `## 实体：<Name>` 为 anchor，字段表列：`字段 | 类型 | 必填 | 唯一 | 说明`。
- 枚举以实体内或全局 `## 枚举` 定义，格式 `0=值A, 1=值B`；**只此一处**，其余文件引用枚举名。
- 状态机以 `## 状态机：<Entity>` 定义 `状态 → [事件] → 状态` 迁移表；不再靠 flow 分支间接表达。
- 反例：在 `capability` 请求体里内联 Go struct 重新声明字段。

### capability（接口契约）

- 每个接口标题 `## METHOD /path` 是 anchor（现状已支持）。
- 请求/响应体只写字段名与约束，字段的权威定义在 models；需要新字段时先回 models 补。
- 错误码写 `code` 并引用 errors，不重复写语义。

### flow（一次性场景）

- 保持三段式（前置 / 步骤 / 后置）+ 分叉 + 轮询。
- 步骤里的「调用 `METHOD /path`（参考 xxx）」改为可解析引用；`spec validate` 校验路径在 capability 中存在。
- 步骤间数据传递写「从步骤 N 取得 `field`」，字段可回溯到 capability 响应体 → models。

### process（常驻进程）

- 每个进程一个 `## 进程：<Name>`：触发条件 / 输入 / 处理逻辑 / 输出 / 异常处理 / 引用 API。
- 与 flow 的边界：**flow 是一次性场景，process 是常驻循环**。注册认证循环若写成 step 序列则归 flow；若写成 goroutine 常驻循环则归 process，二选一、不重复。

### rules（收窄后的领域规则）

- 只保留：外部 DSL 字段/操作语义（`add/del/reset`）、匹配/判定语义等**领域不变量**。
- 不含进程、不含指令类型表（指令对象归 models 或 capability）。

### protocol / errors / config（新增的第一等契约）

- `protocol`：传输方式（仅 HTTPS）、压缩（gzip）、请求头格式（User-Agent/Cookie/Content-Encoding）、响应包络（`{type,message}`）、状态码总表（含 `900` 类业务码）。
- `errors`：全局错误码 → 语义 → 触发接口；小项目可并入 protocol，大项目独立。
- `config`：运行时配置键 → 类型 → 默认值 → 必填 → 敏感标记；`process`/`rules`/`constraints` 引用键名而非重述。

## 非 kind 排除项

- `mock-platform`：测试夹具，属于 `capability` 的 test_scope / fixtures，不作 spec kind。
- `report`：产出物，走 `reports/`，不作 spec kind。
- `CLAUDE.md` / agent 配置：运行约定，非项目 spec。

## 与 002 的关系

002 已列出 `specs/models.md`、`constraints.md`、`permissions.md`、`rules.md`、`specs/<capability>/spec.md`、`specs/flows/<flow>.md`。本文在 002 基础上：

- 新增 `protocol` / `errors` / `config` / `process` / `pages` 五种 kind；
- 明确每个 kind 的单一职责与引用规则；
- 将 `rules` 收窄为领域不变量，进程拆出为 `process`。

002 的 ②领域层 文件列表以本文为准。

## 实施要点

1. `spec-index.ts`：由「递归扫描所有 .md」改为按 canonical 路径判定 kind，返回带 kind 的索引。
2. `spec-parse.ts`：按 kind 分支解析——capability（接口标题 + Acceptance）、flow（前置/步骤/分叉/轮询/后置 + API 引用）、models（实体/字段/枚举/状态机）、其余 kind 各自结构。
3. 投影文件：`.cometflow/spec-index/{models,apis,flows,errors,config}.yaml`（机器生成，不手工编辑）。
4. `spec-validate.ts`：按 kind 校验，并新增跨文件引用校验（flow→api 路径、api→models 字段、api→errors 错误码、process→config 键）。
5. 回归：`experiments/regression-fixture` 增加含 models/api/flow 交叉引用的 fixture 与断言。

## 落地顺序

1. kind 判定 + spec-index 改造
2. models / flow 结构解析 + 投影
3. 跨文件引用校验
4. protocol / errors / config / process 解析补全
