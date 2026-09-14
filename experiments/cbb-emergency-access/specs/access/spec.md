---
capability: access
module: src/access
---

# access capability

应急接入的申请、审批、吊销与状态查询。所有操作复用现有管理平台的登录态与 MFA。

## POST /api/emergency/access/request

发起一次应急接入申请，创建状态为 pending 的申请单。

- 模型：AccessRequest
- 错误码：E_AUTH_REQUIRED
- 错误码：E_FORBIDDEN_ROLE
- 错误码：E_SERVER_NOT_FOUND
- 错误码：E_DURATION_EXCEEDS_LIMIT
- 错误码：E_RATE_LIMITED
- 错误码：E_SOURCE_NOT_ALLOWED
- 协议头：Cookie
- 协议头：X-Request-Id
- 状态码：200
- 状态码：403
- 状态码：429

申请必须携带 server_id、reason 与 duration_minutes；reason 需包含关联工单号。

### Acceptance

- A1：requester 角色提交合法申请后返回 200，且生成 status 为 pending 的申请单，issued 与请求可经 X-Request-Id 关联
- A2：duration_minutes 超过 access.max_duration_minutes 时返回 403 与 E_DURATION_EXCEEDS_LIMIT
- A3：来源地址不在 access.allowed_source_cidrs 内时返回 403 与 E_SOURCE_NOT_ALLOWED

## POST /api/emergency/access/approve

审批申请单，通过后发放一次性授权。

- 模型：ApprovalDecision
- 模型：AccessGrant
- 错误码：E_REQUEST_NOT_FOUND
- 错误码：E_REQUEST_ALREADY_DECIDED
- 错误码：E_SELF_APPROVAL
- 协议头：Cookie
- 协议头：X-Request-Id
- 状态码：200
- 状态码：409

令牌只在审批成功的响应中返回一次，服务端只保存令牌哈希。

### Acceptance

- A4：approver 审批通过后返回 200，申请单状态变为 approved，并生成一次性授权
- A5：审批人等于申请人时返回 403 与 E_SELF_APPROVAL
- A6：对已审批的申请单再次审批时返回 409 与 E_REQUEST_ALREADY_DECIDED

## POST /api/emergency/access/revoke

强制吊销尚未结束的申请与授权。

- 模型：AccessRequest
- 错误码：E_REQUEST_NOT_FOUND
- 错误码：E_FORBIDDEN_ROLE
- 协议头：Cookie
- 协议头：X-Request-Id
- 状态码：200

吊销后对应的授权立即不可用，已建立的通道由守卫进程回收。

### Acceptance

- A7：approver 吊销后申请单状态变为 revoked，授权状态变为 revoked，且该令牌无法再建立通道

## GET /api/emergency/access/status

查询申请单与关联授权、会话的当前状态。

- 模型：AccessRequest
- 模型：AccessGrant
- 模型：AccessSession
- 错误码：E_REQUEST_NOT_FOUND
- 协议头：Cookie
- 状态码：200
- 状态码：404

仅供 requester、approver 与 auditor 读取；不返回明文令牌。

### Acceptance

- A8：查询既有申请单返回 200，包含申请、授权与会话状态，且响应中不出现明文令牌
