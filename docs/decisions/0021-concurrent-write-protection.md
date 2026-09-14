# ADR 0021：并发写保护——单文件 CAS + 多文件事务锁，`warn` 是有期限的过渡态

状态：已批准（决策已定，实现随 [web-ui-followup-plan.md](../plan/web-ui-followup-plan.md) 的 N4 落地）
日期：2026-09-14
关联：ADR 0001（spec 单一事实源）、ADR 0012（spec 版本即产物）、ADR 0014（原子与可恢复状态）、
[platform-next-plan.md](../plan/platform-next-plan.md)

## 背景

CLI 与 serve 是两个进程，各自「读旧内容 → 写新内容」，后写的会静默覆盖先写的（last-write-wins）。
ADR 0014 的原子写只保证「不半写」，不保证「不互相覆盖」；`workspace.json` 在 W1 加了进程内互斥，
但那只在一个进程内有效。spec 尤其敏感：它是唯一事实源，被静默覆盖等于契约被悄悄改写。

## 决策

1. **单文件乐观 CAS**：写入前记录目标文件的内容哈希，提交前再比对一次，不一致则按下面的策略处理。
   覆盖范围是**事实源文件**：`specs/**`、`.cometflow/plans/*.yaml`、`changes/<name>/comet-state.yaml`、
   `.cometflow/config.yaml`、`.cometflow/spec-lock.json`；派生产物（`web/dist`、`node_modules` 等）不在内。
2. **多文件事务加锁**：涉及多文件一致性的动作（`applyProposedSpecs`、`plan freeze`、`spec restore`、
   UI 批量写）先取 `.cometflow/runtime/lock`（内容 `{ pid, host, started_at, action }`，TTL 默认 120s）。
   取不到锁立即失败并说明持有者；滞留锁由 `doctor` 报 error 并给 `--force-unlock`（人工确认后清理）。
   agent 运行期间不持锁——它只写 `changes/<name>/`，不需要占用全局窗口。
3. **`warn` 是有期限的过渡态**：默认 `concurrency.specWrites: warn` +
   `concurrency.warnUntil: <now + 30d>`。warn 阶段冲突照旧写入，但必须**处处留痕**：
   响应体带 `warning`、journal 记 `cas-conflict-warn`、`metrics` 计数、`doctor` 报 warning、UI 顶部横幅。
4. **到期必须显式决策**：`warnUntil` 过后，`doctor` 与 `spec verify` 各报 error
   `concurrency-warn-expired`，CI 的 `spec-gates` 因此失败。出路只有两条：
   切 `fail`（并删掉 `warnUntil`），或显式延长 `warnUntil` 并写下 `warnReason`。延长期本身也会再次到期。
5. **`fail` 是终态**：冲突中止并返回 409 `concurrent-modification`（附路径与两次哈希），
   界面提供「重读并重试」与「确认覆盖」两个动作（确认覆盖要显式，不能默认）。

## 理由

- 真正的风险是「**静默**」而不是「覆盖」：spec 有版本仓，覆盖只是让版本链多一版；
  但用户不知道自己的改动被谁盖掉，这才是问题。
- 直接上 `fail` 会在一开始就卡住日常操作（编辑器每次保存、自己改自己也会命中）；
  先 `warn` 能用真实数据校准误报率，再切 `fail`。
- 「过渡态必须带期限，到期由门禁强制面对」把「以后再说」变成一次有痕的决策：
  只写在文档里的待办会忘，写在 CI 门禁里的不会忘。
- 锁只覆盖多文件提交窗口，不覆盖 agent 运行期，避免用并行度换安全。

## 后果

- 并发写从「静默覆盖」变成「显式失败」（fail）或「显式留痕」（warn）。
- 项目配置新增 `concurrency.{specWrites, warnUntil, warnReason}`；校验规则：`warn` 必须带未来的
  `warnUntil`，`fail` 不允许保留 `warnUntil`。
- `doctor` / `status` / UI 设置页都要暴露「当前策略 + 距到期天数 + 累计 warn 命中数」。
- 过渡期内会看到 warn 命中记录——这正是切换 `fail` 的依据，也是延期时的说明材料。
- 回归夹具与 CI 必须包含到期场景（`warnUntil` 设为过去 → `spec-gates` 退出非零），
  否则「不会忘」这条承诺没有强制力。
