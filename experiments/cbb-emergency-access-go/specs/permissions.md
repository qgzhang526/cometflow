# 认证与鉴权

有角色划分，使用角色 × API 权限矩阵。角色来自现有管理平台。

## 角色定义

| 角色 | 说明 |
|------|------|
| requester | 值班运维，可发起应急申请并建立通道 |
| approver | 运维负责人，可审批与吊销 |
| auditor | 安全审计员，只读审计与导出 |
| guard | 守卫进程身份，用于执行回收 |

## 接口级权限

| API | requester | approver | auditor | guard | 说明 |
|-----|-----------|----------|---------|-------|------|
| POST /api/emergency/access/request | 是 | 是 | 否 | 否 | 发起申请 |
| POST /api/emergency/access/approve | 否 | 是 | 否 | 否 | 审批 |
| POST /api/emergency/access/revoke | 否 | 是 | 否 | 否 | 吊销 |
| GET /api/emergency/access/status | 是 | 是 | 是 | 否 | 查询申请状态 |
| POST /api/emergency/tunnel/open | 是 | 否 | 否 | 否 | 建立通道 |
| POST /api/emergency/tunnel/close | 是 | 是 | 否 | 是 | 回收通道 |
| POST /api/emergency/guard/sweep | 否 | 否 | 否 | 是 | 触发回收扫描 |
| GET /api/emergency/audit/export | 否 | 否 | 是 | 否 | 导出审计 |
