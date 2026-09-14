# 数据模型

唯一数据字典：实体、字段、枚举、状态机。字段/枚举/状态只在此定义，其余 spec 只引用、不重述。

## 实体：ServerTarget

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| server_id | string | 是 | 是 | 服务器唯一标识 |
| hostname | string | 是 | 否 | 主机名 |
| mgmt_endpoint | string | 是 | 否 | 管理面地址 |
| ssh_port | integer | 是 | 否 | 目标 SSH 端口，默认 22 |
| status | string | 是 | 否 | 见枚举 ServerStatus |

## 实体：AccessRequest

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| request_id | string | 是 | 是 | 申请单号 |
| server_id | string | 是 | 否 | 目标服务器 |
| requester | string | 是 | 否 | 申请人账号 |
| reason | string | 是 | 否 | 申请原因，须带工单号 |
| duration_minutes | integer | 是 | 否 | 申请的接入时长上限 |
| status | string | 是 | 否 | 见枚举 RequestStatus |
| created_at | string | 是 | 否 | 创建时间（ISO8601） |
| expires_at | string | 否 | 否 | 过期时间 |
| decided_at | string | 否 | 否 | 审批时间 |
| revoked_at | string | 否 | 否 | 吊销时间 |

## 实体：ApprovalDecision

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| request_id | string | 是 | 否 | 关联申请单 |
| approver | string | 是 | 否 | 审批人账号 |
| decision | string | 是 | 否 | 见枚举 Decision |
| comment | string | 否 | 否 | 审批意见 |
| decided_at | string | 是 | 否 | 决策时间 |

## 实体：AccessGrant

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| grant_id | string | 是 | 是 | 授权编号 |
| request_id | string | 是 | 否 | 关联申请单 |
| token_hash | string | 是 | 是 | 一次性令牌的哈希 |
| issued_at | string | 是 | 否 | 发放时间 |
| expires_at | string | 是 | 否 | 授权到期时间 |
| used | boolean | 是 | 否 | 是否已被消费 |
| status | string | 是 | 否 | 见枚举 GrantStatus |

## 实体：AccessSession

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| session_id | string | 是 | 是 | 会话编号 |
| grant_id | string | 是 | 否 | 关联授权 |
| server_id | string | 是 | 否 | 目标服务器 |
| source_ip | string | 是 | 否 | 运维终端来源地址 |
| started_at | string | 是 | 否 | 建立时间 |
| last_active_at | string | 是 | 否 | 最后活动时间 |
| ended_at | string | 否 | 否 | 结束时间 |
| end_reason | string | 否 | 否 | 见枚举 EndReason |
| status | string | 是 | 否 | 见枚举 SessionStatus |

## 实体：AuditEvent

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| event_id | string | 是 | 是 | 事件编号 |
| event_type | string | 是 | 否 | 见枚举 EventType |
| actor | string | 是 | 否 | 触发者 |
| server_id | string | 否 | 否 | 目标服务器 |
| request_id | string | 否 | 否 | 关联申请单 |
| session_id | string | 否 | 否 | 关联会话 |
| detail | string | 否 | 否 | 结构化明细，JSON 字符串 |
| occurred_at | string | 是 | 否 | 发生时间 |

## 枚举

- ServerStatus：0=online, 1=offline, 2=maintenance
- RequestStatus：0=pending, 1=approved, 2=rejected, 3=expired, 4=revoked
- Decision：0=approve, 1=reject
- GrantStatus：0=issued, 1=consumed, 2=expired, 3=revoked
- SessionStatus：0=active, 1=ended
- EndReason：0=user_closed, 1=idle_timeout, 2=ttl_expired, 3=revoked, 4=error
- ChannelState：0=down, 1=up
- EventType：0=request_created, 1=request_approved, 2=request_rejected, 3=grant_issued, 4=session_started, 5=session_ended, 6=channel_opened, 7=channel_closed, 8=audit_exported

## 状态机：AccessRequest

| 当前状态 | 事件 | 目标状态 |
|----------|------|----------|
| pending | approve | approved |
| pending | reject | rejected |
| approved | expire | expired |
| approved | revoke | revoked |

## 状态机：AccessGrant

| 当前状态 | 事件 | 目标状态 |
|----------|------|----------|
| issued | consume | consumed |
| issued | expire | expired |
| issued | revoke | revoked |

## 状态机：AccessSession

| 当前状态 | 事件 | 目标状态 |
|----------|------|----------|
| active | user_closed | ended |
| active | idle_timeout | ended |
| active | ttl_expired | ended |
| active | revoke | ended |
