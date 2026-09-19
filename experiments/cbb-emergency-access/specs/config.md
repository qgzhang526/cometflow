# 运行时配置

运行时配置契约：键 → 类型 → 默认值 → 必填 → 敏感。配置文件为 JSON，键按点号分层
（`access.max_duration_minutes` → `{"access":{"max_duration_minutes":30}}`），相对路径按进程 cwd 解析。

## 配置项

| 键 | 类型 | 默认值 | 必填 | 敏感 | 说明 |
|----|------|--------|------|------|------|
| auth.mode | string | platform | 否 | 否 | 认证来源：platform=复用管理平台会话（生产）；header=读 X-Actor-Id / X-Actor-Roles（仅演练与验收） |
| store.file | string | :memory: | 否 | 否 | SQLite 数据库文件路径；`:memory:` 表示进程内内存库 |
| targets.file | string | （无） | 是 | 否 | 目标服务器清单 JSON（管理平台同步产物），每项为 models.md 的 ServerTarget |
| access.max_duration_minutes | integer | 30 | 否 | 否 | 单次应急接入的最长时长 |
| access.idle_timeout_minutes | integer | 5 | 否 | 否 | 空闲多久自动断开 |
| access.require_second_approver | boolean | false | 否 | 否 | 是否要求双人复核（两名不同的审批人都通过才发放授权） |
| access.allowed_source_cidrs | string[] | [] | 是 | 否 | 允许发起申请与建立通道的来源网段 |
| access.reject_limit_per_hour | integer | 3 | 否 | 否 | 每小时最多被拒绝次数，超过触发熔断 |
| access.circuit_break_minutes | integer | 30 | 否 | 否 | 熔断持续时长 |
| tunnel.listen_port | integer | 22022 | 否 | 否 | 临时通道在本机监听的端口 |
| tunnel.forward_to_port | integer | 22 | 否 | 否 | 转发到的目标端口 |
| tunnel.forwarder_module | string | src/tunnel/forwarder.mjs | 否 | 否 | 转发器适配器模块；验收用 tests/fixtures/fake-forwarder.mjs 替换真实转发 |
| guard.tick_seconds | integer | 10 | 否 | 否 | 守卫进程扫描周期 |
| guard.teardown_retries | integer | 3 | 否 | 否 | 回收失败重试次数 |
| guard.now | string | （空） | 否 | 否 | 注入的「当前时刻」（ISO8601）；非空时守卫与过期清理以它为准。仅演练与验收使用，生产必须留空 |
| audit.export_dir | string | /var/log/emergency-access | 否 | 否 | 审计导出目录 |
| audit.retention_days | integer | 180 | 否 | 否 | 审计保留天数 |
| alert.webhook_url | string |  | 是 | 是 | 告警 webhook 地址 |
| alert.notify_on | string[] | [request_created, request_approved, channel_opened, session_ended] | 否 | 否 | 触发告警的事件类型 |
