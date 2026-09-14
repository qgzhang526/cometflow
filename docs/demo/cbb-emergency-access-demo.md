# 演示脚本：用 CometFlow 设计与实现一个 CBB（应急运维接入）

本文是「用 CometFlow 设计并落地一个公共构建块（CBB）」的完整演示脚本。

- 演示种子：[`experiments/cbb-emergency-access/`](../../experiments/cbb-emergency-access/README.md)
- 命令对照说明（每条 CLI 在做什么）：[`docs/demo/todoscan-demo-cli-notes.md`](./todoscan-demo-cli-notes.md)
- 平台使用说明：[`docs/USAGE.md`](../USAGE.md)

---

## 0. 场景与目标

**问题**：生产服务器的 SSH 被防火墙策略封锁，只开放了配置管理页面端口。值班运维在紧急排障时，
失去了一条可用接入路径。

**CBB 目标**：提供一条**显式授权、强认证、有时限、全审计**的应急接入通道，可被多个运维平台复用。

### 0.1 设计红线（先说清楚，避免做成后门）

应急通道最容易做成后门，区别只在几个细节。本 CBB 明确**不做**下面这些：

| 不做 | 原因 |
|---|---|
| 隐藏入口 / 密语式触发（例如「5 秒内点击 10 次」） | 隐藏触发不是认证。任何能打开管理页面的人，或一段 CSRF/XSS，就拿到了 SSH |
| 故意混淆的接口路径 | 混淆不增加安全性，只妨碍审计与排障。可信系统要能被人读懂 |
| 静默开启 sshd / 静默放行端口 | 无法追溯的权限变更等于后门；改为「申请 → 审批 → 开启 → 到期回收」 |
| 页面上展示的共享口令 | 口令一上屏就不可控；改为一次性、绑定到人、只展示一次的令牌 |
| 绕过或修改物理防火墙策略 | 访问控制变更必须走独立变更流程，不能由被管控方自行绕过 |

保留的是真实需求：**运维能进去，但过程可控、可查、可回滚**。

### 0.2 覆盖的平台能力

| 环节 | 平台能力 |
|---|---|
| 初始化 | `init --interactive` 按项目类型裁剪 12 类 spec kind |
| 契约 | `COMETFLOW.md` + 13 个 spec 文件，覆盖 11 类 kind |
| 校验 | `spec validate` 的跨文件引用检查（错误码 / 模型 / 协议头 / 状态码 / API 路径 / 配置键） |
| 拆解 | 3 个目标 → 8 个任务，acceptance 精确落位 |
| 执行 | `change new/transition/run/verify/archive` |
| 治理 | spec 变更 → `spec diff` → `spec drift` → `plan regenerate` |
| 落地 | 新能力：`change archive` 支持根级 kind 文件与 flow 文件随工单落地 |

---

## 1. 一次性准备

```bash
mkdir -p ~/demos && cd ~/demos
cometflow init cbb-emergency-access --interactive
cd cbb-emergency-access
```

按顺序回答（照抄）：

| # | 问题 | 回答 |
|---|---|---|
| 1 | 前端框架（无则填 无） | `无` |
| 2 | 后端语言/框架 | `Node.js` |
| 3 | 数据库（无则填 无） | `SQLite` |
| 4 | 是否有对外网络接口 / 通信协议？ | `y` |
| 5 | 是否有运行时配置键？ | `y` |
| 6 | 是否有跨接口/跨模块的业务场景？ | `y` |
| 7 | 是否有常驻后台进程或定时循环？ | `y` |
| 8 | 是否有领域 DSL 或业务不变量？ | `y` |
| 9 | 鉴权方式 | `roles` |
| 10 | 错误码是否较多（>20 个）？ | `y` |

预期结果：**10 类 present、2 类 absent**（`pages` 因为前端复用现有管理平台而缺席，`capability` 由拆解派生）。
同时会自动建出 `specs/flows/` 目录。

```bash
cometflow spec scaffold --list .
```

---

## 2. 贴 spec

把种子里的 `COMETFLOW.md`、`specs/` 覆盖进去（会盖掉 `init` 生成的骨架文件）：

```bash
cp -r <cometflow 仓库>/experiments/cbb-emergency-access/COMETFLOW.md .
cp -r <cometflow 仓库>/experiments/cbb-emergency-access/specs/* specs/
```

种子包含 13 个 spec 文件：

| 文件 | kind | 关键内容 |
|---|---|---|
| `specs/models.md` | models | 6 个实体 + 8 个枚举 + 3 个状态机 |
| `specs/protocol.md` | protocol | 3 个请求头 + 9 个状态码 |
| `specs/errors.md` | errors | 16 个错误码 |
| `specs/config.md` | config | 14 个配置键（含 `access.max_duration_minutes`、`guard.tick_seconds`） |
| `specs/rules.md` | rules | 越权不可绕过、一次性令牌、禁止自审、熔断、来源收敛 |
| `specs/constraints.md` | constraints | 安全 / 审计 / 性能 / 高可用 / 部署 / 离线 |
| `specs/permissions.md` | permissions | 4 个角色 × 8 个 API 的权限矩阵 |
| `specs/processes.md` | process | 3 个常驻进程：会话守卫、过期清理、告警投递 |
| `specs/access/spec.md` | capability | 申请 / 审批 / 吊销 / 查询（4 个 anchor） |
| `specs/tunnel/spec.md` | capability | 开通道 / 关通道（2 个 anchor） |
| `specs/guard/spec.md` | capability | 回收扫描（1 个 anchor） |
| `specs/audit/spec.md` | capability | 审计导出（1 个 anchor） |
| `specs/flows/emergency-access.md` | flow | 一次完整应急接入的 6 步场景 |

> 写 capability spec 时有一条硬规则：**除了 `### Acceptance`，不要再写别的 `###` 小标题**。
> 平台会把 `###` 标题当成 anchor，多拆出「实现 xxx - 请求体」这样的垃圾任务（已实测）。
> 请求/响应字段的权威定义放在 `models.md`，用 `- 模型：EntityName` 引用。

---

## 3. 校验与投影

```bash
cometflow context sync .
cometflow goal sync .
cometflow spec validate .
cometflow spec lock .
cometflow spec index .
```

实测输出：

```text
wrote .../.cometflow/project-context.yaml
wrote .../.cometflow/goals/G1.yaml
wrote .../.cometflow/goals/G2.yaml
wrote .../.cometflow/goals/G3.yaml
spec validate: OK
```

`spec validate: OK` 意味着这些跨文件引用**全部解析成功**：

- capability 里 `错误码：E_GRANT_ALREADY_USED` → 在 `errors.md` 找到
- capability 里 `模型：AccessGrant` → 在 `models.md` 找到
- capability 里 `协议头：X-Operator-Token`、`状态码：409` → 在 `protocol.md` 找到
- flow 里 `调用 POST /api/emergency/tunnel/close` → 在 `tunnel/spec.md` 找到对应 anchor
- flow / process 里 `配置：tunnel.forward_to_port` → 在 `config.md` 找到
- `permissions.md` 矩阵里的 8 条 API 路径 → 与 capability anchor 全部对得上

> 现场看点：把 `specs/errors.md` 里的 `E_GRANT_ALREADY_USED` 改名，再跑 `spec validate`，
> 立刻会报 `unresolved-error-reference`。契约是机器可校验的，这是这个平台与其他「文档驱动」方案的核心差别。

---

## 4. 拆解到冻结

```bash
for g in G1 G2 G3; do
  cometflow plan generate $g .
  cometflow plan validate $g .
  cometflow plan approve $g .
  cometflow plan freeze $g .
done
```

实测结果：**3 个目标 → 8 个任务**，acceptance 各自落位。

| 目标 | 任务 | anchor | acceptance |
|---|---|---|---|
| G1 | T1 | `POST /api/emergency/access/request` | A1, A2, A3 |
| G1 | T2 | `POST /api/emergency/access/approve` | A4, A5, A6 |
| G1 | T3 | `POST /api/emergency/access/revoke` | A7 |
| G1 | T4 | `GET /api/emergency/access/status` | A8 |
| G2 | T1 | `POST /api/emergency/tunnel/open` | A9, A10, A11 |
| G2 | T2 | `POST /api/emergency/tunnel/close` | A12, A13 |
| G2 | T3 | `POST /api/emergency/guard/sweep` | A14, A15 |
| G3 | T1 | `GET /api/emergency/audit/export` | A16, A17 |

> 讲解点：**人没有手写任务清单**。任务是从「目标范围 → capability spec → 每个 anchor」推出来的；
> 而且权限矩阵里的 8 条 API、flow 里的 6 个步骤，都能对上这 8 个 anchor。

---

## 5. 执行一个任务

以 G2 的 T1（建立临时通道）为例，这是整个 CBB 里最核心的一条：

```bash
cometflow change new tunnel-open --goal G2 --task T1
cometflow change transition tunnel-open confirm-acceptance .
cometflow change run tunnel-open . --agent opencode
```

Builder 会拿到 `changes/tunnel-open/brief.md`（含 spec 路径、anchor、A9–A11）。建议在跑之前把这三条
acceptance 原文追加到 `brief.md`，让 Agent 不必自己回读 spec。

独立验收（Verifier 的动作，不采信 Builder 自述）后写 `verification.yaml`：

```yaml
schema: cometflow.verification.v1
change: tunnel-open
acceptance:
  - id: A9
    result: passed
    reason: 有效令牌建立通道后返回 200，令牌转 consumed，会话置 active
  - id: A10
    result: passed
    reason: 同一令牌二次使用返回 409 + E_GRANT_ALREADY_USED
  - id: A11
    result: passed
    reason: 非白名单来源返回 403 + E_SOURCE_NOT_ALLOWED，且未生成转发规则
```

```bash
cometflow change verify tunnel-open .
cometflow change archive tunnel-open .
```

---

## 6. 新能力：spec 变更随工单一起落地

这是本次新增的平台能力。变更层 `changes/<名>/specs/` 现在支持三类目标，归档时一并落地：

| 变更层路径 | 落地到 |
|---|---|
| `specs/<capability>/spec.md` | `specs/<capability>/spec.md` |
| `specs/flows/<name>.md` | `specs/flows/<name>.md` |
| `specs/<根级 kind>.md`（models / protocol / errors / config / constraints / permissions / rules / processes / pages） | `specs/<同名文件>` |

实测（在真实项目上跑通）：

```bash
mkdir -p changes/access-request/specs/notify
cp specs/errors.md changes/access-request/specs/errors.md
# 再放一个新增 capability
cometflow change archive access-request .
```

```text
applied specs/errors.md
applied specs/notify/spec.md
change access-request archived=true
```

> 行为变化说明：旧实现只认 `<capability>/spec.md`，遇到根级文件会**静默中断**且照样报 `archived=true`，
> 会导致 spec 变更丢失。现在改为：支持根级 kind 与 flow 文件；遇到不认识的路径直接报错，
> 且**不推进归档状态**，避免半途而废。

---

## 7. 修改已有功能

以「把空闲超时从 5 分钟改成 3 分钟，并新增一条验收」为例：

```bash
# 1) 改 spec：specs/config.md 调整默认值；specs/guard/spec.md 追加 A18
cometflow spec validate .
cometflow spec diff .     # modified: specs/config.md, specs/guard/spec.md
cometflow spec drift .    # 报出受影响的已冻结任务

# 2) 重新绑定
cometflow plan regenerate G2 . --preserve-approved
cometflow plan validate G2 .
cometflow plan approve G2 .
cometflow plan freeze G2 .

# 3) 用新契约开新工单（名字不要复用已归档的）
cometflow change new tunnel-open-v2 --goal G2 --task T1
```

> 硬约束：执行阶段不再重新解释 spec。改动必须先在 `specs/` 落地并重新冻结，
> 新工单才会拿到新的 acceptance 与新的 `spec_hash`。

---

## 8. 时间轴建议

| 分钟 | 内容 |
|---|---|
| 0–4 | 讲场景与设计红线：为什么不做隐藏触发 |
| 4–8 | 步骤 1–3：`init --interactive` 裁剪 → 贴 spec → `spec validate` 现场改错 |
| 8–12 | 步骤 4：3 个目标拆出 8 个任务，展示权限矩阵与 anchor 的对应关系 |
| 12–20 | 步骤 5：真实 Agent 跑 `tunnel-open` + 独立验收 + 归档 |
| 20–24 | 步骤 6：变更层落地根级 kind 文件（本次新能力） |
| 24–27 | 步骤 7：spec 变更治理 —— `diff` / `drift` / `regenerate` |
| 27–30 | `cometflow serve` 看板收尾 |

---

## 9. 注意事项

| 风险 | 兜底 |
|---|---|
| 现场没有 opencode / claude-code | 用 `--agent mock` 走通状态机；验收改看预跑产物 |
| Agent 没实现完 | 这正是看点：`change verify` 判 fail → 退回 `build`，展示「不可自证完成」 |
| 时间不够 | 只演 G2 的 T1，其余 7 个任务预跑 |
| `init --interactive` 卡住 | 必须在真实终端运行，不要用管道喂输入 |
| `verification.yaml` 报 coverage mismatch | acceptance id 必须与冻结集合**完全一致** |
| 引入 SQLite 驱动 | 内网环境需自备离线 tarball；否则把技术栈改为「无」并去掉 models.md |
