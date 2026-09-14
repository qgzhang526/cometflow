---
capability: audit
module: src/audit
---

# audit capability

审计事件的查询与导出，供安全团队取证。

## GET /api/emergency/audit/export

按时间范围导出审计事件。

- 模型：AuditEvent
- 错误码：E_FORBIDDEN_ROLE
- 错误码：E_AUDIT_WRITE_FAILED
- 协议头：Cookie
- 协议头：X-Request-Id
- 状态码：200
- 状态码：403

仅 auditor 角色可调用。导出内容为 append-only 审计流的子集，导出动作本身也必须产生审计事件。

### Acceptance

- A16：auditor 指定时间范围导出后返回 200，导出条数与该范围内实际事件数一致
- A17：非 auditor 角色调用返回 403 与 E_FORBIDDEN_ROLE；导出成功后新增一条 audit_exported 事件
