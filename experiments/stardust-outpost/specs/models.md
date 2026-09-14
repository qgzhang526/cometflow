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
