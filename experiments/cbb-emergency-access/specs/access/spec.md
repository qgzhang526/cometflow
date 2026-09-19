---
capability: access
module: src/access
---

# access capability

应急接入的申请、审批、吊销与状态查询。所有操作复用现有管理平台的登录态与 MFA。

## POST /api/emergency/access/request

发起一次应急接入申请，创建状态为 pending 的申请单。

- 请求体：server_id、reason、duration_minutes
- 响应：data = AccessRequest（status 为 pending）
- 模型：AccessRequest
- 错误码：E_AUTH_REQUIRED
- 错误码：E_FORBIDDEN_ROLE
- 错误码：E_SERVER_NOT_FOUND
- 错误码：E_DURATION_EXCEEDS_LIMIT
- 错误码：E_RATE_LIMITED
- 错误码：E_SOURCE_NOT_ALLOWED
- 协议头：Cookie
- 协议头：X-Request-Id
- 协议头：X-Forwarded-For
- 状态码：200
- 状态码：401
- 状态码：403
- 状态码：429

申请必须携带 server_id、reason 与 duration_minutes；reason 需包含关联工单号。
来源地址按 协议头：X-Forwarded-For 判定，是否落在 配置：access.allowed_source_cidrs 之内。

### Acceptance

- A1：requester 角色提交合法申请后返回 200，且生成 status 为 pending 的申请单，issued 与请求可经 X-Request-Id 关联
  - check: node tests/acceptance.mjs A1
- A2：duration_minutes 超过 access.max_duration_minutes 时返回 403 与 E_DURATION_EXCEEDS_LIMIT
  - check: node tests/acceptance.mjs A2
- A3：来源地址不在 access.allowed_source_cidrs 内时返回 403 与 E_SOURCE_NOT_ALLOWED
  - check: node tests/acceptance.mjs A3

## POST /api/emergency/access/approve

审批申请单，通过后发放一次性授权。

- 请求体：request_id、decision（approve|reject）、comment
- 响应：data = { request_id, status, grant: { grant_id, token, expires_at } }；token 只在本响应出现一次
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
approve 后申请单状态为 approved 并生成 AccessGrant；reject 后申请单状态为 rejected 且不生成授权。
配置：access.require_second_approver 为 true 时需要两名不同审批人都 approve 才发放授权。

### Acceptance

- A4：approver 审批通过后返回 200，申请单状态变为 approved，并生成一次性授权
  - check: node tests/acceptance.mjs A4
- A5：审批人等于申请人时返回 403 与 E_SELF_APPROVAL
  - check: node tests/acceptance.mjs A5
- A6：对已审批的申请单再次审批时返回 409 与 E_REQUEST_ALREADY_DECIDED
  - check: node tests/acceptance.mjs A6

## POST /api/emergency/access/revoke

强制吊销尚未结束的申请与授权。

- 请求体：request_id
- 响应：data = { request_id, status: revoked, grant: { grant_id, status: revoked } }
- 模型：AccessRequest
- 错误码：E_REQUEST_NOT_FOUND
- 错误码：E_FORBIDDEN_ROLE
- 协议头：Cookie
- 协议头：X-Request-Id
- 状态码：200

吊销后对应的授权立即不可用，已建立的通道由守卫进程回收。

### Acceptance

- A7：approver 吊销后申请单状态变为 revoked，授权状态变为 revoked，且该令牌无法再建立通道
  - check: node tests/acceptance.mjs A7

## GET /api/emergency/access/status

查询申请单与关联授权、会话的当前状态。

- 查询参数：request_id
- 响应：data = { request, grant, session }；三者都可能为 null，任何情况下都不返回明文令牌与 token_hash
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
  - check: node tests/acceptance.mjs A8
