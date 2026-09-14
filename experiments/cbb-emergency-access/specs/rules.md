# 领域规则

领域不变量：只描述语义，不重述字段（字段归 models.md），不描述常驻进程（进程归 processes.md）。

## 规则：越权不可绕过

- 语义：任何通道的建立，都必须存在一条状态为 approved 且未过期的申请单
- 违反后果：拒绝建立，并记录 E_FORBIDDEN_ROLE
- 实体：AccessRequest

## 规则：一次性令牌

- 语义：同一个令牌只能成功消费一次，消费成功后立即转为 consumed
- 违反后果：拒绝建立，并记录 E_GRANT_ALREADY_USED
- 实体：AccessGrant

## 规则：禁止自审

- 语义：申请单的申请人不能是该申请单的审批人
- 违反后果：拒绝审批，并记录 E_SELF_APPROVAL
- 实体：ApprovalDecision

## 规则：熔断

- 语义：同一服务器在一小时内累计被拒绝达到上限后，进入熔断期，期间拒绝新的申请
- 违反后果：拒绝申请，并记录 E_RATE_LIMITED
- 实体：AccessRequest

## 规则：来源收敛

- 语义：通道只对配置白名单内的来源开放，白名单为空时禁止建立任何通道
- 违反后果：拒绝建立，并记录 E_SOURCE_NOT_ALLOWED
- 实体：AccessSession
