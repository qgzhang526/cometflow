# 平台侧后续计划（四项）

状态：待开始
来源：H1–H3 加固、度量批次、CI 门禁之后的排序结论
前置依赖：[ADR 0012](../decisions/0012-spec-version-as-artifact.md)–[ADR 0018](../decisions/0018-current-change-routing.md)、[metrics-plan.md](./metrics-plan.md)、[ci-plan.md](./ci-plan.md)

## 排序与理由

前面三批解决的是「spec 是不是可信的根源」；这一批解决的是「这套约束由谁执行、在什么条件下执行」。

| 顺序 | 方向 | 解决的问题 | 成本 | 依赖 |
|---|---|---|---|---|
| A | 独立验证默认化 | 谁在判 | 中 | 度量（已就绪）——用来衡量引入 Verifier 的收益与代价 |
| B | hook 真正接线 | 谁在拦 | 中高 | 需要 A 的度量来证明拦截有效 |
| C | 并发写锁 | 谁在写 | 中 | 无；若 serve 已成为日常入口，可提到 B 之前 |
| D | 调度器健壮性 | 谁在跑 | 中高 | 复用 H1 的原子写与 H3-1 的停机语义 |

一句话：**A 让判据完整，B 让约束生效，C 让并发安全，D 让长跑可靠。**

---

## A. 独立验证默认化

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

---

## B. hook 真正接线

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

---

## C. 并发写锁

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

## D. 调度器健壮性

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

---

## 里程碑

| 里程碑 | 内容 | 完成标志 |
|---|---|---|
| N1 | A 落地 | 未配置项目行为不变（逐字对比）+ 配置后 `verdict_sources.agent > 0` |
| N2 | B 落地 | 真实 agent 会话中被平台 hook 拦下一次越界写入；卸载后配置逐字还原 |
| N3 | C 落地 | 并发 transition 只有一个成功；陈旧锁可回收 |
| N4 | D 落地 | kill 后重启可恢复；失败有上限；预算累计；超时生效 |

## 完成定义（DoD）

与前三批一致：

1. 有单元测试，且**覆盖失败路径**；
2. 在 `scripts/regression.mjs` 增加回归场景（跨平台可跑）；
3. 用户可见行为变化更新 `docs/USAGE.md` 与对应 ADR；
4. 回填本计划与 [012-comet-borrowings.md](../design/012-comet-borrowings.md) 的状态。
