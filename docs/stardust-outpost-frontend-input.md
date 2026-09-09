# 星尘前哨 · 前端手动输入手册

> 用途：通过 cometflow Web 前端的「新建项目」功能手动搭建「星尘前哨 Stardust Outpost」游戏骨架，验证前端功能。
> 本文档所有内容均可直接复制粘贴。项目启动命令：

```bash
cd D:\zqg\github\cometflow
node dist/app/cli/index.js serve --port 4321 --web-dir web
# 浏览器打开 http://127.0.0.1:4321 ，首页粘贴服务端打印的 token
```

---

## 第一步：新建项目向导

**① 基本信息**

| 字段 | 填写 |
|---|---|
| 项目名称 | 星尘前哨 Stardust Outpost |
| 本地路径 | `D:\zqg\github\cometflow\experiments\stardust-outpost-web`（新目录） |
| 前端 | `TypeScript 引擎 + CometFlow Web 面板` |
| 后端 | `Node.js + CometFlow serve` |
| 数据库 | `无（纯内存 + YAML 存档）` |

**② 项目类型问答（勾选）**

- 对外网络接口/协议 → ☑
- 运行时配置键 → ☑
- 跨接口业务场景 → ☑
- 常驻后台进程 → ☑
- 领域 DSL / 业务不变量 → ☑
- 错误码 > 20 个 → ☑
- 鉴权方式 → **无需**

**③ 预览预期**：`models/pages/constraints/protocol/config/flow/process/rules/errors` 为 present；`capability`、`permissions` 为 absent（平台规则：capability 由目标派生、auth=none 无 RBAC，属正常）。

---

## 第二步：Goals 面板粘贴 COMETFLOW.md

进入 Goals 面板，把 mission 编辑框整体替换为：

```markdown
# 项目使命

用 CometFlow 自身（spec 驱动 + 自动拆解 + 真实 Agent + eval 门禁 + evolve 进化）开发一款「放置经营」类太空殖民地小游戏 **星尘前哨 Stardust Outpost**，并把游戏作为 cometflow Web 前端（serve + 面板 UI）的功能验证靶子：每一个游戏操作驱动一个前端面板，每一类游戏实体对应一个 spec kind。

## 技术栈

| 维度 | 值 |
|------|-----|
| 前端 | TypeScript 引擎 + CometFlow Web 面板 |
| 后端 | Node.js + CometFlow serve |
| 数据库 | 无（纯内存 + YAML 存档） |
| 缓存 | 无（纯内存） |
| 测试框架 | vitest |
| 构建工具 | tsc |

## 运行环境

| 维度 | 值 |
|------|-----|
| 操作系统 | Windows / Linux |
| 部署方式 | 单机 + cometflow serve |
| 语言版本 | Node.js ≥ 22 |

## 任务目标

### G1：游戏引擎与数据模型
- 目标：以纯 TypeScript 实现资源、建筑、生产 tick 与殖民地状态的核心引擎
- 范围：engine, models
- 成功标准：
  - 资源库存、建筑状态机、生产 tick 的确定性单测通过
  - 随机源可注入，固定种子可复现
  - 引擎不依赖渲染与输入，可被 serve 与测试直接调用
- 非目标：
  - 不做图形界面（前端由 cometflow Web 面板承担）
  - 不做 AI 决策

### G2：建造工作流
- 目标：将「下达建造 → 施工 → 验收 → 投产」接入 change 工作流，施工为异步 job
- 范围：build
- 成功标准：
  - 建造任务经 change run→verify→archive 完整流转，verify-fail 可回退
  - 施工进度经 SSE 实时推送，job 日志可轮询
  - 投产前校验能量/上限等规则，不满足即失败
- 非目标：
  - 不做建筑拆除（见后续 G）
  - 不做多人协作

### G3：目标与计划拆解
- 目标：殖民地阶段目标可自动拆解为建造/生产计划并冻结
- 范围：goals, plan
- 成功标准：
  - plan generate 将目标拆为任务并覆盖全部 spec_ref，validate 无 missing-coverage
  - plan approve/freeze 后任务不可漂移
  - 目标与计划在前端 Goals/Plans 面板可完整操作
- 非目标：
  - 不做 LLM 智能拆解（先用确定性拆解）
  - 不做计划回滚

### G4：科技树与进化
- 目标：科研点驱动科技研究，经 evolve 提案→门禁→批准解锁新建筑/新资源
- 范围：research, evolve
- 成功标准：
  - 科技提案经 evolve verify 门禁（typecheck/test/eval）后 approve
  - 解锁后新建筑/资源在引擎中可用
  - 未批准提案不产生解锁效果
- 非目标：
  - 不做科技回退
  - 不做在线多人科技共享

### G5：自动化评估与平衡
- 目标：以 eval.yaml 断言产量曲线与资源平衡，产出可复现的平衡性评估
- 范围：eval
- 成功标准：
  - 采样 N 局断言产量/库存上限/解锁节奏全部通过
  - rubric 对平衡性给出可复现评分
  - 评估结果经 job 返回并在 Eval 面板展示
- 非目标：
  - 不做真实 LLM judge（先用 mock/断言）
  - 不做在线排行榜
```

保存后点 **「同步 (context + goal)」**，目标列表应出现 G1~G5。

---

## 第三步：Specs 面板粘贴 8 个根 kind 文件

新建项目后 scaffold 已生成这些模板文件。在 Specs 面板的 **「Spec 文件」** 页签，逐个点开 → 清空 → 粘贴 → 保存。

### specs/models.md

```markdown
# 数据模型

唯一数据字典：实体、字段、枚举（对照表）、状态机。字段/枚举/状态只在此定义，其余 spec 文件只引用、不重述。

## 实体：Colony

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | string | 是 | 是 | 殖民地主键 |
| name | string | 是 | 否 | 殖民地名称 |
| tick | integer | 是 | 否 | 已推进的生产 tick 数 |
| createdAt | string | 是 | 否 | 创建时间戳 |

## 实体：Resource

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| code | string | 是 | 是 | 资源编码（energy/ore/parts） |
| amount | integer | 是 | 否 | 当前库存 |
| capacity | integer | 是 | 否 | 库存上限 |

## 实体：Building

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | string | 是 | 是 | 建筑实例主键 |
| kind | string | 是 | 否 | 建筑类型（power/mine/factory） |
| level | integer | 是 | 否 | 建筑等级 |
| status | string | 是 | 否 | 建筑状态（见状态机） |
| startedAt | string | 否 | 否 | 施工/升级开始时间 |
| finishedAt | string | 否 | 否 | 施工/升级完成时间 |

## 实体：ProductionTask

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | string | 是 | 是 | 任务主键 |
| type | string | 是 | 否 | 任务类型（build/research/upgrade） |
| target | string | 是 | 否 | 目标建筑/科技 id |
| status | string | 是 | 否 | 任务状态（见状态机） |
| progress | integer | 是 | 否 | 进度 0-100 |
| startedAt | string | 是 | 否 | 开始时间 |

## 枚举

- 0=planned, 1=constructing, 2=running, 3=upgrading, 4=stopped（建筑状态）
- 0=queued, 1=running, 2=done, 3=failed（任务状态）

## 状态机：Building

| 当前状态 | 事件 | 目标状态 |
|----------|------|----------|
| planned | start_construction | constructing |
| constructing | complete_construction | running |
| running | start_upgrade | upgrading |
| upgrading | complete_upgrade | running |
| running | stop | stopped |
| stopped | start | running |
```

### specs/config.md

```markdown
# 运行时配置

运行时配置契约：键 → 类型 → 默认值 → 必填 → 敏感。平衡参数集中于此，改动即热更新。

## 配置项

| 键 | 类型 | 默认值 | 必填 | 敏感 | 说明 |
|----|------|--------|------|------|------|
| tick.intervalMs | integer | 1000 | 否 | 否 | 生产 tick 间隔（毫秒） |
| energy.initial | integer | 100 | 否 | 否 | 初始能量 |
| energy.buildCost | integer | 50 | 否 | 否 | 建造基础能量成本 |
| energy.upgradeCost | integer | 80 | 否 | 否 | 升级基础能量成本 |
| mine.outputPerTick | integer | 2 | 否 | 否 | 采矿站每 tick 矿石产量 |
| power.outputPerTick | integer | 3 | 否 | 否 | 发电站每 tick 能量产量 |
| factory.inputPerTick | integer | 1 | 否 | 否 | 工厂每 tick 矿石消耗 |
| factory.outputPerTick | integer | 1 | 否 | 否 | 工厂每 tick 零件产量 |
| build.maxCount | integer | 10 | 否 | 否 | 建筑数量上限 |
```

### specs/errors.md

```markdown
# 错误码目录

全局错误码：code → 语义 → 触发接口。

## 错误码

| code | 语义 | 触发接口 |
|------|------|----------|
| E_BUILD_NO_ENERGY | 能量不足，无法建造 | POST /buildings |
| E_BUILD_CAP_REACHED | 建筑数量已达上限 | POST /buildings |
| E_TASK_CONFLICT | 同一目标已有进行中的任务 | POST /buildings |
| E_BUILDING_UNKNOWN | 未知建筑实例 | POST /buildings |
| E_RES_UNKNOWN | 未知资源编码 | GET /state |
```

### specs/rules.md

```markdown
# 领域规则

领域不变量；不描述常驻进程（进程归 processes.md），不重述字段（字段归 models.md）。

## 规则：建造能量前提

- 语义：任何建造/升级在投产前必须满足能量成本校验，否则任务失败
- 模型：Building
- 错误码：E_BUILD_NO_ENERGY

## 规则：建筑数量上限

- 语义：殖民地建筑总数不得超过 build.maxCount
- 模型：Building
- 配置键：build.maxCount
- 错误码：E_BUILD_CAP_REACHED

## 规则：单目标单任务

- 语义：同一建筑/科技同一时刻至多一个进行中的任务
- 模型：ProductionTask
- 错误码：E_TASK_CONFLICT
```

### specs/processes.md

```markdown
# 后台进程

常驻后台进程：production-tick 是游戏的心脏，每 tick 结算产量/消耗/库存。

## 进程：production-tick

- 触发条件：服务启动后按 tick.intervalMs 周期触发
- 输入：当前殖民地状态（Colony、Resource、Building）
- 处理逻辑：对每个 running 建筑按类型结算产量与消耗，更新 Resource.amount，Colony.tick += 1
- 输出：更新后的资源库存与 tick 计数
- 异常处理：库存/上限越界时回滚本次 tick 并记录
- 配置键：tick.intervalMs
- 模型：Colony
- 模型：Resource
- 模型：Building
```

### specs/protocol.md

```markdown
# 通信协议

传输契约：serve 与前端、引擎与存档之间的协议约定。

## 传输方式

- REST + SSE（cometflow serve）

## 请求头

| 头 | 类型 | 必填 | 说明 |
|----|------|------|------|
| Authorization | string | 否 | Bearer token（本地 serve 可选） |

## 状态码总表

| 状态码 | 含义 | 说明 |
|--------|------|------|
| 200 | OK | 成功 |
| 202 | Accepted | 已提交异步 job |
| 400 | Bad Request | 参数错误 |
| 404 | Not Found | 资源不存在 |
```

### specs/constraints.md

```markdown
# 非功能约束

技术栈之外的非功能需求。

## 安全约束

- 本地单机，无外部输入信任边界

## 性能约束

| 指标 | 目标值 |
|------|--------|
| 单 tick 结算 | < 5ms |
| SSE 推送延迟 | < 500ms |

## 数据约束

- 存档 YAML 可读、可重建；损坏时回退默认状态

## 部署约束

- Node.js ≥ 22，单进程 serve
```

### specs/pages.md

```markdown
# 前端页面

前端由 cometflow Web 面板承担；游戏本身不另做画布。

## 页面：殖民地总览

- 路由：/#/project/{id}/overview
- 交互：展示资源库存、建筑列表、tick 计数
- 状态：经 SSE 实时刷新

## 页面：建造面板

- 路由：/#/project/{id}/changes
- 交互：下达建造 → run → verify → archive
- 状态：job 进度 + 日志
```

---

## 第四步：新建 capability / flow 文件

Specs 面板 → **「Spec 文件」** 页签 → 输入路径 → **「+ 新建文件」** → 弹出编辑框粘贴 → 保存。
kind 由路径自动推断（`specs/<name>/spec.md` = capability，`specs/flows/<name>.md` = flow）。

### 新建 `specs/engine/spec.md`

```markdown
# engine capability

游戏引擎核心：殖民地状态、资源库存、生产 tick。引擎是纯函数集合，被 serve 与测试直接调用。

## GET /state

读取当前殖民地状态（资源库存、建筑列表、tick 计数）。

### 请求

无请求体。

### 响应

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 殖民地主键 |
| tick | integer | 是 | 当前 tick |

- 模型：Colony

## POST /tick

手动推进一次生产 tick（用于测试与演示）。

### 请求

无请求体。

### 响应

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | 结算结果资源编码 |
| amount | integer | 是 | 结算后库存 |

- 模型：Resource

## 验收

- A001：GET /state 返回的库存与建筑列表与引擎内部状态一致
- A002：POST /tick 每次推进只结算一次，结果可复现
- A003：库存越界时结算被拒绝且状态不改变
```

### 新建 `specs/build/spec.md`

```markdown
# build capability

建造能力：下达建造、施工、投产。

## POST /buildings

下达建造指令，创建施工任务。

### 请求

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| kind | string | 是 | 建筑类型 |
| level | integer | 是 | 目标等级 |

- 模型：Building

### 响应

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 新建筑实例主键 |
| status | string | 是 | 初始状态 |

- 模型：Building

## 验收

- A010：kind 合法时创建 Building 并返回其 id 与初始状态
- A011：能量不足时返回 E_BUILD_NO_ENERGY 且不创建建筑
- A012：建筑数量达上限时返回 E_BUILD_CAP_REACHED 且不创建建筑
- A013：施工完成前 Building.status 保持 constructing

- 错误码：E_BUILD_NO_ENERGY
- 错误码：E_BUILD_CAP_REACHED
```

### 新建 `specs/research/spec.md`

```markdown
# research capability

科技研究能力：投入科研点解锁科技。

## POST /research

发起科技研究，创建研究任务。

### 请求

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| target | string | 是 | 目标科技 id |

- 模型：ProductionTask

### 响应

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 研究任务主键 |
| status | string | 是 | 任务初始状态 |

- 模型：ProductionTask

## 验收

- A020：科研点足够时创建研究任务并返回其 id
- A021：科研点不足时任务进入 failed 状态
- A022：研究完成后目标科技解锁，未批准提案不解锁
```

### 新建 `specs/flows/build-facility.md`

```markdown
# 建造设施流程

一次性场景：从下达建造到设施投产的端到端流程。

## 前置条件

- 殖民地已初始化
- 能量库存 ≥ energy.buildCost
- 模型：Building

## 步骤

### 步骤1 创建建造任务

- 调用 POST /buildings
- 模型：Building

### 步骤2 施工

- 调用 GET /state 轮询施工进度
- 模型：ProductionTask

### 步骤3 投产

- 施工完成，Building.status 转为 running，纳入 production-tick 结算
- 模型：Building

## 后置条件

- 新增建筑状态为 running
- 能量库存已扣除建造成本
```

### 新建 `specs/flows/research-tech.md`

```markdown
# 科技研究流程

一次性场景：科研点投入科技研究直到解锁。

## 前置条件

- 实验室已运行
- 科研点 ≥ 该科技成本
- 模型：Building

## 步骤

### 步骤1 发起研究

- 调用 POST /research
- 模型：ProductionTask

### 步骤2 等待完成

- 调用 GET /state 轮询研究进度
- 模型：ProductionTask

### 步骤3 解锁

- 研究完成，解锁对应建筑/资源类型
- 模型：Building

## 后置条件

- 新科技状态为解锁
- 科研点已扣除
```

---

## 验证路径

1. Goals 面板点 **「同步 (context + goal)」** → 目标列表出现 G1~G5（含 scope）
2. Specs 面板点 **「校验引用」** → 应显示 **0 error**（`entities: 4 · errors: 5 · config keys: 9 · flows: 2`）
3. Plans 面板选 **G1 → 生成 → 校验 → 批准 → 冻结**
4. 反向验证：把 `specs/rules.md` 的 `模型：Building` 改成 `模型：Nope` 再校验 → 看红色 `unresolved-model-reference` 定位
