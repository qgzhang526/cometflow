# 演示脚本：用 CometFlow 设计与落地一个 CBB（应急运维接入）

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

### 0.2 这次要证明什么

| 环节 | 平台能力 | 现场看点 |
|---|---|---|
| 契约 | `COMETFLOW.md` + 13 个 spec 文件，覆盖 11 类 kind | 事实只有一个 owner：错误码 / 模型 / 协议头 / 配置键各归各的目录 |
| 校验 | `spec validate` 的跨文件引用检查 | 现场改坏一个错误码 → `unresolved-error-reference` |
| 判据 | 每条验收都带 `- check:`（A1–A18） | 实现产出前是红的，产出后变绿——验收不靠人的印象 |
| 拆解 | 3 个目标 → 8 个任务 | 人工没有手写任务清单，acceptance 精确落位 |
| 执行 | `change new/transition/run/verify/archive` | 单个 change 全流程：判据红 → 实现 → 绿 → 归档 |
| 无人值守 | `daemon start` / `serve` 内嵌调度器 | 按 `## 调度顺序` 领任务、逐条跑 check、跑完自动停 |
| 边界 | 模块归属 + 写保护 | 越界写入会被判 `unattributed changes`，甚至被平台 hook 拦下 |

总时长建议 30 分钟（现场只演 1 个 change + daemon 跑剩余任务，其余预跑）。

### 0.3 本机 Agent 准备（演示前必做）

演示靠**真实 Agent**把 spec 变成实现。本机两条通路的默认模型都指向**官方 DeepSeek V4 Flash**（`deepseek-flash`），
不需要 Claude 账号登录。每条都是 10 秒内能看出结果的命令：

```bash
cometflow agent list                                   # 三个 adapter 是否 available
opencode run "reply with exactly: OK"                  # 通了会回 OK（首次会显示 build · deepseek-flash）
claude -p "reply with exactly: OK" --dangerously-skip-permissions   # 通了会回 OK
```

两边的模型来源是同一处：**CC Switch**（`~/.cc-switch/cc-switch.db`）里的 DeepSeek 接入信息 ——
`https://api.deepseek.com/anthropic`（Anthropic 兼容端点，官方模型名只有 `deepseek-flash` 与 `deepseek-v4-pro`；
`deepseek-v4.1-flash` 这个名字**不存在**，`deepseek-v4-flash` 是可用别名）。

| 落点 | 配置 |
|---|---|
| opencode | `~/.config/opencode/opencode.json`：`"model": "deepseek/deepseek-flash"`，并在 `provider.deepseek.models` 里声明 `deepseek-flash` / `deepseek-v4-pro`；密钥来自 `~/.local/share/opencode/auth.json` 的 `deepseek` |
| Claude Code | `~/.claude/settings.json` 的 `env`：`ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` + `ANTHROPIC_AUTH_TOKEN`（同一个 DeepSeek key）+ `ANTHROPIC_MODEL=deepseek-flash`（大小模型都指向它）→ **无需 `/login`** |

| 现象 | 原因 | 处理 |
|---|---|---|
| opencode 报 `Cannot connect to API` | 默认模型指向了不可达的 provider（例如局域网模型机 `192.168.137.2`） | 用可达模型：`opencode run -m deepseek/deepseek-flash "…"`；或把默认值写回 `~/.config/opencode/opencode.json` |
| claude 报 `Not logged in · Please run /login` | `~/.claude/settings.json` 被覆盖（例如 CC Switch 切回了 Official） | 重新写入 DeepSeek 的 `env` 块，或用 `claude --settings` 指定；只有切回 Anthropic 官方时才需要登录 |
| `claude --version` 打出的不是 `(Claude Code)` | PATH 上有同名的桌面版 `claude.exe`，Node 侧会先解析到它，`agent check` 因此**误报 available** | 把桌面版目录从 PATH 移除；正确的解析结果是 `claude --version` 含 `(Claude Code)` |
| claude 的 stderr 出现 `no stdin data received in 3s` | 平台用管道拉起 CLI、但没关闭 stdin，claude 会等 3 秒 | 无害，只是每次调用多 3 秒；`[claude-code:unrecognized_model]`（会话起标题）同理 |

> 模型优先级：`--model` → `.cometflow/config.yaml` 的 `agents.<id>.model` → `model` → Agent 自己的默认值。
> `change run` / `cometflow run` / `daemon start` 三条路径口径一致（Builder 用哪个模型会写进
> `change journal` 的 `run-started` 事件）。演示时建议在项目里显式写死模型，避免"换台机器结果不一样"；
> 本机两个 Agent 的默认值已经指向官方 DeepSeek V4 Flash。

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

预期结果：**10 类 present、2 类 absent**（`pages` 因为前端复用现有管理平台而缺席，
`capability` 由拆解派生）。同时会自动建出 `specs/flows/` 目录。

```bash
cometflow spec scaffold --list .
```

> 交互式 `init` 必须在**真实终端**里跑：向导每次提问都会新建一个 readline 实例，
> 用管道喂答案会在第二问后静默退出。

---

## 2. 贴 spec 与判据

把种子里的 `COMETFLOW.md`、`specs/`、`tests/` 覆盖进去（会盖掉 `init` 生成的骨架文件）：

```bash
cp -r <cometflow 仓库>/experiments/cbb-emergency-access/COMETFLOW.md .
cp -r <cometflow 仓库>/experiments/cbb-emergency-access/specs/* specs/
cp -r <cometflow 仓库>/experiments/cbb-emergency-access/tests .
```

种子包含 13 个 spec 文件 + 一份判据执行器：

| 文件 | kind | 关键内容 |
|---|---|---|
| `specs/models.md` | models | 6 个实体 + 8 个枚举 + 3 个状态机 |
| `specs/protocol.md` | protocol | 服务入口（进程 / 模块两种形态）+ 6 个请求头 + 9 个状态码 |
| `specs/errors.md` | errors | 18 个错误码 |
| `specs/config.md` | config | 19 个配置键，含验收接缝（`auth.mode`、`tunnel.forwarder_module`、`guard.now`） |
| `specs/rules.md` | rules | 越权不可绕过、一次性令牌、禁止自审、熔断、来源收敛 |
| `specs/constraints.md` | constraints | 安全 / 审计 / **可判定性** / 性能 / 高可用 / 部署 / 离线 |
| `specs/permissions.md` | permissions | 4 个角色 × 8 个 API 的权限矩阵 |
| `specs/processes.md` | process | 3 个常驻进程：会话守卫、过期清理、告警投递 |
| `specs/access/spec.md` | capability | 申请 / 审批 / 吊销 / 查询（4 个 anchor，A1–A8） |
| `specs/tunnel/spec.md` | capability | 开通道 / 关通道（2 个 anchor，A9–A13、A18） |
| `specs/guard/spec.md` | capability | 回收扫描（1 个 anchor，A14–A15） |
| `specs/audit/spec.md` | capability | 审计导出（1 个 anchor，A16–A17） |
| `specs/flows/emergency-access.md` | flow | 一次完整应急接入的 6 步场景 |
| `tests/acceptance.mjs` | 判据执行器 | `node tests/acceptance.mjs A1`；外部依赖用 `tests/fixtures/` 的替身 |

写 capability spec 的两条硬规则：

1. **一个接口一个 `## METHOD /path`**——它就是 anchor，`plan generate` 一个 anchor 出一个任务。
2. 接口内部的说明用 `### 小标题`（如 tunnel 的 `### 转发器适配器`）——解析器只在整份文件
   **没有二级标题**时才把三级标题当 anchor，所以子标题不会多拆出垃圾任务；
   `### Acceptance` 里的验收项归属它上面那个 anchor。

> 判据先于实现：此刻 `src/` 还不存在，`node tests/acceptance.mjs A1` 会明确报
> 「缺少实现：src/server.mjs 尚不存在或无法加载（spec 先行的种子项目的预期状态）」。
> 这不是失败，是提醒你「契约已经把怎么算通过写清楚了」。

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
调度顺序：G1 → G2 → G3 → 其余按编号升序
spec validate: OK
```

`spec validate: OK` 意味着这些跨文件引用**全部解析成功**：

- capability 里 `错误码：E_GRANT_ALREADY_USED` → 在 `errors.md` 找到
- capability 里 `模型：AccessGrant` → 在 `models.md` 找到
- capability 里 `协议头：X-Operator-Token`、`状态码：409` → 在 `protocol.md` 找到
- flow 里 `调用 POST /api/emergency/tunnel/close` → 在 `tunnel/spec.md` 找到对应 anchor
- flow / process 里 `配置：tunnel.forward_to_port` → 在 `config.md` 找到
- `permissions.md` 矩阵里的 8 条 API 路径 → 与 capability anchor 全部对得上

而且**没有一条 `acceptance-without-check` 警告**——每条验收都带可执行判据，
这正是这个种子能进无人值守模式的前提。

> 现场看点：把 `specs/errors.md` 里的 `E_GRANT_ALREADY_USED` 改名，再跑 `spec validate`，
> 立刻会报 `ERROR unresolved-error-reference`。契约是机器可校验的，这是这个平台与其他
> 「文档驱动」方案的核心差别。

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

实测输出（G1 为例）：

```text
wrote .../.cometflow/plans/G1.task-plan.yaml
plan review: 未知的 plan_review 值「high-risk」，策略 high-risk 的高风险识别规则尚未实现，按 human 处理（停在 draft）
plan validate: OK
wrote .../.cometflow/plans/G1.task-plan.yaml
wrote .../.cometflow/plans/G1.task-plan.yaml
```

> `plan review` 这一行来自拆解审核策略（ADR 0003）：`.cometflow/config.yaml` 里
> `plan_review` 默认是 `high-risk`，高风险的识别规则尚未实现，因此按 `human` 兜底——
> **停在 draft，由人 review / approve**。想让机器校验通过就自动放行，把它改成 `auto`。

实测结果：**3 个目标 → 8 个任务**，acceptance 各自落位。

| 目标 | 任务 | anchor | acceptance |
|---|---|---|---|
| G1 | T1 | `POST /api/emergency/access/request` | A1, A2, A3 |
| G1 | T2 | `POST /api/emergency/access/approve` | A4, A5, A6 |
| G1 | T3 | `POST /api/emergency/access/revoke` | A7 |
| G1 | T4 | `GET /api/emergency/access/status` | A8 |
| G2 | T1 | `POST /api/emergency/tunnel/open` | A9, A10, A11, A18 |
| G2 | T2 | `POST /api/emergency/tunnel/close` | A12, A13 |
| G2 | T3 | `POST /api/emergency/guard/sweep` | A14, A15 |
| G3 | T1 | `GET /api/emergency/audit/export` | A16, A17 |

> 讲解点：**人没有手写任务清单**。任务是从「目标范围 → capability spec → 每个 anchor」推出来的；
> 权限矩阵里的 8 条 API、flow 里的 6 个步骤，都能对上这 8 个 anchor。

> ⚠️ 坑：`plan generate` 是**重生成**——对已冻结的计划再跑一次，它会退回 draft，
> 之前的 approve / freeze 与 acceptance 绑定都作废。改完 spec 要重新绑定，用
> `cometflow plan regenerate <goal> . --preserve-approved`（见第 8 节）。

---

## 5. 单个 change 执行（现场主要看点）

以 G1 的 T1（发起申请）为例：

```bash
cometflow change new access-request --goal G1 --task T1 .
cometflow change transition access-request confirm-acceptance .
cometflow change run access-request . --agent opencode
```

```text
created change access-request phase=shape
wrote .../changes/access-request/comet-state.yaml phase=build archived=false
change access-request phase=verify agentExit=0
```

`change run` 会把任务推进到 `verify`：Builder 拿到的提示词里已经包含**冻结版本的 spec 段落**与
`## Acceptance（全部条目）`，因此不需要再手工把验收贴进 `brief.md`（`brief.md` 现在只承载任务的
一句话目标与 DoD）。

> 没有可用 Agent 时，`--agent mock` 只走状态机、不产生代码；此时验收会是红的——
> 这正是下一小节要展示的「不可自证完成」。

### 5.1 独立验收：判据红 → 绿

实现在位之前跑 `change verify`，结论是「判据是红的」：

```text
FAILED A1 [check] check exited with code 1 [node tests/acceptance.mjs A1]
FAILED A2 [check] check exited with code 1 [node tests/acceptance.mjs A2]
FAILED A3 [check] check exited with code 1 [node tests/acceptance.mjs A3]
change access-request phase=build reportPassed=false verifier=(none) repair_attempts=1
```

阶段自动退回 `build`（可修复循环），这就是「Builder 不能自证完成」。
Agent 把实现补齐后再跑，就变成绿的：

```text
PASSED A1 [check] check passed [node tests/acceptance.mjs A1]
PASSED A2 [check] check passed [node tests/acceptance.mjs A2]
PASSED A3 [check] check passed [node tests/acceptance.mjs A3]
change access-request phase=archive reportPassed=true verifier=(none) repair_attempts=0
```

```bash
cometflow change archive access-request .
cometflow change journal access-request .   # append-only 审计：每一步都留痕
```

```text
change access-request archived=true
```

判定来源在方括号里：`[check]` 是 spec 里的可执行判据（机器事实），
`[document]` 是 `verification.yaml` 里的人工/独立 Verifier 结论，`[agent]` 是独立 Verifier Agent。

> `change verify` 只能在 `verify` 阶段跑。如果手写了 `verification.yaml` 想直接验，
> 先确认阶段：`change run` 之后是 verify；没有 Agent 时用
> `cometflow change transition <name> submit-candidate .` 手动推进到 verify。
> 否则会看到 `change verify requires verify phase`。

### 5.2 模块边界是硬约束（值得现场演一次）

每个 capability spec 的 front-matter 声明了实现落在哪个模块（`module: src/access` 等），
跨 capability 共享的文件在 `COMETFLOW.md` 的 `## 模块归属` 里声明（`src/server.mjs`、`src/store.mjs`、
`tests`、`package.json`）。改到模块外的文件，验证会直接拒绝：

```text
unattributed changes: src/audit/index.mjs, src/guard/index.mjs, src/tunnel/index.mjs
change access-request phase=build reportPassed=false
```

> 现场演示时这也是「预跑兜底产物」的用法提醒：要在 `change new` **之前**把实现放进项目，
> 或者只放该任务模块内的文件。放到之后，平台会（正确地）判定你越界了。

### 5.3 用参考实现兜底（可选）

时间不够或现场没有可用 Agent 时，种子自带一份参考实现：

```bash
cp -r <cometflow 仓库>/experiments/cbb-emergency-access/reference/src .
```

把它放在 `change new` 之前（或建项目时就放），`--agent mock` 也能把 change 一路推到归档。
它同时被 `test/domains/experiment-cbb-seed.test.ts` 用来证明「这 18 条判据是可满足的」。

---

## 6. 无人值守：daemon 调度（第二个主要看点）

同一个项目、同一批冻结任务，交给调度器：

```bash
cometflow daemon queue rebuild .    # 先看待办与顺序
cometflow daemon start . --agent opencode --budget 1800000 --interval 2000
```

实测输出（队列）：

```text
调度顺序：G1 → G2 → G3 → 其余按编号升序
daemon queue rebuild: queued=7 running=0 done=1 failed=0 delivered=1
   #1 G1:T1 done delivered access-request
   #2 G1:T2 queued derived
   #3 G1:T3 queued derived
   #4 G1:T4 queued derived
   #5 G2:T1 queued derived
   #6 G2:T2 queued derived
   #7 G2:T3 queued derived
   #8 G3:T1 queued derived
```

实测输出（调度）：

```text
daemon 1 G1:T2 delivered change=G1-T2 已归档；应用 spec 变更 0 个
daemon 2 G1:T3 delivered change=G1-T3 已归档；应用 spec 变更 0 个
...
daemon 7 G3:T1 delivered change=G3-T1 已归档；应用 spec 变更 0 个
daemon 7 no-queued-task stop
daemon: reason=no-queued-task iterations=7
```

讲解点：

1. **顺序**：`COMETFLOW.md` 的 `## 调度顺序` 决定谁先跑（跨 goal 的唯一排序手段）；
   没列出的按编号升序排在后面。这里 G1 → G2 → G3，正是因为 G2 的通道要用 G1 的授权。
2. **准入**：无人值守前会先做「验收能不能被自动判定」的前置检查。如果某条验收既没有
   `- check:`、也没有 eval / 独立 Verifier 兜底，daemon 会**直接停机**并报 `unverifiable`，
   把预算留给人工补判据，而不是白跑一轮。本种子的 18 条验收全部有 check，所以能一路跑完。
3. **执行**：每个任务都是一次完整的 change 生命周期（run → check → verify → archive），
   归档时把变更层的 spec 一起落地。
4. **并发**：`--concurrency <n>` 开多槽位（ADR 0028）；冲突的任务按 module 归属串行，
   写保护守卫在位时会拒绝并发（避免两个 Agent 同时写同一模块）。
5. **常驻**：`cometflow serve` 可以把调度器嵌进来常驻（ADR 0027），在 Web 的调度面板上看队列、
   预算、并发槽位与「调度顺序」卡。

> 现场提速：用 `--agent mock` 配合预跑的参考实现，7 个任务实测半分钟左右跑完；
> 用真实 Agent 时每个任务通常需要几分钟，建议提前跑好，现场只放一个。

---

## 7. 变更随工单一起落地

变更层 `changes/<名>/specs/` 支持三类目标，归档时一并落地：

| 变更层路径 | 落地到 |
|---|---|
| `specs/<capability>/spec.md` | `specs/<capability>/spec.md` |
| `specs/flows/<name>.md` | `specs/flows/<name>.md` |
| `specs/<根级 kind>.md`（models / protocol / errors / config / constraints / permissions / rules / processes / pages） | `specs/<同名文件>` |

实测：

```bash
mkdir -p changes/notify/specs/notify
cp specs/errors.md changes/notify/specs/errors.md
# 再放一个新增 capability：changes/notify/specs/notify/spec.md
cometflow change archive notify .
```

```text
applied specs/errors.md
applied specs/notify/spec.md
change notify archived=true
```

> 行为要点：不认识的路径会**直接报错且不推进归档状态**，避免「半途而废但看着像成功」。

---

## 8. 修改已有功能

以「把空闲超时从 5 分钟改成 3 分钟，并追加一条验收」为例：

```bash
# 1) 改 spec：specs/config.md 调整默认值；specs/tunnel/spec.md 追加一条 acceptance（带 check）
cometflow spec validate .
cometflow spec diff .     # modified: specs/config.md, specs/tunnel/spec.md
cometflow spec drift .    # 报出受影响的已冻结任务

# 2) 重新绑定（不要用 plan generate，它会把计划重置回 draft）
cometflow plan regenerate G2 . --preserve-approved
cometflow plan validate G2 .
cometflow plan approve G2 .
cometflow plan freeze G2 .

# 3) 用新契约开新工单（名字不要复用已归档的）
cometflow change new tunnel-open-v2 --goal G2 --task T1 .
```

> 硬约束：执行阶段不再重新解释 spec。改动必须先在 `specs/` 落地并重新冻结，
> 新工单才会拿到新的 acceptance 与新的 `spec_hash`。

---

## 9. 收尾：把过程展示出来

```bash
cometflow doctor .                 # 健康检查（会提示 hook / 证据回收 / 并发策略）
cometflow change list --all .      # 交付账本
cometflow metrics .                # 重建质量与 spec 健康度
cometflow gate check .             # 规格门禁（与 CI 同一实现）
cometflow serve                    # 完整 Web 客户端
```

几个容易踩的点：

| 能力 | 现状与注意 |
|---|---|
| 写保护 hook | 只有 `claude-code` 有可依据的 hook 契约：`cometflow hook install --platform claude-code`；`opencode` / `codex` 会明确报 unsupported（不猜格式，避免静默失效） |
| 门禁基线 | 新项目第一次跑 `gate check` 会因缺少 `metrics-baseline.json` 失败，先 `cometflow gate check . --update-baseline` |
| git 门禁 | 演示项目通常不是 git 仓库，命令会打印 `git: not-a-repo — 跳过来源校验`；`git init` 之后归档会要求工作区已提交、历史未漂移（必要时 `--allow-drift`） |

---

## 10. 时间轴建议

| 分钟 | 内容 |
|---|---|
| 0–4 | 讲场景与设计红线：为什么不做隐藏触发 |
| 4–8 | 步骤 1–3：`init --interactive` 裁剪 → 贴 spec 与判据 → `spec validate` 现场改错 |
| 8–12 | 步骤 4：3 个目标拆出 8 个任务，展示权限矩阵与 anchor 的对应关系 |
| 12–20 | 步骤 5：真实 Agent 跑 `access-request` + 独立验收红→绿 + 归档（含模块边界那次拒绝） |
| 20–26 | 步骤 6：`daemon queue rebuild` 看顺序 → `daemon start` 无人值守跑剩余任务 |
| 26–28 | 步骤 7–8：spec 变更随工单落地 + `diff`/`drift`/`regenerate` 治理 |
| 28–30 | `serve` 看板收尾 |

---

## 11. 注意事项

| 风险 | 兜底 |
|---|---|
| 现场没有 opencode / claude-code | 用 `--agent mock`；要看到绿色结论就先贴 `reference/src`（必须在 `change new` 之前） |
| Agent 没实现完 | 这正是看点：`change verify` 判 fail → 退回 `build`，展示「不可自证完成」 |
| `change verify` 报 `requires verify phase` | 先 `change run`，或 `change transition <name> submit-candidate .` |
| `change verify` 报 `unattributed changes` | 改动落到模块外了：移回 `module` 内，或在 `COMETFLOW.md` 的 `## 模块归属` 里声明共享路径 |
| daemon 报 `unverifiable` | 该任务的验收没有可执行 check；补 `- check:`，或把 `verification.unattended_preflight` 设为 `warn`（仅人工在场时） |
| 重复跑了 `plan generate` | 计划被重置回 draft；改用 `plan regenerate --preserve-approved` 重新绑定 |
| `init --interactive` 卡住 | 必须在真实终端运行，不要用管道喂输入 |
| 运行环境 | 判据用 Node 24 内置 `node:sqlite`（种子的运行环境声明）；更老的 Node 会在装载 `node:sqlite` 时失败 |
| 端口冲突 | `dashboard` 与 `serve` 默认都是 `4321`，用 `--port` 分开 |
| 演示产物污染版本库 | `.cometflow/` 已 gitignore；`changes/`、`evolve/`、`reports/` 按需自行忽略 |

---

## 12. 附：演示前 5 分钟自检

```bash
set -e
cometflow doctor .
cometflow spec drift .
cometflow plan trace G1 .
cometflow change list --all .
node tests/acceptance.mjs          # 18 条判据应当全绿（实现已在位）

# 注意：spec validate / plan validate 即使 FAILED 也返回退出码 0，
# 所以必须抓输出文本判断，不能只靠 set -e。
for check in "spec validate ." "plan validate G1 ."; do
  out=$(cometflow $check); echo "$out"
  echo "$out" | grep -q "OK" || { echo "precheck failed: cometflow $check"; exit 1; }
done

echo "demo precheck: OK"
```
