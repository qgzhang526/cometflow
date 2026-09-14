---
capability: tunnel
module: src/tunnel
---

# tunnel capability

在授权有效期内建立与回收到目标服务器 SSH 的临时通道。

## POST /api/emergency/tunnel/open

消费一次性令牌，建立到目标服务器的临时通道。

- 模型：AccessGrant
- 模型：AccessSession
- 错误码：E_GRANT_NOT_FOUND
- 错误码：E_GRANT_EXPIRED
- 错误码：E_GRANT_ALREADY_USED
- 错误码：E_SOURCE_NOT_ALLOWED
- 错误码：E_SERVER_OFFLINE
- 错误码：E_CHANNEL_SETUP_FAILED
- 协议头：Cookie
- 协议头：X-Operator-Token
- 协议头：X-Request-Id
- 状态码：200
- 状态码：202
- 状态码：403
- 状态码：409

建立前必须校验令牌可用、来源在白名单内、目标服务器在线；建立成功后令牌转为 consumed，
并立即记录会话开始。

### Acceptance

- A9：持有有效令牌的 requester 建立通道后返回 200，令牌转为 consumed，且生成状态为 active 的会话
- A10：重复使用同一令牌时返回 409 与 E_GRANT_ALREADY_USED
- A11：来源地址不在白名单内时返回 403 与 E_SOURCE_NOT_ALLOWED，且不产生任何转发规则

## POST /api/emergency/tunnel/close

回收指定会话的临时通道，恢复原有转发规则。

- 模型：AccessSession
- 错误码：E_CHANNEL_TEARDOWN_FAILED
- 协议头：Cookie
- 协议头：X-Request-Id
- 状态码：200

回收必须幂等：对已回收的会话重复调用不报错、不改动系统状态。

### Acceptance

- A12：回收后会话状态变为 ended，end_reason 被记录，且原有转发规则不再包含临时规则
- A13：对已回收会话重复调用返回 200，且不产生额外变更
