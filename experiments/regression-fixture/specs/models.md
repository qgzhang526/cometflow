# 数据模型

唯一数据字典：实体、字段、枚举、状态机。字段只在此定义，其余 spec 只引用、不重述。

## 实体：Session

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|---|---|---|---|---|
| id | string | 是 | 是 | 会话主键 |
| subject | string | 是 | 否 | 会话主体（登录用户） |
| expiresAt | string | 是 | 否 | 过期时间（ISO 时间戳） |

## 枚举

- 0=active, 1=expired, 2=revoked（会话状态）
