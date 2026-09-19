# 后台进程

常驻/后台进程：触发条件、输入、处理逻辑、输出、异常处理。与 flow 的区别：process 是常驻循环，flow 是一次性场景。

## 进程：会话守卫

- 触发条件：常驻循环，周期由配置决定
- 输入：AccessGrant、AccessSession 以及当前通道状态
- 处理逻辑：逐个会话判断是否超过最长时长或空闲超时；命中则回收通道并结束会话
- 输出：AuditEvent（session_ended、channel_closed）
- 异常处理：回收失败按配置重试，仍失败则记录 E_CHANNEL_TEARDOWN_FAILED 并告警
- 配置：guard.tick_seconds
- 配置：guard.teardown_retries
- 配置：access.max_duration_minutes
- 配置：access.idle_timeout_minutes
- 实体：AccessSession
- 实体：AccessGrant
- 引用 API：调用 POST /api/emergency/tunnel/close

## 进程：过期清理

- 触发条件：随会话守卫同周期执行
- 输入：AccessRequest、AccessGrant
- 处理逻辑：把已过期但状态仍为 approved 的申请单转为 expired，把未消费且过期的授权转为 expired
- 输出：AuditEvent
- 异常处理：单条失败不影响其他记录，累计失败超过阈值则告警
- 配置：guard.tick_seconds
- 实体：AccessRequest
- 实体：AccessGrant

## 进程：告警投递

- 触发条件：订阅审计事件流
- 输入：AuditEvent
- 处理逻辑：按配置过滤事件类型后投递到告警通道
- 输出：告警投递记录
- 异常处理：投递失败进入重试队列，不阻塞主流程
- 配置：alert.notify_on
- 配置：alert.webhook_url
- 实体：AuditEvent
