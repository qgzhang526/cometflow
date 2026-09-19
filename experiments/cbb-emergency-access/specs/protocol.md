# 通信协议

传输契约：服务入口、传输方式、压缩、请求头、响应包络、状态码总表。

## 服务入口

实现必须同时提供进程形态与模块形态，二者共用同一份路由与业务逻辑。

| 形态 | 契约 |
|------|------|
| 进程 | `node src/server.mjs --config <config.json> --port <port>`；监听就绪后在 stdout 打印 `listening on <port>`（`--port 0` 表示由系统分配端口）；收到 SIGTERM/SIGINT 时优雅退出码 0 |
| 模块 | `src/server.mjs` 导出 `createApp({ configPath })` → `{ port, url, close() }`；`configPath` 为配置文件绝对路径 |

配置文件为 JSON，键按 config.md 的点号分层（`access.max_duration_minutes` →
`{"access":{"max_duration_minutes":30}}`）；配置里的相对路径按进程 cwd 解析。

验收执行器（`tests/acceptance.mjs`）用模块形态在同一进程内起服务，因此模块形态是**判据的一部分**，
不允许只有进程形态。

## 传输方式

- 仅 HTTPS，复用现有配置管理平台的入口与证书
- 不新增对外监听端口

## 压缩

- gzip

## 请求头

| 头 | 类型 | 必填 | 说明 |
|----|------|------|------|
| Cookie | string | 是 | 现有管理平台会话（`auth.mode=platform` 时用于识别调用者） |
| X-Request-Id | string | 是 | 请求追踪 ID，用于审计关联 |
| X-Operator-Token | string | 否 | 一次性令牌，仅在建立通道时携带 |
| X-Forwarded-For | string | 否 | 来源地址；经代理时取**最后一个**值，缺省时取 socket 远端地址。来源白名单按它判定 |
| X-Actor-Id | string | 否 | 仅 `auth.mode=header` 时有效：调用者账号 |
| X-Actor-Roles | string | 否 | 仅 `auth.mode=header` 时有效：逗号分隔的角色名（见 permissions.md） |

## 响应包络

所有响应体（含错误）都是同一个 JSON 包络：

{ "code": 0, "message": "", "data": {} }

- 成功：`code` 为 `0`
- 失败：`code` 为 errors.md 里的错误码字符串（如 `E_SOURCE_NOT_ALLOWED`），`message` 为人话说明，
  HTTP 状态码按下面的「状态码总表」取；失败时 `data` 为 `{}`
- 枚举字段一律取 models.md 里枚举的**名字**（如 `pending`、`ended`），不取序号
- 时间字段一律为 ISO8601 字符串（UTC）

## 状态码总表

| 状态码 | 含义 | 说明 |
|--------|------|------|
| 200 | OK | 成功 |
| 202 | Accepted | 已受理，异步完成 |
| 401 | Unauthorized | 未登录、会话失效或令牌无效 |
| 403 | Forbidden | 角色或来源不满足 |
| 404 | Not Found | 对象不存在 |
| 409 | Conflict | 状态冲突，例如重复审批 |
| 423 | Locked | 资源被占用 |
| 429 | Too Many Requests | 触发熔断 |
| 500 | Internal Error | 服务内部错误 |
