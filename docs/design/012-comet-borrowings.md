# 012 从 comet 借鉴的机制与落地评估

状态：已实施（第 1–7 项）/ 建议后续（第 8–16 项，开发计划见 [comet-hardening-plan.md](../plan/comet-hardening-plan.md)）
日期：2026-09-14
对照项目：`D:\zqg\github\comet`（comet Native / Classic 工作流）

## 方法

逐条比对 comet 已经在生产中使用、而 CometFlow 只有约定或完全缺失的机制，按「对『spec 即根源』的贡献度」排序。
本文只收录有明确落点的机制；被判定不适合 CometFlow 的也一并列出理由，避免反复讨论。

## 一、已落地

| # | comet 机制 | comet 位置 | CometFlow 落点 |
|---|---|---|---|
| 1 | acceptance 必须提供可验证证据 | `native-verification-evidence.ts`、`comet-guard.mjs` 的 `verify-pass` 前置 | `- check: <command>` 写进 spec，`domains/workflow/change-checks.ts` 真跑命令 |
| 2 | 实现范围归属与未归属项 | `native-implementation-scope.ts`（`declaredArtifacts` / `attributedTo` / `unresolvedScopes`） | `domains/workflow/implementation-scope.ts`，verify 与 archive 双重闸门 |
| 3 | Builder 不能自证，Verifier 独立且覆盖度精确 | `native-verifier-protocol.ts` | `domains/workflow/change-verifier.ts`，逐条 passed/failed/blocked + 无重复/未知/遗漏 |
| 4 | 状态迁移追加式审计流水 | `domains/comet-classic/classic-state-events.ts`（`state-events.jsonl`） | `domains/workflow/change-journal.ts`（`journal.jsonl`） |
| 5 | 归档事务可回滚 | `native-archive-transaction.ts`（staged / backups / commit） | `applyProposedSpecs` 的 stage→commit→rollback，`doctor` 检测未完成事务 |
| 6 | 内容哈希作为身份 | `native-canonical-hash.ts`（`canonicalHash(tag, value)`） | `domains/spec/spec-hash.ts` + 内容寻址版本仓（011） |
| 7 | 有界文件读取与容量上限 | `native-bounded-file.ts`、`native-contract-files.ts` | `MAX_SCOPE_FILE_BYTES` / `MAX_SCOPE_FILES`、验收检查输出截断 |

### 1. 可执行验收（最有价值的一条）

comet 的 Guard 不允许在缺少验证证据时推进 `verify-pass`。CometFlow 把它具体化为 spec 语法：

```markdown
## Acceptance

- A1：验证码正确时可以登录
  - check: go test ./internal/auth -run TestEmailLogin
- A2：验证码错误返回 401
  - check: go test ./internal/auth -run TestWrongCode
```

判定优先级：`check`（机器事实，任何人不能推翻）→ 独立 Verifier → `verification.yaml` → 项目 eval → blocked。
这条规则让「重新生成的代码能不能用」有客观答案，而不是靠印象。

### 2. 实现范围（模块化从声明变强制）

comet 用 `declaredArtifacts` + `attributedTo` 回答「这次改动归属哪个工件」，未归属项进入 `unresolvedScopes`，归档前必须清零。
CometFlow 简化为：

- change 创建时对工作区做一次快照（排除 `.git` / `node_modules` / `.cometflow` / `specs/` 等）；
- `module`（来自 spec front-matter）内的改动算归属，`scope.allow` 是显式例外；
- `change verify` 与 `change archive` 都拒绝「有越界改动」的 change；
- hook guard 在 build 阶段直接拒绝写模块外的文件。

结果：spec 声明模块 → 任务继承模块 → 提示词限定模块 → 写入被拒 → 归档被拒，五个环节同一份事实。

### 3. 独立 Verifier

comet 的 Native 流程里 Build 只提交实现交接，Verifier 是独立只读会话，必须逐条给出结论，缺失/重复/未知一律不能通过。
CometFlow 的 `verification.mode` 提供三档：

| 模式 | 行为 |
|---|---|
| `checks`（默认） | 只跑确定性检查，离线可用 |
| `checks+agent` | 检查 + 独立 Verifier 复核未覆盖项；agent 不可用时降级 |
| `agent-required` | 必须由独立 Verifier 给出完整结论，不可用即失败 |

无论哪档，**失败的 check 不能被 Verifier 判成通过**。

## 二、建议后续（未实施）

| # | comet 机制 | 状态 | 落点 / 说明 |
|---|---|---|---|
| 8 | 结构化状态用 `canonicalHash(tag, value)` | 已落地 | `domains/state/canonical-hash.ts`；计划与 change 状态盖 `plan_hash` / `state_hash`，`spec verify` 校验 |
| 9 | 快照 manifest 记录 omission | 已落地 | `implementation-scope.ts` 记录 path/reason/size，明细超 200 条折叠为计数与哈希；`scope.omission_policy` 决定 warn/fail |
| 10 | 有界修复循环 + 停滞检测 | 待办（H3） | `verify-fail` 现在无条件回 build，可能反复失败 |
| 11 | 两阶段状态迁移日志 | 已落地 | `domains/workflow/change-transition-journal.ts`；prepare → 写状态 → 记账 → 清记录，读取前自动收敛 |
| 12 | 原子写入（fsync + rename） | 已落地 | `platform/fs/atomic-write.ts`；rename 在 Windows 上做有界重试，`doctor` 报告并清理残留 |
| 13 | 凭证脱敏 | 已落地 | `platform/io/redact.ts`；提示词用高置信档，落盘证据额外启用通用键值档 |
| 14 | git 来源绑定 | 待办（H3） | 记录 change 的 base commit，分支漂移时阻止推进 |
| 15 | Hook Router 单一归属 | 待办（H3） | 我们用「有多个 active change 就拒绝」，comet 用 current-change 指针路由 |
| 16 | 证据保留上限 | 已落地 | journal 超阈值轮转（保留一代）+ `change gc [--apply]` 回收 runtime 证据，doctor 报告占用 |

## 三、明确不照搬

| comet 机制 | 不采用的理由 |
|---|---|
| OpenSpec / Superpowers Skill 生态与多平台安装矩阵 | CometFlow 的定位是平台内核，不承担技能分发；Skill/Bundle 已有自己的最小实现 |
| Native 的 `artifact_root` 可配置 | `specs/` + `COMETFLOW.md` 是 CometFlow 的固定契约路径，可配置会削弱「唯一事实源」 |
| PR finish 自动化（gh/PR 模板策略） | 属于仓库策略而非 spec 内核，留给用户自己的 CI |
| Classic 五阶段 + 状态爆炸（30+ 字段） | 与 CometFlow 的四阶段 change 模型冲突，收益不足以改写状态机 |

## 四、结论

comet 对 CometFlow 最大的价值不是代码，而是三条已经被验证过的判断：

1. **验收必须由机器证据支撑**，否则再漂亮的工作流也会被自证通过；
2. **范围必须可归属、可判定**，否则「模块化」永远只是提示词里的请求；
3. **状态迁移必须留下不可变记录**，否则断点恢复与事后审计都无从谈起。

这三条现在已经进入 CometFlow 的代码路径，第 8–16 项是同一方向上的继续加固。
