# 命令对照说明：演示里每条 CLI 到底在做什么

配套文档：[演示脚本：用 CometFlow 实现 todoscan](./todoscan-demo.md)

如果你看完演示脚本还觉得「命令敲了，但不知道背后发生了什么」，这篇就是为它写的。
建议读法：先看第 1 节的总表和开头的三个概念，再按第 2 节跟着步骤走。

---

## 0. 先建立三个概念

### 概念一：所有命令都是「读文件 → 计算 → 写文件」

CometFlow 没有数据库、也没有常驻服务端。所谓「状态」就是项目目录里的文件。
每条命令都可以用一句话描述：**读哪些文件，算什么，写哪些文件**。

### 概念二：只有人类写 COMETFLOW.md 和 specs/

```text
人类写                    命令                     机器写
─────────────     ─────────────────────     ───────────────────────────
COMETFLOW.md  ──►  context sync          ──► .cometflow/project-context.yaml
COMETFLOW.md  ──►  goal sync             ──► .cometflow/goals/G1.yaml
specs/**      ──►  spec lock             ──► .cometflow/spec-lock.json
                                        └─► .cometflow-history/spec-versions/<sha256>.md
specs/**      ──►  spec index            ──► .cometflow/spec-index/*.yaml
specs/**      ──►  plan generate         ──► .cometflow/plans/G1.task-plan.yaml
                                               changes/<名>/**
                                               evolve/<名>.yaml
```

`.cometflow/` 下的东西**全是投影和状态**，手工改了下次命令就会覆盖掉。
看懂这一点，就能明白为什么改了 `COMETFLOW.md` 之后要跑 `goal sync`——
因为 `.cometflow/goals/G1.yaml` 只是它的一份快照，不会自动跟着变。

### 概念三：命令分三类

| 类别 | 命令 | 特点 |
|---|---|---|
| 投影 / 同步 | `context sync`、`goal sync`、`spec lock`、`spec index` | 从人类文件生成机器文件，可反复跑 |
| 只读检查 | `spec validate`、`plan validate`、`spec diff`、`spec drift`、`doctor`、`status`、`plan trace` | 不改任何文件 |
| 状态推进 | `plan review/approve/freeze`、`change *`、`evolve *` | 改状态文件，有前置条件，顺序不能乱 |

---

## 1. 全部命令总表（按演示顺序）

### 准备

| 命令 | 读 | 写 | 一句话作用 |
|---|---|---|---|
| `pnpm install` | `package.json`、`pnpm-lock.yaml` | `node_modules/` | 装平台依赖 |
| `pnpm build` | `app/`、`domains/`、`platform/` | `dist/` | 把 TS 编译成可执行的 CLI |
| `npm link` | `package.json` 的 `bin` 字段 | 全局 bin | 让 `cometflow` 命令可用 |
| `cometflow agent list` | 内置 Agent 注册表 | 无 | 探测 opencode / claude-code / mock 是否可用 |

### 步骤 A：初始化

| 命令 | 读 | 写 | 一句话作用 |
|---|---|---|---|
| `cometflow init todoscan --interactive` | 无（不读现有项目） | `COMETFLOW.md`、`specs/`、`.cometflow/config.yaml`、`.cometflow/goals/`、`.cometflow/plans/`、`.gitignore`、按问答生成的 kind 骨架、`.cometflow/init-manifest.yaml` | 建骨架 + 按项目类型裁剪 spec kind |
| `cometflow spec scaffold --list .` | `.cometflow/init-manifest.yaml` | 无 | 打印 12 类 kind 的 present / deferred / absent |

### 步骤 C：同步与校验

| 命令 | 读 | 写 | 一句话作用 |
|---|---|---|---|
| `cometflow context sync .` | `COMETFLOW.md` 的「技术栈」「运行环境」两张表 | `.cometflow/project-context.yaml` | 把技术栈变成机器可读上下文 |
| `cometflow goal sync .` | `COMETFLOW.md` 的「任务目标」段落 | `.cometflow/goals/G1.yaml` 等 | 把 G1/G2… 拆成目标记录 |
| `cometflow spec validate .` | `COMETFLOW.md`、`specs/**`、`init-manifest.yaml` | 无 | 校验结构、anchor、acceptance、跨文件引用 |
| `cometflow spec lock .` | `specs/**` 所有 `.md` | `.cometflow/spec-lock.json`、`.cometflow-history/` | 登记 spec 版本（内容寻址）+ 刷新 hash 基线 |
| `cometflow spec index .` | `specs/**` | `.cometflow/spec-index/{models,apis,flows,errors,config}.yaml` | 生成可被程序消费的 spec 投影 |

### 步骤 D：拆解到冻结

| 命令 | 读 | 写 | 一句话作用 |
|---|---|---|---|
| `cometflow plan generate G1 .` | `COMETFLOW.md`、`specs/**` 的 anchor | `.cometflow/plans/G1.task-plan.yaml`（draft） | 把目标拆成任务草稿 |
| `cometflow plan validate G1 .` | 计划 + specs + project-context | 无 | 查覆盖度、依赖环、命令与技术栈是否匹配 |
| `cometflow plan review G1 .` | 计划 | 计划（`draft → validated`） | 标记「已评审」 |
| `cometflow plan approve G1 .` | 计划 | 计划（`→ approved`） | 标记「已批准」 |
| `cometflow plan freeze G1 .` | 计划 + spec 文件内容 | 计划（`→ frozen`，补 `acceptance_ids` / `spec_version` / `spec_hash` / `anchor_hash`） | 锁死每个任务的验收项与 spec 版本 |
| `cometflow plan trace G1 .` | 计划 | 无 | 打印「任务 ↔ spec ↔ anchor ↔ acceptance」追踪表 |

### 步骤 E / F：执行 change

| 命令 | 读 | 写 | 一句话作用 |
|---|---|---|---|
| `cometflow change new <名> --goal G1 --task T1` | 计划 | `changes/<名>/brief.md`、`changes/<名>/comet-state.yaml`（shape） | 用一个冻结任务开一张工单 |
| `cometflow change transition <名> confirm-acceptance .` | `comet-state.yaml` | 同上（`shape → build`） | 确认验收标准，允许开工 |
| `cometflow change run <名> . --agent opencode` | `comet-state.yaml`、`brief.md` | 代码文件 + `comet-state.yaml`（`build → verify`） | 调 Builder Agent 实现 |
| `cometflow change verify <名> .` | `verification.yaml` 或 `.cometflow/eval.yaml` | `changes/<名>/verification.md`、`comet-state.yaml` | 独立验收，不采信 Agent 自述 |
| `cometflow change archive <名> .` | `changes/<名>/specs/**` | `specs/**`（覆盖）、`comet-state.yaml`（done + archived） | 归档并落地 spec 变更 |
| `cometflow change list .` | `changes/*/comet-state.yaml` | 无 | 列出工单（默认隐藏已归档） |
| `cometflow change resume <名> .` | `comet-state.yaml` | 无 | 告诉你「下一步该发什么事件」 |

### 步骤 G / H：评估与进化

| 命令 | 读 | 写 | 一句话作用 |
|---|---|---|---|
| `cometflow eval .` | `.cometflow/eval.yaml` | `.cometflow/eval-report.json` | 跑任务 N 次，算 Pass@k / Pass^k |
| `cometflow evolve propose <名> --summary ...` | `.cometflow/evolve.yaml`（门禁） | `evolve/<名>.yaml`（draft） | 开一张改进提案 |
| `cometflow evolve verify <名> [--eval]` | 提案 + 门禁命令 | `evolve/<名>.yaml`（verified 或 rejected） | 跑真实门禁 |
| `cometflow evolve submit <名>` | 提案 | `evolve/<名>/review.md`、状态 → ready-for-review | 生成评审材料 |
| `cometflow evolve review-list .` | `evolve/*.yaml` | 无 | 盘点所有提案 |
| `cometflow evolve approve <名> [--note] [--commits]` | 提案 | 提案（approved 终态）+ 追加 review.md 决策 | 批准落地 |
| `cometflow evolve rollback <名>` | 提案 | 无 | 打印回滚指引 |

### 步骤 H.3：spec 变更治理

| 命令 | 读 | 写 | 一句话作用 |
|---|---|---|---|
| `cometflow spec diff .` | `specs/**` + `.cometflow/spec-lock.json` | 无 | 对比「现在」和「基线」 |
| `cometflow spec drift .` | 计划的 `spec_hash` + 当前 spec 内容 | 无 | 找出「已冻结但 spec 已变」的任务 |
| `cometflow plan regenerate G1 . --preserve-approved` | 旧计划 + specs | 计划（回 draft；未受影响任务保留、多余任务 cancelled） | 按新 spec 重新拆解 |

### 收尾

| 命令 | 读 | 写 | 一句话作用 |
|---|---|---|---|
| `cometflow status .` | goals / plans / changes / evolve | 无 | 打印全局状态 JSON |
| `cometflow doctor .` | 使命、上下文、specs、plans、changes | 无 | 健康检查（有 error 则退出码 1） |
| `cometflow dashboard .` | 项目状态 | 无 | 起一个只读看板（默认 4321） |
| `cometflow serve` | 工作区注册表 + 项目文件 | `~/.cometflow/workspace/workspace.json` | 起完整 Web 客户端（首页 + 8 个面板） |

---

## 2. 逐步详解

### 步骤 A-1：cometflow init todoscan --interactive

**它在做什么**：先按固定模板建目录，再根据你的 10 个回答决定生成哪些 spec 骨架。

```text
COMETFLOW.md            模板：使命 / 技术栈 / 运行环境 / 任务目标
specs/                  空目录
.cometflow/config.yaml  schema + default_workflow + plan_review
.cometflow/goals/       空，等 goal sync 填
.cometflow/plans/       空，等 plan generate 填
.gitignore              追加一行 .cometflow/

交互之后还会生成：
specs/constraints.md    因为「后端 = Node.js」
specs/errors.md         因为回答「错误码较多 = y」
specs/config.md         因为回答「有运行时配置键 = y」
.cometflow/init-manifest.yaml   12 类 kind 的 present/deferred/absent + 理由
```

**为什么要有这一步**：12 类 spec 不该让人全写一遍。技术栈能推断的（有数据库→`models`、
有前端→`pages`、有后端→`constraints`）直接推断；推断不出的靠 7 个问题；
「确定不需要」也写进 `init-manifest.yaml`，好让后面的校验区分「有意缺席」和「漏写」。

**坑**：`init` 在 `COMETFLOW.md` 已存在时会直接失败，不会覆盖——所以种子项目要复制进新目录。

### 步骤 A-2：cometflow spec scaffold --list .

**它在做什么**：只读 `.cometflow/init-manifest.yaml` 并打印。

它在演示里的价值是**一眼看到裁剪结果**：12 类 kind 里只有 4 类是 present。
如果后面 `spec validate` 报「某 kind 缺失」，看这张表就知道是「本来就不需要」还是「真的漏了」。

### 步骤 C-1：cometflow context sync .

**它在做什么**：解析 `COMETFLOW.md` 里两张 Markdown 表，转成 YAML。
比如「后端 = Node.js」「数据库 = 无」这两行，会变成 `tech_stack.backend` 和
`tech_stack.database` 两个字段写进 `.cometflow/project-context.yaml`。

**为什么要单独一步**：`COMETFLOW.md` 是给人读的 Markdown，机器每次解析既慢又容易歧义。
`sync` 把它「投影」成结构化快照，后续 `plan validate` 用它判断
「这个任务的完成标准写了 `npm test`，但技术栈是 Go」这类矛盾。

**注意**：表格里留了「待定」「TODO」或占位符时会打印 WARN，但**仍然会写出文件**。

### 步骤 C-2：cometflow goal sync .

**它在做什么**：找到 `## 任务目标` 段落，把每个 `### G1：标题` 解析成一条记录：

```text
### G1：todoscan 命令行扫描器     →  id: G1
- 目标：实现一个零依赖的 Node CLI  →  summary: …
- 范围：scan, report, settings     →  scope: [scan, report, settings]
- 成功标准：                        →  success_criteria: [...]
  - …
- 非目标：                          →  non_goals: [...]
  - …
```

**关键理解**：`范围` 里的名字必须等于 `specs/<名字>/spec.md` 的目录名。
`plan generate` 就是靠这个对应关系去找 spec 的——写错了它就会生成一个
「起草某 capability spec」的任务，而不是实现任务。

**注意**：`goal sync` 只写不删。在 `COMETFLOW.md` 里删掉 G2，旧的
`.cometflow/goals/G2.yaml` 不会消失，需要自己清理。

### 步骤 C-3：cometflow spec validate .

**它在做什么**：这是演示里信息量最大的一条。它同时查四件事：

1. **项目上下文**：`COMETFLOW.md` 的技术栈/运行环境表是否齐全。
2. **清单一致性**：`init-manifest.yaml` 说 present 的 kind，文件是否真的在；
   说 deferred 但缺文件只给 warning。
3. **每种 kind 的结构**：capability 必须有 anchor 和 acceptance；models 必须有
   `## 实体：`；flow 必须有三段式步骤；其余 kind 至少要有二级标题。
4. **跨文件引用**：`错误码：E_NO_PATH` 能在 `specs/errors.md` 找到吗？
   `模型：User` 能在 `models.md` 找到吗？接口字段能在绑定的实体里找到吗？

**最值得现场演示的一幕**：把 `错误码：E_NO_PATH` 改成 `E_TYPO`，再跑一次：

```text
ERROR unresolved-error-reference specs/scan/spec.md 引用的错误码未在 specs/errors.md 定义: E_TYPO
spec validate: FAILED
```

这就是「spec 是机器可校验的契约」——如果 spec 只是文档，这种错误只能靠人眼发现。

**坑**：`spec validate` 打印 `FAILED` 时，**退出码仍然是 0**，不会让 CI 失败。
`plan validate` 同样如此。真正会置非零退出码的是 `doctor`、`eval`、`hook check`（见第 5 节）。

### 步骤 C-4：cometflow spec lock .

**它在做什么**：给 `specs/` 下每个 `.md` 算 sha256，写进 `.cometflow/spec-lock.json`。

**为什么需要基线**：后面「有人改了 spec」这件事必须能被发现，`spec diff` 就是拿当前文件
和这个快照比。**改 spec 之前先 lock，才有对比基准。**

### 步骤 C-5：cometflow spec index .

**它在做什么**：把分散的 spec 解析成 5 份结构化投影：

| 产物 | 内容 |
|---|---|
| `models.yaml` | 实体、字段、枚举、状态机 |
| `apis.yaml` | 每个 anchor 的 method/path、请求响应字段、acceptance id |
| `flows.yaml` | 流程的步骤、引用的 API / 模型 / 配置 |
| `errors.yaml` | 错误码清单 |
| `config.yaml` | 配置键清单 |

**用途**：给人和后续工具一个「不用读 Markdown」的视角，Web 客户端的 Specs 面板也读它。
演示中它不是必需步骤，但能说明「同一份 spec 可以有多种机器视角」。

### 步骤 D-1：cometflow plan generate G1 .

**它在做什么**：拿 G1 的 `scope`，逐个 capability 去 `specs/` 找对应 spec：

```text
scope: [scan, report, settings]
  ├─ specs/scan/spec.md      存在 → 每个 anchor 生成 1 个任务
  │    ├─ ## scan <dir>   → T1
  │    └─ ## 过滤         → T2
  ├─ specs/report/spec.md    存在 → T3 (report text)、T4 (report json)
  └─ specs/settings/spec.md  存在 → T5 (load-config)

若某个 capability 的 spec 不存在，则生成 1 个 spec-authoring 任务，而不是实现任务
```

产物 `.cometflow/plans/G1.task-plan.yaml` 里所有任务都是 `status: draft`，
`acceptance_ids` 还是空的。

**坑**：`generate` 会**整体覆盖**已有计划，把 review/approve/freeze 的状态清空。
已经有计划又想重来，应该用 `plan regenerate --preserve-approved`。

### 步骤 D-2：cometflow plan validate G1 .

**它在做什么**：对着 specs 逐条检查计划是否站得住：

- 任务引用的 spec / anchor 真的存在吗；
- 引用的 spec 有 acceptance 吗；
- **覆盖度**：spec 里每个 anchor 都有任务负责吗（漏拆会报 `missing-coverage`）；
- 依赖是否存在、是否成环；
- 完成标准里是否写了与技术栈冲突的命令（Node 项目写 `go test` → `stack-command-mismatch`）。

**和 `spec validate` 的分工**：`spec validate` 管「契约本身对不对」，
`plan validate` 管「拆解有没有忠实覆盖契约」。两者都只读。

### 步骤 D-3 / D-4：plan review / plan approve

**它在做什么**：基本上只是改计划文件里的一个字段。

```text
plan review  : draft → validated        （只能从 draft 开始）
plan approve : draft | validated → approved
```

**为什么要这两个看起来「空转」的状态**：这是「人类批准」的留痕点。
`plan freeze` 之后如果再重新拆解，平台会对比这些状态来决定哪些任务要保留、哪些要重做。

### 步骤 D-5：cometflow plan freeze G1 .（最关键的一步）

**它在做什么**：把「任务 ↔ 验收标准」的绑定固化下来。对每个 implementation 任务：

1. 打开它引用的 spec 文件，找到对应 anchor；
2. 取该 anchor 下的 acceptance（`### Acceptance` 下的 `- A1：…`）；
3. 写入 `acceptance_ids: [A1, A2]`；
4. 把当前 spec 内容登记为一个版本，写入真实的 `spec_version`、整文件 `spec_hash` 与 anchor 段落 `anchor_hash`；
5. 同时刷新 `spec-lock.json`，让 `spec diff` / `spec verify` 的基线跟着走。

验收项若在 spec 里写了 `- check: <command>`，`cometflow change verify` 会真的执行它，
并把退出码作为该项的结论——这类结论不能被 Verifier 或文档推翻。

演示里的实测映射：

| 任务 | anchor | 冻结到的 acceptance |
|---|---|---|
| T1 | `scan <dir>` | A1, A2 |
| T2 | `过滤` | A3 |
| T3 | `report text` | A4 |
| T4 | `report json` | A5 |
| T5 | `load-config` | A6, A7 |

**为什么 acceptance 归属这么准**：因为 spec 里把 `### Acceptance` 写在了各自 anchor 下面。
如果整个文件只有一个 `## Acceptance`，那这个文件的所有任务会拿到同一组 acceptance。

**为什么 freeze 之后才算数**：`change new` 只接受 `frozen` 的任务。
执行阶段不再重新解释 spec——这是平台最重要的设计约束之一。

### 步骤 D-6：cometflow plan trace G1 .

**它在做什么**：只读。把 `任务 → spec → anchor → acceptance → status` 打出来。

它是验收时的证据：评审者不需要读 YAML，看这张表就知道每个任务对应契约的哪一条。

### 步骤 E-1：cometflow change new scan-core --goal G1 --task T1

**它在做什么**：为一个冻结任务开一张工单目录。

```text
changes/scan-core/
  brief.md          任务的 title + definition_of_done
  comet-state.yaml  phase: shape, status: active
                    acceptance_ids / spec_ref / spec_hash 从任务抄过来
```

**前置条件**：任务必须是 `frozen`，否则报 `Only frozen tasks can create changes`。

**为什么把 acceptance 抄进工单**：这样工单是自包含的——即使之后 spec 变了，
这张工单仍然按当时冻结的标准验收（历史不可变）。

### 步骤 E-2：cometflow change transition scan-core confirm-acceptance .

**它在做什么**：状态机推进 `shape → build`。

这条命令还承担一个守卫：**acceptance_ids 为空时拒绝进入 build**，
保证「没有验收标准的任务不许开工」。

### 步骤 E-3：cometflow change run scan-core . --agent opencode

**它在做什么**：

1. 前置检查 `phase === build`；
2. 读 `comet-state.yaml` 和 `brief.md`，拼一段 Builder prompt
   （含 change 名、任务、spec#anchor、acceptance id、brief 全文）；
3. spawn `opencode run <prompt>`，工作目录设为项目根；
4. Agent 退出码 0 → 写回 `phase: verify`；非 0 → **不改状态**，命令退出码等于 Agent 的退出码。

**注意**：CometFlow 不解析 Agent 的输出来判断成功，只看退出码。
所以「Agent 说自己做完了」不等于验收通过——真正的判定在下一步。

**可选动作（演示推荐）**：往 `brief.md` 追加该任务的 Acceptance 原文。
因为默认 brief 只含任务标题和 DoD，Agent 需要自己去读 spec 才能拿到验收细节。

### 步骤 E-4：cometflow change verify scan-core .

**它在做什么**：这是「生成与评价分离」的落点。两条路径：

```text
changes/scan-core/verification.yaml 存在吗？
  ├─ 存在 → 校验：change 名一致；acceptance id 集合与冻结点完全一致
  │        （多一个少一个都报错）；result 全部是 passed
  │        → 全 passed 即通过
  └─ 不存在 → 回退：直接跑 .cometflow/eval.yaml，用 report.passed
```

然后：

- 写 `changes/scan-core/verification.md`（验收记录，人可读）；
- 写回状态：通过 → `phase: archive`；不通过 → **退回 `phase: build`**
  （不是失败终止，而是让 Builder 再来一遍）。

**坑**：验收不通过时它只打印 `reportPassed=false`，**退出码是 0**；
只有「acceptance 对不上」这类硬错误才会抛异常并置退出码 1。

### 步骤 E-5：cometflow change archive scan-core .

**它在做什么**：唯一一条会**改动 canonical spec**的命令。

```text
changes/<名>/specs/<capability>/spec.md ──若存在──► specs/<capability>/spec.md
```

本项目这张工单没有自带的 spec 变更，所以只是把状态改成 `done` + `archived: true`。
它的意义在于：**spec 的正式变更必须随一张通过验收的工单一起落地**，Agent 不能直接改 `specs/`。

### 步骤 E-6：cometflow change list .

**它在做什么**：扫 `changes/*/comet-state.yaml` 打印。默认隐藏已归档的，
加 `--all` 看全部，加 `--json` 给程序用。

### 步骤 F：循环跑 T2–T5

每条工单都是同一套五步动作（new → confirm-acceptance → run → verify → archive）。
脚本里的循环只是省事，语义和 T1 完全一样。

**演示提速建议**：T2–T5 提前跑完并归档，现场只演 T1。
或者用 `--agent mock` 快速走状态机——但要说明它**不产生真实代码**。

### 步骤 G：cometflow eval .

**它在做什么**：读 `.cometflow/eval.yaml`，对每个 task 重复 `sampling` 次：

```text
sampling: 2, pass_at_k: 1, pass_all_k: 2
  ├─ 前 1 次里有 1 次通过 → Pass@1 成立
  └─ 前 2 次全部通过       → Pass^2 成立
```

每个 task 还可以写 `assertions`（对 stdout/stderr 做 contains / not_contains），
所以除了「退出码为 0」，还能断言输出内容。最后写 `.cometflow/eval-report.json`。

**与 change verify 的关系**：eval 既是独立的质量门禁，也是 `change verify`
在没有 `verification.yaml` 时的兜底判据。同一项目里两者可以并存。

**退出码**：整体 FAIL 时置 1，可以直接进 CI。

### 步骤 H-1：cometflow evolve propose fail-on --summary ... --risk ...

**它在做什么**：写 `evolve/fail-on.yaml`，内容包含提案摘要、风险计划，
以及从 `.cometflow/evolve.yaml` 读到的**门禁命令清单**（没配就用内置的 typecheck + tests）。

**和 change 的区别**：change 是「实现一个冻结任务」，evolve 是「提出一项改进并接受门禁检验」。
后者有明确的终态（approved / rejected）和回滚指引。

### 步骤 H-2：cometflow evolve verify fail-on .

**它在做什么**：顺序执行提案里的每个 gate 命令，打印 `gate名: OK/FAIL`；
全部通过 → `status: verified`，任一失败 → `status: rejected`。
加 `--eval` 会额外跑科学评估，并把 Pass@k / Pass^k 摘要写进提案。

**为什么要显式配门禁**：默认门禁假设这是 TypeScript 项目（跑 tsc + vitest）。
todoscan 是纯 ESM 的 Node 项目，所以在 `.cometflow/evolve.yaml` 里换成 `node --test`。

### 步骤 H-3：evolve submit → review-list → approve

| 命令 | 前置状态 | 结果 |
|---|---|---|
| `submit` | verified | 生成 `evolve/<名>/review.md`，状态变 ready-for-review |
| `review-list` | — | 只读盘点，供人逐项决策 |
| `approve` | ready-for-review 或 verified | 终态 approved，回填 `review_note` / `merged_commits` / `decision_at`，并把决策追加到 `review.md` |
| `reject` | 任意非终态 | 终态 rejected，必须给 `--reason` |
| `rollback` | — | 只读，打印 `git revert` 指引 |

### 步骤 H.3：改 spec 之后会发生什么

这一步最能体现平台的治理能力，四条命令环环相扣：

```text
改 specs/scan/spec.md（加一条 A8）
  ├─ spec validate  → 结构与引用是否仍然合法
  ├─ spec diff      → modified: specs/scan/spec.md      （对比 lock 基线）
  ├─ spec drift     → T1/T2 的 spec_hash 已变，列出来     （对比冻结记录）
  └─ plan regenerate G1 --preserve-approved
       · T1/T2：spec_hash 变了 → 退回 draft，需重新 review/approve/freeze
       · T3/T4/T5：spec_hash 未变 → 保持 frozen
       · 旧计划里已消失的任务 → 标为 cancelled
```

**为什么不是直接改已完成任务**：已完成任务是历史。平台不修改历史，
而是通过重新拆解或新建 reconciliation change 来消化变更。

**实测输出**（本机验证）：

```text
scannedTasks: 5
drift: 2
G1 T1 specs/scan/spec.md 7c811a7b -> a961d676
G1 T2 specs/scan/spec.md 7c811a7b -> a961d676
```

---

## 3. 文件地图：谁生成、谁读取

```text
        人类编辑
          │
  ┌───────┴────────┐
  ▼                ▼
COMETFLOW.md    specs/**
  │                │
  ├ goal sync      ├ spec lock  ──► spec-lock.json
  ├ context sync   ├ spec index ──► spec-index/*.yaml
  │                └ anchors
  ▼                   │
goals/G1.yaml ────────┴──► plan generate
                              │
                              ▼
                    plans/G1.task-plan.yaml
                              │ plan freeze
                              │ （写 acceptance_ids + spec_hash）
                              ▼
                      change new ──► changes/<名>/comet-state.yaml
                              │
                        change run（调 Agent）
                              │
                        change verify ◄── verification.yaml 或 eval.yaml
                              │
                        change archive ──► 覆盖 specs/**（若工单带 spec 变更）
                              │
                              ▼
                    status / doctor / dashboard / serve
```

要记住的关键连线：

- `goal sync` 的产物只被 `plan generate` 消费，**不参与验收**；
- `plan freeze` 写下的 `spec_hash` 是后来 `spec drift` 的唯一依据；
- `change verify` 的判据只能来自 `verification.yaml` 或 `eval.yaml`，没有第三种；
- 只有 `change archive` 会写 `specs/`。

---

## 4. 状态机 × 命令对照

### 任务计划

| 当前状态 | 允许的命令 | 之后状态 |
|---|---|---|
| draft | `plan validate` / `plan review` / `plan approve` / `plan freeze` | validated / approved / frozen |
| validated | `plan approve` / `plan freeze` | approved / frozen |
| approved | `plan freeze` | frozen |
| frozen | 只能被 `change new` 消费；要改动需 `plan regenerate` | — |

### Change

| 当前阶段 | 允许的命令 | 之后阶段 |
|---|---|---|
| shape | `change transition <名> confirm-acceptance` | build |
| build | `change run` | verify（Agent 退出码 0 时） |
| verify | `change verify` | archive（通过）/ build（不通过） |
| archive | `change archive` | done + archived |

任何阶段都可以用 `change resume` 查「下一步」，它不需要前置条件。

### 进化

| 当前状态 | 允许的命令 | 之后状态 |
|---|---|---|
| draft | `evolve verify` | verified / rejected |
| verified | `evolve submit`，或直接 `evolve approve` | ready-for-review / approved |
| ready-for-review | `evolve approve` / `evolve reject` | approved / rejected（终态） |

---

## 5. 退出码：哪些命令能进 CI

| 命令 | 失败时退出码 | 说明 |
|---|---|---|
| `doctor` | 1 | 有 error 级发现时 |
| `eval` | 1 | 整体 Pass^k 未通过时 |
| `hook check` | 1 | 写操作被拒绝时 |
| `change run` | 等于 Agent 退出码 | Agent 失败时 |
| `run` | 等于 Agent 退出码；超时 124 | |
| `change verify` | 1（硬错误）/ 0（验收不通过） | 只有 acceptance 集合不匹配这类硬错误才置 1 |
| `spec validate` | 恒为 0 | 打印 FAILED 但不置退出码 |
| `plan validate` | 恒为 0 | 同上 |
| `spec diff` / `spec drift` | 0 | 只报告，不判定失败 |

**因此在 CI 或预检脚本里**，`spec validate` 与 `plan validate` 需要抓输出文本判断，
不能只依赖退出码。例如：

```bash
out=$(cometflow spec validate .); echo "$out"
echo "$out" | grep -q "spec validate: OK" || exit 1
```

演示脚本附录里那份预检脚本就是这么写的。

---

## 6. 常见困惑

**改了 `COMETFLOW.md` 的任务目标，为什么 `plan generate` 没变化？**
`plan generate` 读的是 `COMETFLOW.md` 本身，会变；但 `.cometflow/goals/G1.yaml`
要跑 `goal sync` 才会更新，它是快照不是实时视图。凡是「改了人类文件但下游没反应」，
先想「这个下游读的是快照还是原文件」。

**`.cometflow/goals/G1.yaml` 能手工改吗？**
不要。它是 `goal sync` 的产物，下次 sync 就覆盖。要改就改 `COMETFLOW.md`。

**`plan freeze` 之后还能改 spec 吗？**
能，但已冻结任务的历史不会跟着改。正确做法是改完跑 `spec diff` → `spec drift`
→ `plan regenerate --preserve-approved`，或者为已完成的工作新建 reconciliation change。

**为什么 `change verify` 要我自己写 `verification.yaml`？**
因为「验收」本来就该由独立于 Builder 的一方给出结论。平台提供的是**判定规则和留痕**
（id 必须对齐、结果必须合法、结论写入 `verification.md`），而不是替你执行验收。
你也可以改成让 eval 当判据，那就配置 `.cometflow/eval.yaml`。

**`spec validate` 显示 OK，是不是就说明 spec 写得好？**
不是。它只检查**结构与引用**是否自洽（有没有 anchor、acceptance，引用的错误码是否存在）。
语义是否描述清楚、acceptance 是否可执行，仍然要人判断。

**为什么演示里 `change verify` 之后又退回 `build`？**
这是设计。验收不通过不是终止，而是把工单打回给 Builder 重做——
`verify-fail` 事件把 `verify` 阶段退回 `build`，流程可反复，直到通过或人工介入。

**`.cometflow/` 能不能提交到版本库？**
默认在 `.gitignore` 里。它是本机运行状态（队列、锁、报告），通常不进版本库；
只有像 `experiments/regression-fixture` 那样把它当测试基线时才显式提交。
