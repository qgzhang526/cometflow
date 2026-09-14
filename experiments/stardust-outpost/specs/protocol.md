# 通信协议

传输契约：serve 与前端、引擎与存档之间的协议约定。

## 传输方式

- REST + SSE（cometflow serve）

## 请求头

| 头 | 类型 | 必填 | 说明 |
|----|------|------|------|
| Authorization | string | 否 | Bearer token（本地 serve 可选） |

## 状态码总表

| 状态码 | 含义 | 说明 |
|--------|------|------|
| 200 | OK | 成功 |
| 202 | Accepted | 已提交异步 job |
| 400 | Bad Request | 参数错误 |
| 404 | Not Found | 资源不存在 |
