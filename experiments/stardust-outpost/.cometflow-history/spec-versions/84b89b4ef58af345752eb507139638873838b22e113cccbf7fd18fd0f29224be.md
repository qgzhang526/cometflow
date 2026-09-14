---
capability: engine
module: src/engine
---

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
