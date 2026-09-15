# 领域规则

领域不变量；不描述常驻进程，不重述字段（字段归 models.md）。

## 规则：会话有效期

- 语义：会话超过 session.ttlMs 后必须判定为过期，任何读取都返回 E_SESSION_EXPIRED
- 模型：Session
- 配置键：session.ttlMs
- 错误码：E_SESSION_EXPIRED
