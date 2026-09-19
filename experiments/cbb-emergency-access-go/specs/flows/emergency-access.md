# 应急接入流程

一次完整的应急运维接入场景，从申请到回收。

## 前置条件

- 运维人员已通过现有配置管理平台登录并完成 MFA
- 目标服务器已在 ServerTarget 中登记，且状态为 online
- 申请人具备 requester 角色，审批人具备 approver 角色
- 运维终端来源地址在 access.allowed_source_cidrs 内

## 步骤

### 步骤1 发起申请

- 调用 POST /api/emergency/access/request
- 模型：AccessRequest

### 步骤2 审批

- 审批人核对工单号后调用 POST /api/emergency/access/approve
- 模型：ApprovalDecision

### 步骤3 发放一次性令牌

- 审批通过后生成 AccessGrant，令牌只在响应中返回一次
- 模型：AccessGrant

### 步骤4 建立临时通道

- 运维终端携带令牌调用 POST /api/emergency/tunnel/open
- 服务端按 配置：tunnel.forward_to_port 建立到目标 SSH 的临时转发
- 监听端口由 配置：tunnel.listen_port 指定

### 步骤5 运维操作

- 运维人员使用一次性令牌完成登录并执行排障操作
- 会话活动期间由守卫进程持续监测

### 步骤6 自动回收

- 会话超过 配置：access.max_duration_minutes 或空闲超过 配置：access.idle_timeout_minutes 时触发回收
- 守卫进程调用 POST /api/emergency/tunnel/close
- 临时转发规则被移除，临时账号失效

## 后置条件

- AccessSession 状态为 ended，end_reason 已记录
- AuditEvent 已落库，并按 配置：alert.notify_on 推送告警
- 系统内不残留转发规则与有效令牌
