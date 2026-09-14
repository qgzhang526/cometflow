# 演示种子：CBB 应急运维接入（Emergency Access）

这是给「用 CometFlow 设计并实现一个 CBB」演示准备的**种子项目**：只包含人类该写的东西
（`COMETFLOW.md` + `specs/`），**不含实现代码**。

## 它解决什么问题

生产服务器的 SSH 被防火墙策略封锁，只开放了配置管理页面端口。值班运维在需要紧急排障时，
失去了一条可用的接入路径。

本 CBB 提供**受控的应急接入**：显式申请 → 审批 → 一次性令牌 → 限时通道 → 到期/空闲自动回收 → 全审计。

## 明确不做的事

| 不做 | 原因 |
|---|---|
| 隐藏入口、密语式触发（如「5 秒内点击 10 次」） | 隐藏触发不是认证。任何能打开管理页面的人（或一段 CSRF/XSS）都能拿到 SSH |
| 故意混淆的接口路径 | 混淆不增加安全性，只会妨碍审计与排障 |
| 绕过或修改物理防火墙策略 | 访问控制变更必须走变更流程，不能由被管控方自行绕过 |
| 静默开启 sshd | 无法追溯的权限变更等同于后门 |
| 页面展示的共享口令 | 口令一旦上屏就不可控；改用一次性、绑定到人的令牌 |

## 目录说明

```text
cbb-emergency-access/
├─ COMETFLOW.md                  # 使命 + 技术栈 + 三个目标 G1..G3
├─ specs/
│  ├─ models.md                  # 数据字典：6 个实体 + 枚举 + 状态机
│  ├─ protocol.md                # 请求头 / 响应包络 / 状态码总表
│  ├─ errors.md                  # 全局错误码目录
│  ├─ config.md                  # 运行时配置键
│  ├─ rules.md                   # 领域不变量（越权不可绕过、一次性令牌、禁止自审、熔断）
│  ├─ constraints.md             # 安全 / 审计 / 性能 / 高可用 / 部署约束
│  ├─ permissions.md             # 角色 × API 权限矩阵
│  ├─ processes.md               # 常驻进程：会话守卫、告警投递
│  ├─ access/spec.md             # capability：申请 / 审批 / 吊销 / 查询
│  ├─ tunnel/spec.md             # capability：通道建立与回收
│  ├─ guard/spec.md              # capability：回收扫描
│  ├─ audit/spec.md              # capability：审计导出
│  └─ flows/emergency-access.md  # flow：一次完整的应急接入场景
```

覆盖 12 类 spec kind 中的 11 类（仅 `pages` 缺席，因为前端复用现有管理平台）。

使用方式见：[`docs/demo/cbb-emergency-access-demo.md`](../../docs/demo/cbb-emergency-access-demo.md)。
