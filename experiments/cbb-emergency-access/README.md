# 演示种子：CBB 应急运维接入（Emergency Access）

这是给「用 CometFlow 设计并实现一个 CBB」演示准备的**种子项目**：人类写的东西
（`COMETFLOW.md` + `specs/`）+ 判据（`tests/`）都在这里，**实现代码由 Agent 在 change / daemon
通道里产出**。实现产出来之前判据是红的，这是设计意图——判据先于实现。

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
├─ COMETFLOW.md                  # 使命 + 技术栈 + 模块归属 + 调度顺序 + 三个目标 G1..G3
├─ specs/
│  ├─ models.md                  # 数据字典：6 个实体 + 枚举 + 状态机
│  ├─ protocol.md                # 服务入口 / 请求头 / 响应包络 / 状态码总表
│  ├─ errors.md                  # 全局错误码目录
│  ├─ config.md                  # 运行时配置键（含验收接缝：auth / forwarder / 注入时钟）
│  ├─ rules.md                   # 领域不变量（越权不可绕过、一次性令牌、禁止自审、熔断）
│  ├─ constraints.md             # 安全 / 审计 / 可判定性 / 性能 / 高可用 / 部署约束
│  ├─ permissions.md             # 角色 × API 权限矩阵
│  ├─ processes.md               # 常驻进程：会话守卫、告警投递
│  ├─ access/spec.md             # capability：申请 / 审批 / 吊销 / 查询
│  ├─ tunnel/spec.md             # capability：通道建立与回收（含转发器适配器契约）
│  ├─ guard/spec.md              # capability：回收扫描
│  ├─ audit/spec.md              # capability：审计导出
│  └─ flows/emergency-access.md  # flow：一次完整的应急接入场景
├─ tests/
│  ├─ acceptance.mjs             # 判据执行器：A1–A18，spec 里每条 check 都指向它
│  └─ fixtures/                  # 外部依赖的替身：假转发器、失败转发器、服务器台账
└─ reference/src/                # 参考实现（不在演示路径上，见下）
```

覆盖 12 类 spec kind 中的 11 类（仅 `pages` 缺席，因为前端复用现有管理平台）。

## 判据（8 个任务 × 18 条验收）

每条验收都带 `- check: node tests/acceptance.mjs A<n>`，因此这个种子可以真的跑在无人值守模式
（daemon / serve 内嵌调度器）里，而不只是走状态机。

| 目标 | 任务 | anchor | 判据 |
|---|---|---|---|
| G1 | T1 | `POST /api/emergency/access/request` | A1 A2 A3 |
| G1 | T2 | `POST /api/emergency/access/approve` | A4 A5 A6 |
| G1 | T3 | `POST /api/emergency/access/revoke` | A7 |
| G1 | T4 | `GET /api/emergency/access/status` | A8 |
| G2 | T1 | `POST /api/emergency/tunnel/open` | A9 A10 A11 A18 |
| G2 | T2 | `POST /api/emergency/tunnel/close` | A12 A13 |
| G2 | T3 | `POST /api/emergency/guard/sweep` | A14 A15 |
| G3 | T1 | `GET /api/emergency/audit/export` | A16 A17 |

判据只依赖 Node 内置模块（运行环境声明 Node 24+，SQLite 走内置 `node:sqlite`）。
外部依赖全部做成接缝：SSH 转发（`tunnel.forwarder_module`）、系统时钟（`guard.now`）、
管理平台会话（`auth.mode`）——这是「验收可判定」的前提，也是 constraints.md 里的一条约束
（**可判定性约束**）。

```bash
node tests/acceptance.mjs        # 跑全部判据（人工复核）
node tests/acceptance.mjs A9     # 单条判据（change verify 就是这么调的）
```

## 两种演示用法

| 用法 | 做法 | 看点 |
|---|---|---|
| 单个 change 执行 | `change new` → `confirm-acceptance` → `change run --agent <真 Agent>` → `change verify` → `change archive` | Builder 实现、独立验收、判据红→绿 |
| daemon 无人值守 | `daemon start`（或 `serve` 内嵌调度器） | 按 `## 调度顺序` 领任务、逐条跑 check、失败进修复循环 |

## reference/src 是什么

它是一份**参考实现**，用途有三个：

1. 证明判据是可满足的（`test/domains/experiment-cbb-seed.test.ts` 会把它贴进临时项目跑全部 18 条判据）；
2. 演示的确定性兜底：现场 Agent 不可用或时间不够时，`cp -r reference/src .` 之后
   `daemon start --agent mock` 可以把 8 个任务全部跑成 delivered；
3. 给实现者一个可对照的接缝写法（适配器、注入时钟、append-only 审计）。

它**不在演示路径上**：默认演示里 `src/` 由 Agent 从 spec 产出，README 与演示脚本都不依赖它。

完整操作步骤见：[`docs/demo/cbb-emergency-access-demo.md`](../../docs/demo/cbb-emergency-access-demo.md)。
