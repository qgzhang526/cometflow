# 错误码目录

全局错误码：code → 语义 → 触发接口。

## 错误码

| code | 语义 | 触发接口 |
|------|------|----------|
| E_AUTH_REQUIRED | 未登录、会话失效或令牌无效 | access |
| E_FORBIDDEN_ROLE | 当前角色不允许该操作 | access |
| E_SELF_APPROVAL | 申请人不能审批自己的申请 | access |
| E_SERVER_NOT_FOUND | 目标服务器未登记 | access |
| E_SERVER_OFFLINE | 目标服务器不可达 | tunnel |
| E_REQUEST_NOT_FOUND | 申请单不存在 | access |
| E_REQUEST_ALREADY_DECIDED | 申请单已被审批 | access |
| E_DURATION_EXCEEDS_LIMIT | 申请时长超过配置上限 | access |
| E_GRANT_NOT_FOUND | 授权不存在 | tunnel |
| E_GRANT_EXPIRED | 授权已过期 | tunnel |
| E_GRANT_ALREADY_USED | 一次性令牌已被消费 | tunnel |
| E_GRANT_REVOKED | 授权已被吊销 | tunnel |
| E_SOURCE_NOT_ALLOWED | 来源地址不在白名单 | tunnel |
| E_CHANNEL_SETUP_FAILED | 临时通道建立失败 | tunnel |
| E_CHANNEL_TEARDOWN_FAILED | 临时通道回收失败 | guard |
| E_SESSION_NOT_FOUND | 会话不存在 | tunnel |
| E_RATE_LIMITED | 触发熔断，短期内禁止再次申请 | access |
| E_AUDIT_WRITE_FAILED | 审计写入失败 | audit |
