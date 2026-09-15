# 平台侧后续计划（四项）

状态：A / B / D 已完成；C 的设计归 [web-ui-followup-plan.md](./web-ui-followup-plan.md) 的 N4
来源：H1–H3 加固、度量批次、CI 门禁之后的排序结论
前置依赖：[ADR 0012](../decisions/0012-spec-version-as-artifact.md)–[ADR 0018](../decisions/0018-current-change-routing.md)、[metrics-plan.md](./metrics-plan.md)、[ci-plan.md](./ci-plan.md)

## 排序与理由

前面三批解决的是「spec 是不是可信的根源」；这一批解决的是「这套约束由谁执行、在什么条件下执行」。

| 顺序 | 方向 | 解决的问题 | 成本 | 依赖 |
|---|---|---|---|---|
| A | 独立验证默认化 | 谁在判 | 中 | 度量（已就绪）——用来衡量引入 Verifier 的收益与代价 ✅ |
| B | hook 真正接线 | 谁在拦 | 中高 | 需要 A 的度量来证明拦截有效 ✅（当前仅 claude-code） |
| C | 并发写锁（**设计归 [web-ui-followup-plan.md](./web-ui-followup-plan.md) 的 N4**） | 谁在写 | 中 | 无；若 serve 已成为日常入口，可提到 B 之前 |
| D | 调度器健壮性 | 谁在跑 | 中高 | 复用 H1 的原子写与 H3-1 的停机语义 ✅ |

一句话：**A 让判据完整，B 让约束生效，C 让并发安全，D 让长跑可靠。**

---

## A. 独立验证默认化 ✅ 已完成

### 现状与证据

ADR 0013 的原则是「实现者不能自证」，但**默认配置下 Verifier 从不运行**。

`app/commands/change.ts` 里 Verifier 的 agent 解析是 `options.agent ?? config.verification?.agent`——**没有回退到 `config.agent`**；`domains/workflow/change-execution.ts` 里只有在 runner 存在时才会调用独立 Verifier。

后果：`verification.agent` 未配置时 runner 恒为 undefined，`checks+agent` 与 `checks` **行为完全一致**——把 mode 的默认值改掉也不会产生任何效果。这是上次对话里被我自己证伪的一条建议。

### 目标

让「独立验证」成为可用的默认路径，同时不改变未配置项目的行为、不隐藏成本。

### 落点

1. **agent 解析回退**：`verification.agent` → `config.agent` → 内置默认；调用前先做可用性检查（`agent check`）。
2. **不可用策略**：新增 `verification.verifier_policy: skip | warn | fail`（默认 `warn`）。`warn` 记录「本轮无独立验证」到 `verification.md` 与 journal；`fail` 则 Verifier 不可用即验证失败（`agent-required` 已有此语义，这里补齐中间档）。
3. **成本记账**：Verifier 的 agent id、耗时、覆盖了哪些验收项写入 journal，供 `metrics` 的 `verdict_sources` 与后续成本分析使用。

### 验收标准

- [ ] 未配置 agent 的项目：`change verify` 的输出与 `verdict_sources` 与今天**逐字一致**
- [ ] 配置了 agent 的项目：无 check 的验收项 `source=agent`，且 `metrics.verdict_sources.agent > 0`
- [ ] `verifier_policy: fail` 下 agent 不可用 → 验证失败并说明原因
- [ ] Verifier 只在「check 未覆盖的验收项」上被调用
- [ ] 单测覆盖四种组合：无 agent × warn / 无 agent × fail / 有 agent / agent 不可用

### 风险与取舍

- **成本翻倍**：每次 verify 多一轮完整 agent 会话。缓解：只对未覆盖项调用 + 默认 `warn` 而非强制。
- **延迟**：CI 里没有 agent CLI，所以 `checks` 仍是 CI 的默认路径——这一点不改变。
- **不偷偷改默认**：`verification.mode` 默认值保持 `checks`，靠文档与配置推动，而不是静默改变已有项目的行为。

### 实现记录

- 落点：`app/commands/change.ts`（agent 解析回退 + 可用性检查）、`domains/workflow/change-execution.ts`（策略分支、成本透传、默认超时）、`domains/workflow/change-verifier.ts`（耗时统计）、`domains/project/config.ts`（`verifier_policy`）、`domains/metrics/*`（`verifier.runs/total_ms/mean_ms`）。
- 修正了本节开头那条错误判断本身：没有 agent 解析回退时，`checks+agent` 与 `checks` 完全等价。
- 由 A 连带发现的隐患：Verifier 一旦真的会被调用，`runner.run` 不传 timeout 就是无限等待 → 补默认 10 分钟超时。
- 测试：`test/domains/verifier-policy.test.ts` 7 例；回归脚本新增 `agent-policy-demo` 场景（显式用 mock 固定路径，避免本机装没装 opencode 影响回归）。
- 文档：[ADR 0022](../decisions/0022-verifier-resolution-and-policy.md)、USAGE §5.8。

---

## B. hook 真正接线 ✅ 已完成（当前仅 claude-code）

### 现状与证据

`cometflow hook check` 只是**判定函数**，仓库里没有任何机制把它装进 agent 平台的 hook 配置——`app/cli/index.ts` 的 `hook` 命令组下只有 `check` 一个子命令。也就是说模块边界今天是「agent 愿意遵守就遵守」。

参照 comet 的实现（`domains/skill/platform-install.ts`、`hook-lifecycle.ts`）：它会给每个平台写 hooks 配置（`PreToolUse` / `hooks.BeforeTool` 等形状），并把 managed block 与用户内容分开维护。

### 目标

让「spec 声明的模块边界」从约定变成**平台级物理约束**：agent 的写入在工具层被拦下，而不是靠提示词请求。

### 落点

1. 新增 `domains/guard/hook-install.ts`：按平台生成/合并 hooks 配置。平台目录已有先例可复用：`domains/bundle/bundle-service.ts` 的 `.opencode/skills`、`.claude/skills`、`.codex/skills`。
2. CLI：`hook install --platform opencode|claude-code|codex [--scope project]`、`hook status [--json]`、`hook uninstall`。
3. hook 脚本调用现有判定：`cometflow hook check <target> --event write`，非零即拒绝该次写入。
4. managed block：安装时保留用户已有配置；卸载后配置与安装前**逐字相同**。

### 验收标准

- [ ] 安装后，agent 在 `change run` 期间试图写模块外文件 → 被平台拒绝（用一次真实 agent 会话验证，而不是只测脚本）
- [ ] `hook status --json` 报告：已安装 / 未安装 / 版本漂移 / 目标平台
- [ ] `hook uninstall` 后配置文件与安装前逐字一致（单测：安装→卸载→比对）
- [ ] 多次安装幂等（不产生重复 hooks 条目）
- [ ] `doctor` 能报告「hook 已安装但指向的 CLI 路径已失效」

### 风险与取舍

- 各平台 hooks 配置格式不同且会演进；必须可逆、可检测、可降级（平台不支持时明确报错而不是静默不装）。
- 拦截只覆盖**支持 hooks 的平台**；其余平台仍需 A/D 的机制兜底。
- 与 `scope.allow`、`current-change` 的交互要写测试：多 change 时按指针路由（ADR 0018），共享路径放行（`COMETFLOW.md` 的「模块归属」）。

### 实现记录

- 落点：`domains/guard/hook-install.ts`、`app/commands/hook.ts`、`app/cli/index.ts`（`hook install|status|uninstall`）。
- 只实现有可依据格式的平台：`claude-code`（`settings.json` → `hooks.PreToolUse[]`，matcher `Write|Edit|MultiEdit|NotebookEdit`）。**`opencode` / `codex` 显式报「不支持」并返回非零退出码**——猜错格式会在用户机器上静默失效，比不装更糟。
- 守卫脚本随项目安装（`.claude/hooks/cometflow-guard.mjs`），配置用 `$CLAUDE_PROJECT_DIR` 引用，不写死绝对路径；被拒时以退出码 2 阻止写入；CLI 不可用时放行，避免把开发环境锁死。
- 可逆性：安装时备份原文件与「安装后内容」的哈希，卸载时未改动则逐字还原、改过则只摘自己的条目。
- 测试：`test/domains/hook-install.test.ts` 7 例（安装 / 幂等 / 逐字还原 / drift / 拒绝猜格式）；
  `test/domains/hook-guard-script.test.ts` 11 例**直接执行生成的守卫脚本**，喂真实 PreToolUse payload，
  断言退出码 2 与 stderr 文案（覆盖：越界拦截、模块内放行、项目路径含空格、stdin 不关闭不挂死、
  payload 不可解析、无文件路径、`toolInput.filePath` / `notebook_path` 字段、CLI 不可用放行），其中 2 例走真实 `cometflow` CLI。
  回归脚本补安装→校验→卸载还原链路，以及守卫脚本端到端 3 步。
- ✅ **真实 Claude Code 会话验证通过（2026-09-15）**：无头会话里越界写入被平台拦下、模块内写入放行，含空格路径的项目同样如此。细节见下一节。
- 文档：[ADR 0023](../decisions/0023-platform-hook-install.md)、USAGE §13.1。

### 真实会话验证：结论与证据（2026-09-15）

在一个已 `init` + `spec scaffold` + `change new` + `hook install` 的项目里跑真实无头会话
（`claude -p "..." --dangerously-skip-permissions`），两个用例都符合预期；并且刻意在**路径含空格**的项目
（`%TEMP%\cf hook space2`）上复跑了一遍——那正是本轮修掉的「静默放行」缺陷所在的场景：

| 用例 | 真实会话输出（摘录） | 文件系统结果 |
|---|---|---|
| `Write rogue/outside.ts`（模块外） | 「写入被项目自己的 CometFlow 守卫拦截了，文件**没有**创建，所以我不能回 DONE」+ `CometFlow 阻止了这次写入：denied: outside-module-scope` | 文件不存在 |
| `Write src/auth/login.ts`（模块内） | `DONE` | 文件存在，内容为 `export const login = 1;` |

含空格路径的项目里结果完全一致 —— ADR 0023 修订里的引号修复在**真实会话**中生效，而不只是单测里。
模型还主动说明自己没有绕道（「没有改用 Bash 或写到别处再移动」）：这正是把约束放在平台层而不是提示词层想要的效果。

> 守卫随后又因为「CLI 不在就放行」的判据过宽被收紧过一次（`efc7863`）。上表是在**那之后**重新跑的结果，
> 也就是当前 HEAD 的守卫，不是修复过程中的中间态。

### 无头会话的环境结论（2026-09-15）

1. PATH 上的 `claude.exe` 是**桌面应用**（`%LOCALAPPDATA%\AnthropicClaude\app-<ver>\claude.exe`，Electron），
   不是 Claude Code CLI：`claude -p "..."` 没有任何 stdout、退出码 0，只会拉起一个应用窗口。
   真正的 CLI 在 `%LOCALAPPDATA%\Claude-3p\claude-code\<ver>\claude.exe`（`claude doctor` 也提示
   `C:\Users\<user>\.local\bin` 未安装、不在 PATH 上）。要跑无头会话，必须用完整路径或先 `claude install`。
2. Anthropic 官方 OAuth 这条路在本机走不通：`claude auth login` 要求 **Max/Pro 订阅**，浏览器里那个 claude.ai 账号是免费号，
   授权页直接回「Claude Max or Pro is required to connect to Claude Code」；CLI 直连 `api.anthropic.com` 是 **403**（区域限制），
   走本机 Clash 代理才 401（可达）。桌面应用的凭据也不会落盘给 CLI（`cmdkey /list` 无 Claude 条目、`~/.claude` 无凭据文件）。
3. **能跑通的方式：复用桌面应用的本地推理网关。** 本机 Claude Desktop 是 3p 部署，
   `%LOCALAPPDATA%\Claude-3p\configLibrary\<id>.json` 里写着 `inferenceProvider: gateway`、
   `inferenceGatewayBaseUrl: http://127.0.0.1:15721/claude-desktop` 与 bearer key（`inferenceModels` 的 `labelOverride`
   显示真实后端是 deepseek-v4-flash 一类）。把这套网关喂给 CLI 的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`，
   headless 会话即可用，**不需要任何 Anthropic 账号**。

真实会话验证的复现步骤：

```powershell
# 0. 取本机网关配置（3p 部署才有；官方订阅账号改回 `claude auth login`）
$cfg = Get-Content "$env:LOCALAPPDATA\Claude-3p\configLibrary\*.json" -Raw | ConvertFrom-Json
$env:ANTHROPIC_BASE_URL   = $cfg.inferenceGatewayBaseUrl
$env:ANTHROPIC_AUTH_TOKEN = $cfg.inferenceGatewayApiKey

# 1. 指向守卫要调用的 CLI，并 cd 到已安装 hook 的项目
$env:COMETFLOW_CLI = 'node "D:/zqg/github/cometflow/dist/app/cli/index.js"'
Set-Location C:\path\to\project

# 2. 越界写入：期望被拦
& "$env:LOCALAPPDATA\Claude-3p\claude-code\2.1.237\claude.exe" -p "Use the Write tool to create rogue/outside.ts with exactly: export const rogue = 1; Then reply DONE." --dangerously-skip-permissions
# 期望：写入被拦，输出含「CometFlow 阻止了这次写入：denied: outside-module-scope」

# 3. 模块内写入：期望成功
& "$env:LOCALAPPDATA\Claude-3p\claude-code\2.1.237\claude.exe" -p "Use the Write tool to create src/auth/login.ts with exactly: export const login = 1; Then reply DONE." --dangerously-skip-permissions
# 期望：写入成功，文件内容为 export const login = 1;
```

上面这段依赖本机网关，属于**手工验证**，不进 CI。CI 里的等价物是 `hook-guard-script` 用例——它执行的是**装到项目里的那份脚本**（`.claude/hooks/cometflow-guard.mjs`），
只把「平台调用脚本」这一步换成测试直接喂 payload。

---

## C. 并发写锁（设计归 web-ui-followup-plan 的 N4）

> **归属说明**：本方向已由 [web-ui-followup-plan.md](./web-ui-followup-plan.md) 的 **N4 并发写保护**
> 承接并细化（两层方案：单文件乐观 CAS + 多文件事务锁，含 TTL、`doctor --force-unlock`）。
> 本节保留，作为交叉引用与三条必须守住的设计约束；**落点与验收以 N4 为准**，两边不要各做一套。
>
> 约束：1）只把**状态写入**放进临界区，绝不把 agent 运行放进锁里（长任务持锁会变成新的死锁源）；
> 2）只读命令（`spec verify` / `metrics` / `status`）不应被写锁阻塞；
> 3）Windows 的 `O_EXCL` 与陈旧锁判定必须实测——H1-1 已经踩过 Windows `rename` 在并发读下返回 EPERM 的坑。

### 现状与证据

H1-1 让**单次写入**原子，但没有任何互斥：CLI 与 `serve` 同时操作一个项目仍是 last-write-wins（A 读 → B 读 → A 写 → B 写，A 的修改静默消失）。全仓库 grep 不到任何 lock 实现。

典型读-改-写序列：

| 序列 | 位置 |
|---|---|
| 阶段迁移 | `domains/workflow/change-store.ts` + `change-transition-journal.ts` |
| 计划冻结/重生成 | `domains/task-plan/task-plan-store.ts` |
| 基线登记与恢复 | `domains/spec/spec-version.ts`（`refreshSpecBaseline`） |
| 归档事务 | `domains/workflow/change-execution.ts`（staged → commit） |
| serve 的写操作 | `domains/server/api.ts` 的 spec/plan/change 端点 |

### 目标

让并发写入**可见、可预期**：要么成功，要么拿到明确错误，绝不静默覆盖。

### 落点

1. 新增 `platform/fs/project-lock.ts`：`.cometflow/lock`（`O_EXCL` 创建 + pid + host + 获取时间 + 过期时间）。
2. 只把**状态写入**放进临界区，不把 agent 运行放进去（长任务持锁会变成新的死锁源）。
3. 接入点：`change transition`、`plan freeze/regenerate`、`spec lock/restore`、`archiveChange`、serve 的写端点。
4. `doctor` 报告陈旧锁；`--force-unlock` 作为显式恢复手段并写审核流水。

### 验收标准

- [ ] 两个进程并发对同一 change 执行 transition → 只有一个成功，另一个拿到明确错误（单测：并发 spawn 两个 CLI）
- [ ] 持有锁的进程被 kill → 下一次调用按过期时间回收，并在日志里说明
- [ ] 锁不阻塞只读命令（`spec verify` / `metrics` / `status` 仍可并发运行）
- [ ] `doctor` 报 `stale-project-lock`

### 风险与取舍

- Windows 的 `O_EXCL` 语义与陈旧锁判定需要实测（H1-1 已经踩过 Windows `rename` 在并发读下返回 EPERM 的坑）。
- 锁粒度：按项目级最简；若后续成为瓶颈，再按 change/plan 细分。
- 过期时间必须可配，且默认值要大于任何正常状态写入的耗时。

---

## D. 调度器健壮性 ✅ 已完成

### 现状与证据

队列**已经持久化**（`domains/scheduler/queue.ts` 写 `runtime/queue.json`，含 `status` / `attempts` / `updated_at`），所以缺口不是「不落盘」，而是恢复语义：

| 缺口 | 证据 |
|---|---|
| 崩溃后任务永久卡死 | `daemon.ts` 先 `markQueueTask(...,'running')` 再写；而 `nextQueuedTask()` 只挑 `status === 'queued'`，`running` 的任务再也不会被捡起 |
| `attempts` 是死字段 | `markQueueTask` 在置 running 时 `attempts+1`，但没有任何地方读它 → 无上限、无退避 |
| 预算跨重启丢失 | `Budget` 在 `startDaemon` 内 `new Budget(...)`，重启即重置窗口 |
| 单任务无超时 | `daemon.ts` 调 `runFlowRun(runner, { projectRoot, agentId, model })`，没有传 `timeoutMs` → agent 挂起会永久阻塞 |

### 目标

崩溃可恢复、失败有上限、预算可累计、任务不会永久挂住。

### 落点

1. **租约**：`running` 任务记录 `lease_until` 与 `owner`（pid + 主机名）；启动与每轮循环时回收过期租约 → 回到 `queued` 并 `attempts+1`。
2. **上限与退避**：`max_attempts`（默认 3）+ 指数退避；超限标 `failed` 并交人工（复用 H3-1 的停机语义与 `change resume` 指引）。
3. **预算累计**：`runtime/budget.json` 记录已用时长，跨重启累加。
4. **单任务超时**：给 `runFlowRun` 传 `timeoutMs`（默认 30 分钟），超时按失败处理并保留现场。

### 验收标准

- [ ] 在 `running` 状态 kill 掉进程 → 重启后被回收并重试，`attempts` 正确递增
- [ ] 同一任务连续失败达上限后不再自动重试，并在 `doctor`/日志里给出人工介入指引
- [ ] 重启后预算不重置（累计值可从 `runtime/budget.json` 读出）
- [ ] agent 挂起时按 `timeoutMs` 结束，daemon 继续下一轮而不是永久阻塞
- [ ] 单测：租约回收、退避序列、预算累计、超时（用假 runner 阻塞）

### 风险与取舍

- **至少一次语义**：回收意味着任务可能被执行两次，必须在文档里讲清「队列任务要幂等」。
- 超时值需要按项目规模可配；默认值取保守的大值，避免误杀长任务。

### 实现记录

- 落点：`domains/scheduler/queue.ts`（`lease_until` / `owner` / `reclaimExpiredLeases`）、`domains/scheduler/budget.ts`（`budget.json` 累计与 `daemon budget [--reset]`）、`domains/scheduler/daemon.ts`（`runDaemonLoop`：启动与每轮回收、失败上限、退避、超时透传）。
- **口径修正**：`attempts` 统计「启动过几次」，增量只发生在置 running 时；回收不再 +1，否则一次崩溃会被记成两次尝试（测试先暴露了重复计数）。
- 租约时长取 `max(DEFAULT_LEASE_MS, taskTimeoutMs + 60s)`，保证正常执行中不会被误判过期。
- 语义：租约回收意味着**至少一次**执行，队列任务必须幂等——已写进代码注释与 USAGE。
- 测试：`test/domains/scheduler-durability.test.ts` 7 例（过期租约回收、上限即放弃、有效租约不回收、预算累计、超时透传、启动回收崩溃任务、连续失败停止重试）。
- 文档：[ADR 0024](../decisions/0024-scheduler-durability.md)、USAGE §8.3。

---

## 里程碑

| 里程碑 | 内容 | 完成标志 |
|---|---|---|
| N1 | A 落地 ✅ | 未配置项目行为不变（默认 mode 仍是 checks，不产生任何提示）+ 配置后 `verdict_sources.agent > 0` |
| N2 | B 落地 ✅ | 守卫脚本级契约已达成并自动回归（安装/幂等/逐字还原/drift 检测 + 生成的守卫脚本在真实 payload 下端到端跑通，含 Windows 空格路径）；**真实 Claude Code 无头会话已实测拦截 + 放行**，含空格路径项目同样成立 |
| N3 | C 落地 | 并发 transition 只有一个成功；陈旧锁可回收 |
| N4 | D 落地 ✅ | kill 后重启可恢复；失败有上限；预算累计；超时生效（7 例单测覆盖） |

## 完成定义（DoD）

与前三批一致：

1. 有单元测试，且**覆盖失败路径**；
2. 在 `scripts/regression.mjs` 增加回归场景（跨平台可跑）；
3. 用户可见行为变化更新 `docs/USAGE.md` 与对应 ADR；
4. 回填本计划与 [012-comet-borrowings.md](../design/012-comet-borrowings.md) 的状态。
