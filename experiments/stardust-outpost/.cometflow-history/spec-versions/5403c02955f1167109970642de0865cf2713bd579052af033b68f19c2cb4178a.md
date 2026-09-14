---
capability: research
module: src/research
---

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
