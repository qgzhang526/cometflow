# Comet 借鉴加固计划（012 的 9 项）

状态：H1、H2、H3-1 已完成（M1、M2 达成），H3-2/H3-3 待开始
来源：[012-comet-borrowings.md](../design/012-comet-borrowings.md) 第二节「建议后续」
前置依赖：ADR 0012（spec 版本即产物）、ADR 0013（验收可执行且不可自证）

## 目标

把 012 里列出的 9 项借鉴内容落成可交付的工程改动，让「spec 即根源」在**崩溃、并发、长时运行**三种压力下依然成立。
当前实现已经能回答「这一版 spec 是什么、谁改了它、谁验过」；这批改动要回答的是「**进程被杀、磁盘半写、分支漂移、反复失败**时，这些答案还对不对」。

## 排序原则

012 按「单点价值」排序，本计划按「依赖与风险」重排为三个批次：

1. **先让状态可信**：写入原子性与迁移可恢复是所有判定的地基，地基不牢，后面的证据完整性没有意义。
2. **再让证据可信**：快照完整性、脱敏、保留上限决定「判定依据」本身是否可靠。
3. **最后改可见行为**：修复循环、git 绑定、Hook 路由都会改变用户日常操作，放在状态与证据都可信之后。

012 的「建议后续」表使用连续编号 8–16；下面的「价值排序」是按其单点价值重排后的顺序。

| 012 编号 | 机制 | 价值排序 | 批次 | 规模 |
|---|---|---|---|---|
| 12 | 原子写入（fsync + rename） | 5 | H1 ✅ | M |
| 11 | 两阶段状态迁移日志 | 4 | H1 ✅ | M |
| 8 | 规范 JSON 哈希（带域标签） | 1 | H1 ✅ | S |
| 9 | 快照 manifest 记录 omission | 2 | H2 ✅ | S |
| 13 | 凭证脱敏 | 6 | H2 ✅ | S |
| 16 | 证据保留上限 | 9 | H2 ✅ | M |
| 10 | 有界修复循环 + 停滞检测 | 3 | H3 ✅ | M |
| 14 | git 来源绑定 | 7 | H3 | M |
| 15 | Hook Router 单一归属 | 8 | H3 | L |

---

## 批次 H1：写入与状态可靠性

### H1-1 原子写入（012 #12）✅ 已完成

- **目标**：任何状态文件在写入过程中被中断，读到的要么是旧内容、要么是新内容，不存在截断或半写。
- **落点**：新增 `platform/fs/atomic-write.ts`（写临时文件 → fsync → rename → fsync 目录）；替换 `change-store.writeChangeState`、`task-plan-store.writeTaskPlan`、`spec-version.writeSpecHistory`、`implementation-scope` 基线、`change-spec-baseline`、`change-journal` 的追加写入。
- **验收标准**：单测模拟「临时文件已写、rename 前失败」，目标文件保持旧内容且无残留临时文件；`doctor` 能列出孤儿临时文件并提供清理。
- **风险**：Windows 与 Linux 的 rename 覆盖语义不同，需要在两个平台各跑一次回归；目录 fsync 在 Windows 上会失败，需要按平台降级。
- **实现**：`platform/fs/atomic-write.ts`（含 `renameWithRetry` 处理 Windows 的 EPERM/EBUSY），接入 change 状态、任务计划、spec 版本 blob、spec-lock、spec 基线、实现范围基线、审计流水与 project-context。
- **证据**：`test/platform/atomic-write.test.ts`（7 例，含并发读期间不间断、提交前失败保留旧内容、孤儿临时文件识别与清理）。

### H1-2 两阶段状态迁移日志（012 #11）✅ 已完成

- **目标**：`comet-state.yaml` 的每一次迁移都可恢复，崩溃后不需要人工判断「停在哪一半」。
- **落点**：新增 `domains/workflow/change-transition-journal.ts`；`change-transitions.ts` 改为 prepare → apply → continue 三段式；`change-store` 读取时先 settle 未完成迁移。
- **验收标准**：单测在 prepare 之后、apply 之前注入中断，下一次读取能自动补完（或回退）并留下 journal 记录；`doctor` 对滞留的 pending 迁移给出 error。
- **依赖**：H1-1（日志条目本身必须原子落盘）。
- **风险**：迁移从「纯函数 + 覆盖写」变成「有副作用的流程」，需要保证重复执行幂等。
- **实现**：`domains/workflow/change-transition-journal.ts`；`change transition`、`run`、`verify`、`archive` 与 serve API 全部改走 `commitTransition`，`readChangeState` 读取前自动收敛。
- **证据**：`test/domains/change-transition-journal.test.ts`（5 例，含写状态前后两种崩溃、冲突交由 doctor、重复收敛幂等）。

### H1-3 规范 JSON 哈希（012 #8）✅ 已完成

- **目标**：结构化状态有确定的内容身份，可以精确回答「哪一版计划/哪一版 change 状态」。
- **落点**：新增 `domains/state/canonical-hash.ts`（稳定键序 + 域标签，参考 comet `native-canonical-hash`）；`plan freeze` 记录 `plan_hash`；`change new` 记录 `state_hash`；`spec verify` / `change verify` 校验计划与状态未被静默改写。
- **验收标准**：键顺序与空白不同的等价对象得到同一哈希；不同域标签的相同内容得到不同哈希；单测覆盖数组顺序敏感、缺失字段、非 JSON 值报错。
- **风险**：`plan_hash` 的引入会让历史 plan 文件在校验时缺字段，需要像 `anchor_hash` 那样对老数据降级为警告。
- **实现**：`domains/state/canonical-hash.ts`（键序无关、数组保序、域标签分隔、拒绝非 JSON 值）；`writeTaskPlan` / `writeChangeState` 写盘即盖章，`spec verify` 新增 `plan-integrity` 与 `change-state-integrity`。
- **证据**：`test/domains/canonical-hash.test.ts`（9 例，含手工改写被检出、老数据降级）。

### H1 附带修复

- 老 change 没有实现范围基线时，`change scope` 曾把仓库内每个文件都算成「越界新增」；现在明确报告「无法判定实现范围」，不再产出误导性结论。

---

## 批次 H2：证据完整性

### H2-1 快照 manifest 记录 omission（012 #9）✅ 已完成

- **目标**：实现范围快照不再「静默跳过」——跳过什么、为什么跳过、跳过多少，都要有记录。
- **落点**：`implementation-scope.ts` 采集时记录 `omitted: { path, reason, size }[]` 与 `complete: false`；`change scope --json` 暴露；`change verify` 在「声明了 module 且存在 omission」时给出可配置的失败级别。
- **验收标准**：构造一个超过 `MAX_SCOPE_FILE_BYTES` 的文件与一个超过 `MAX_SCOPE_FILES` 的目录，快照记录 omission 且 `complete: false`；`change scope` 打印跳过原因。
- **风险**：仓库较大时 omission 可能很多，输出需要截断策略（与 H2-3 一起设计）。
- **实现**：`implementation-scope.ts` 记录 `omitted[{path,reason,size}]` 与 `omittedCount`；明细上限 200 条，超出折叠为计数与哈希；`scope.omission_policy`（warn/fail）决定是否致命；`change scope` 与 `verify` 都会输出。
- **证据**：`test/domains/evidence-retention.test.ts` 的 omission 三例（超大文件留痕、报告标记不完整、明细折叠）。

### H2-2 凭证脱敏（012 #13）✅ 已完成

- **目标**：journal、Verifier/Builder 提示词、verification.md 中不出现 token、密钥、连接串口令。
- **落点**：新增 `platform/io/redact.ts`；在 `change-journal` 写入、`buildChangePrompt` / `buildVerifierPrompt` 组装、agent stdout 摘要落盘三处统一调用。
- **验收标准**：单测覆盖 `sk-`、`ghp_`、`Bearer `、`AKIA`、`postgres://user:pass@host` 等形态；断言 journal 与 prompt 中不出现原文，且脱敏后的哈希/长度信息仍可用于排查。
- **风险**：过度脱敏会把正常内容改花，需要白名单与最小化匹配范围。
- **实现**：`platform/io/redact.ts` 两档规则；接入 journal（aggressive）、命令输出（aggressive）、verification 理由（aggressive）、Builder/Verifier 提示词（高置信档，避免改动 spec 契约示例）。
- **证据**：`test/platform/redact.test.ts`（7 例，含「非 aggressive 档不得改动 spec 契约示例」的回归）。

### H2-3 证据保留上限（012 #16）✅ 已完成

- **目标**：journal、verification、evidence 不随运行时长无限增长。
- **落点**：`change-journal` 按条数或字节数轮转（`journal.1.jsonl` + 折叠摘要）；`change archive` 收敛该 change 的 runtime 目录；`doctor` 报告占用与可回收量；新增 `cometflow change gc [--apply]`。
- **验收标准**：写入超过阈值的 journal 后自动轮转，读取端仍能返回「摘要 + 最近 N 条完整事件」；`gc --apply` 只删除已归档 change 的 runtime 证据，且不触碰 `changes/<name>/` 与 `.cometflow-history/`。
- **风险**：误删证据会破坏审计，必须先做 `--dry-run` 与白名单。
- **实现**：journal 超阈值自动轮转（`journal.1.jsonl` + 轮转摘要事件），`readChangeJournal` 拼接历史与当前并支持 limit；新增 `change gc [--apply]`，dry-run 只输出计划、apply 只删 `.cometflow/runtime/` 下可推导内容；doctor 报告占用与可回收量。
- **证据**：`test/domains/evidence-retention.test.ts` 的轮转与 gc 六例（含「apply 后 journal 与 change 状态必须仍在」）。

---

## 批次 H3：流程与仓库加固

### H3-1 有界修复循环与停滞检测（012 #10）✅ 已完成

- **目标**：`verify-fail` 不再无条件回到 build；无进展时停机交还人工。
- **落点**：`change-types` 增加 `repair_attempts`、`last_verdict_hash`；`verifyChange` 在失败时计算结论指纹，连续相同指纹或超过上限则把 change 置为 `blocked`；`change resume` 给出人工介入提示。
- **验收标准**：单测覆盖「同一结论连续两次失败 → blocked」与「结论变化 → 允许继续」；上限可通过项目配置调整；blocked 的 change 不能被 run/archive。
- **风险**：指纹过严会误判正常迭代，需要把「结论集合 + 失败项 + scope 违例」纳入指纹并给出可读解释。
- **实现**：`verdictFingerprint()`（只含未通过验收项与越界项，不含自由文本理由与证据来源）；`ChangeState` 增加 `repair_attempts` / `last_verdict_hash`；连续同指纹累加、指纹变化重置为 1、通过清零；达上限把 `status` 置 `blocked`（阶段仍回 build）；`change run` 拒绝停机 change；新增 `change unblock` 作为唯一的重置入口并写审计流水。
- **证据**：`test/domains/repair-loop.test.ts`（8 例：指纹语义、三连同一结论停机、换结论继续、成功清零、配置上限、停机后拒跑、解封后可跑、非停机状态拒绝解封）。

### H3-2 git 来源绑定（012 #14）

- **目标**：记录 change 的基准 commit，分支漂移或历史被改写时阻断推进。
- **落点**：`change-create` 记录 `base_commit` / `base_branch`（`git rev-parse` + `symbolic-ref`）；`change run` / `verify` / `archive` 校验当前 HEAD 与基准的关系；`doctor` 报告漂移。
- **验收标准**：在 change 创建后切换分支或回退 commit，`change run` 报错并给出恢复路径；显式 `--allow-drift` 或项目配置可放行；非 git 仓库自动降级为警告。
- **风险**：工作区外（沙箱、CI 临时 checkout）可能没有 git，需要保持「非 git 也能用」。

### H3-3 Hook Router 单一归属（012 #15）

- **目标**：多个 active change 时不再一律拒绝，而是按「当前 change 指针」精确路由；指针缺失或失效时仍然 fail closed。
- **落点**：新增 `.cometflow/current-change.json`（机器状态）；`hook check` 先读指针，命中则只按该 change 的 phase/module 判定；`change new` / `change transition` 自动维护指针；新增 `cometflow change select <name>`。
- **验收标准**：两个 active change + 有效指针时，写入按指针 change 的规则判定（不再报 multiple-active-changes）；指针指向已归档/不存在的 change 时回退到 fail closed 并提示修复命令；单测覆盖三态。
- **风险**：指针本身是新的可变状态，必须与 H1-1/H1-2 一起做，否则会引入新的半写风险。

---

## 里程碑

| 里程碑 | 内容 | 完成标志 |
|---|---|---|
| M1 | H1 全部落地 ✅ | 崩溃注入单测通过；`doctor` 能识别孤儿临时文件与滞留迁移；plan/state 有内容哈希（48 测试文件 / 230 例） |
| M2 | H2 全部落地 ✅ | 快照 omission 可见；脱敏单测覆盖常见凭证形态；journal 轮转与 `gc` 可用（50 测试文件 / 250 例） |
| M3 | H3 全部落地 | 停滞自动停机；分支漂移阻断；多 change 场景按指针精确路由 |

## 完成定义（DoD）

每一项都必须同时满足：

1. 有单元测试，且覆盖**失败路径**（不只是 happy path）；
2. 在 `experiments/regression-fixture` 增加回归场景并接入 `run-regression.sh`；
3. 更新 012 的表格：该项从「建议后续」移动到「已落地」，并写明实现落点；
4. 涉及用户可见行为的，更新 `docs/USAGE.md` 与对应 ADR。

## 与现有实现的关系

- 不改变 spec 的权威性：这 9 项都不允许引入新的「事实源」，只加固现有事实的存储与校验方式。
- 复用已有机制：H1-3 复用 `spec-hash.ts` 的归一化思路；H2-1 复用 `implementation-scope` 的采集流程；H3-1 复用 `change verify` 的 verdict 结构。
- 兼容老项目：所有新增字段都必须有缺省与降级路径，参考 `anchor_hash` / `spec_base_hash` 的做法。
