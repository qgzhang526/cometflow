# 0010 Spec 工件分类（kind 模型）

状态：已批准  
日期：2026-09-07  
关联：[009-spec-artifact-taxonomy.md](../design/009-spec-artifact-taxonomy.md)、[ADR 0001](./0001-spec-single-source.md)

## 背景

NightShift 的 spec 分为 8 类文件（NIGHTSHIFT / models / api-* / flow-* / constraints / permissions / rules / pages）。分类正交性尚可，但存在三类结构性问题：

1. 字段、枚举、状态值在 models / api-* / rules 三处重复声明，靠 agent 自觉一致；
2. `rules.md` 同时承载领域 DSL 语义、后台进程伪代码、指令类型表，职责过载，且进程部分与 flow-*.md 重叠；
3. 传输协议、全局错误码、运行时配置、状态机、枚举字典等第一等概念没有显式 artifact。

CometFlow 需要一个可机器校验的 spec 分类，作为 `spec parse` / `spec validate` 与跨文件引用校验的实施基线。

## 决策

1. 引入 **kind 模型**，kind 由 canonical 路径/文件名唯一确定，不依赖人工标注。
2. **project kind 的唯一实例是仓库根 `COMETFLOW.md`**；不存在 `project.md` 文件（`project` 是分类名，`COMETFLOW.md` 是 canonical 文件名）。
3. 字段、枚举、状态机的唯一 owner 是 `models`；`capability` / `flow` / `process` / `rules` 只引用、不重述。
4. 从 `rules` 拆出 `process`（常驻进程）；新增 `protocol`、`errors`、`config`；`pages` 为纯前端项目选填 kind。
5. `mock-platform` 与 `report` 不是 spec kind（分别归测试夹具与产出物）。
6. `spec validate` 按 kind 分支校验，并增加跨文件引用校验（flow→api、api→models、api→errors、process→config）。

kind 全集（12 个）：

| kind | canonical 位置 |
|---|---|
| project | `COMETFLOW.md` |
| models | `specs/models.md` |
| protocol | `specs/protocol.md` |
| errors | `specs/errors.md` |
| config | `specs/config.md` |
| constraints | `specs/constraints.md` |
| permissions | `specs/permissions.md` |
| rules | `specs/rules.md` |
| process | `specs/processes.md` |
| pages | `specs/pages.md` |
| capability | `specs/<capability>/spec.md` |
| flow | `specs/flows/<name>.md` |

## 理由

- 消除多事实源漂移，把 NightShift 靠 agent 自觉的一致性升级为机器强制。
- 每个 kind 单一职责，便于按 kind 写解析器与校验器，避免「所有 .md 都要求 anchor + Acceptance」的现状（models/flows 并不适用该模子）。
- 为 UI 可视化（spec 关系图）提供稳定 schema。

## 后果

正面：

- spec 之间形成单向引用图，可机器校验；漂移在 `spec validate` 阶段即暴露。
- 数据字典收敛到 models，接口/流程/规则引用同一字段源。

负面：

- 解析与校验复杂度上升，需按 12 个 kind 实现分支。
- 存量 spec 需按 kind 迁移（`rules` 拆进程、`api` 去内联字段、`communicate-protocol` 提级为 `protocol`）。
