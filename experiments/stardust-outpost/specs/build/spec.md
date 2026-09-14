---
capability: build
module: src/build
---

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
