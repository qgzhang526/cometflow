---
capability: guard
module: internal/guard
---

# guard capability

会话守卫对外暴露的受控触发入口，用于在异常场景下立即执行一次回收扫描。

## POST /api/emergency/guard/sweep

立即执行一次回收扫描，返回本次处理的会话与失败项。

- 响应：data = { reclaimed: [session_id], failed: [{ session_id, code }] }
- 模型：AccessSession
- 模型：AccessGrant
- 错误码：E_CHANNEL_TEARDOWN_FAILED
- 协议头：X-Request-Id
- 状态码：200
- 状态码：403

仅 guard 角色可调用。扫描范围包括超过最长时长与空闲超时的会话，以及已过期的授权。
「当前时刻」取 配置：guard.now（非空时）否则取系统时间；回收失败按 配置：guard.teardown_retries 重试，
重试仍失败时把该项放进 failed 并在审计里记 E_CHANNEL_TEARDOWN_FAILED；
扫描必须能跨进程恢复：重启后的守卫依据持久化状态（配置：store.file）完成回收，不允许出现孤儿通道。

### Acceptance

- A14：存在超过 access.max_duration_minutes 的会话时，调用后该会话被回收，返回结果中包含其 session_id
  - check: go test ./tests/acceptance -run '^TestA14$' -count=1
- A15：回收失败时返回 200 但在结果中列出失败项，并记录 E_CHANNEL_TEARDOWN_FAILED
  - check: go test ./tests/acceptance -run '^TestA15$' -count=1
