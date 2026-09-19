---
capability: tunnel
module: internal/tunnel
---

# tunnel capability

在授权有效期内建立与回收到目标服务器 SSH 的临时通道。

### 转发器适配器

本 capability 判定授权、维护会话生命周期；**实际转发由转发器适配器执行**，默认实现放在
`internal/tunnel` 实现 `app.Forwarder` 接口；生产由 配置：tunnel.forwarder 选内置实现。

适配器模块必须导出 `createForwarder({ config })`，返回：

| 方法 | 签名 | 语义 |
|------|------|------|
| open | `open({ session_id, server_id, source_ip }) → { rule_id }` | 建立转发规则，返回规则标识 |
| close | `close({ session_id }) → void` | 撤销该会话的转发规则；**幂等**，没有对应规则时不报错 |
| list | `list() → string[]` | 当前生效的规则标识列表，用于「不残留」判定 |

默认适配器只维护规则表、不建立真实 SSH 连接（演练适配器，见 constraints.md 部署约束）；
验收用 `tests/acceptance/fakes_test.go` 里的 `newFakeForwarder()` 注入，异常路径用 `newFailingForwarder()`。

## POST /api/emergency/tunnel/open

消费一次性令牌，建立到目标服务器的临时通道。

- 请求体：server_id；一次性令牌放在 协议头：X-Operator-Token
- 响应：data = AccessSession（status 为 active）
- 模型：AccessGrant
- 模型：AccessSession
- 错误码：E_GRANT_NOT_FOUND
- 错误码：E_GRANT_EXPIRED
- 错误码：E_GRANT_ALREADY_USED
- 错误码：E_GRANT_REVOKED
- 错误码：E_SOURCE_NOT_ALLOWED
- 错误码：E_SERVER_OFFLINE
- 错误码：E_CHANNEL_SETUP_FAILED
- 协议头：Cookie
- 协议头：X-Operator-Token
- 协议头：X-Request-Id
- 协议头：X-Forwarded-For
- 状态码：200
- 状态码：202
- 状态码：403
- 状态码：409

建立前必须校验令牌可用、来源在白名单内、目标服务器在线；建立成功后令牌转为 consumed，
并立即记录会话开始。
来源判定同 access：取 协议头：X-Forwarded-For 的最后一个值，缺省用 socket 远端地址；
不在 配置：access.allowed_source_cidrs 内一律拒绝，且**不得**调用转发器。

### Acceptance

- A9：持有有效令牌的 requester 建立通道后返回 200，令牌转为 consumed，且生成状态为 active 的会话
  - check: go test ./tests/acceptance -run '^TestA9$' -count=1
- A10：重复使用同一令牌时返回 409 与 E_GRANT_ALREADY_USED
  - check: go test ./tests/acceptance -run '^TestA10$' -count=1
- A11：来源地址不在白名单内时返回 403 与 E_SOURCE_NOT_ALLOWED，且不产生任何转发规则
  - check: go test ./tests/acceptance -run '^TestA11$' -count=1
- A18：持有已被吊销授权的令牌调用时返回 403 与 E_GRANT_REVOKED，且不产生转发规则
  - check: go test ./tests/acceptance -run '^TestA18$' -count=1

## POST /api/emergency/tunnel/close

回收指定会话的临时通道，恢复原有转发规则。

- 请求体：session_id、reason（可选，缺省 user_closed）
- 响应：data = AccessSession（status 为 ended，end_reason 已记录）
- 模型：AccessSession
- 错误码：E_CHANNEL_TEARDOWN_FAILED
- 协议头：Cookie
- 协议头：X-Request-Id
- 状态码：200

回收必须幂等：对已回收的会话重复调用不报错、不改动系统状态。
回收成功时 end_reason 按请求体 reason 记录（见 models.md 的 EndReason 枚举）。

### Acceptance

- A12：回收后会话状态变为 ended，end_reason 被记录，且原有转发规则不再包含临时规则
  - check: go test ./tests/acceptance -run '^TestA12$' -count=1
- A13：对已回收会话重复调用返回 200，且不产生额外变更
  - check: go test ./tests/acceptance -run '^TestA13$' -count=1
