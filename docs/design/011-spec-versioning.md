# 011 Spec 版本管理与代码重建

状态：已实施
日期：2026-09-14
关联：[002-spec-driven-kernel.md](./002-spec-driven-kernel.md)、[004-spec-change-impact.md](./004-spec-change-impact.md)、[ADR 0001](../decisions/0001-spec-single-source.md)、[ADR 0004](../decisions/0004-spec-change-reconciliation.md)、[ADR 0012](../decisions/0012-spec-version-as-artifact.md)

## 背景

002/004 已经规定了「spec 是唯一事实源」「任务冻结时记录 spec 版本与 hash」，但实施上是空的：

- `spec lock` 只存当前 hash，是**覆盖式快照**，没有历史；
- `plan freeze` 把 `spec_version` 硬编码为 `1`，从不递增、从不比较；
- `spec diff --impact`、`change revise` 只存在于设计文档；
- 归档把提案 spec 拷进 `specs/` 后不记账，`spec-lock.json` 立刻过期；
- 冻结任务的 hash 指向的文件内容没有被保存，**「代码丢了按 spec 重建」在实现上并不成立**；
- 任务与 spec 的对应只到「文件 + 标题文本」，改标题就变成新锚点，重名标题还会互相覆盖。

本文定义补齐后的机制。

## 目标

1. **spec 是产物**：spec 内容本身被内容寻址地保存下来，可寻址、可回放、可恢复。
2. **spec 是有版本的**：每个 spec 文件有单调递增的版本号与可回溯的版本链。
3. **spec 到代码是单向可推导的**：Builder/Verifier 消费的是冻结版本的 spec 段落，而不是当前工作区。
4. **版本冲突必须显式处理**：change 基于某个 spec 版本开工，归档时若基线已变，必须 rebase 或走 reconciliation，不能静默覆盖。
5. **一致性可机器验证**：一条 `spec verify` 能回答「现在的 spec 体系是否还能支撑重建」。

## 数据模型

### 内容寻址版本仓

```text
.cometflow-history/            # 可随 git 提交，跨机器可回放
  spec-versions/<sha256>.md    # spec 正文，按内容哈希寻址，同内容只存一份
  spec-history.json            # 版本链 ledger（机器生成，不手工编辑）
```

版本仓刻意放在被 git 跟踪的目录，而不是被 `.gitignore` 掉的 `.cometflow/`：否则换台机器就无法 `spec show specs/x/spec.md@2`。
旧项目的 `.cometflow/spec-versions` 仍可读，第一次写入即迁移到新目录。

`spec-history.json` 结构：

```json
{
  "schema": "cometflow.spec-history.v1",
  "specs": {
    "specs/auth/spec.md": [
      {
        "spec_version": 1,
        "hash": "<sha256>",
        "recorded_at": "2026-09-14T05:00:31.934Z",
        "change": null,
        "parent": null,
        "note": "spec lock"
      }
    ]
  }
}
```

- `hash` 是**行尾归一化后**的 sha256，同一份 spec 在 CRLF/LF 平台上得到同一个版本号。
- `spec_version` 每个文件独立递增；内容未变时重复登记不会产生新版本（`recordSpecVersion` 幂等）。
- `parent` 指向上一个版本的 hash，形成可回溯的版本链。
- `change` 记录该版本由哪个 change 产出，与 `note` 一起构成审计信息。

### Anchor 身份

anchor 是任务绑定的最小单位，规则：

- **可绑定 anchor = capability spec 的契约标题**（二级标题，例如 `## POST /api/auth/email-login`）；`### 请求`、`### 响应` 这类段落不是 anchor；
- 整份文件没有二级标题时退化为三级标题（兼容以 `###` 组织结构的 spec）；**flow 文档直接用三级标题**——
  它的二级标题是三段式骨架（见下），可绑定单位是步骤 `### 步骤N …`；
- **结构容器不是 anchor**：`## Acceptance` / `## 验收` 是验收项的容器；flow 的
  `## 前置条件` / `## 步骤` / `## 后置条件` 是 `spec validate` 强制要求的三段式骨架。
  把骨架当锚点会让「验收覆盖」里出现一堆 `前置条件` / `步骤` / `后置条件` 噪音；
- **只有 capability 的锚点参与任务绑定与 `anchor_coverage_rate`**：其它 kind 的标题
  （models 的实体清单、rules 的规则表、constraints 的各条约束……）是文档结构，不是绑定单位；
- 同一文件内 anchor 标题必须唯一，重复即 `duplicate-anchor` 错误。

每个 anchor 记录一个**正文哈希**：

- 覆盖范围 = 标题行之后、下一个同级或更高级标题之前；
- **不含标题行**，因此改标题只是重命名，正文哈希不变，可与「改内容」区分；
- **不含 Acceptance 段**，因此「正文变化」与「验收项变化」是两个正交信号。

### 任务上的版本引用

```yaml
- id: T1
  spec_ref: specs/auth/spec.md
  spec_anchor: "POST /api/auth/email-login"
  acceptance_ids: [A1, A2]
  spec_version: 3          # 真实版本号，来自版本仓
  spec_hash: "<整份文件 sha256>"
  anchor_hash: "<anchor 正文 sha256>"
  module: internal/auth    # 代码模块边界，来自 spec front-matter
```

### 模块边界由 spec 声明

capability spec 可以用 front-matter 声明它对应的代码模块：

```markdown
---
capability: auth
module: internal/auth
---
```

- `plan generate` 把 `module` 写入任务的 `module` 与 `test_scope`；
- `plan validate` 校验 `test_scope` 必须等于 spec 声明的模块，否则报 `module-scope-mismatch`；
- `change new` 把它带进 change 状态，`buildChangePrompt` 会要求 Builder 只在 `internal/auth` 内实现；
- 未声明时 `spec validate` 给出 `missing-module-declaration` 警告（不阻塞）。

这条链路让「一个 capability 对应一个代码模块」从约定变成可校验的机械约束。

跨 capability 共享的路径（CLI 入口、依赖清单、测试夹具等）声明在 **`COMETFLOW.md` 的 `## 模块归属`** 里：

```markdown
## 模块归属

| 共享路径 | 说明 |
|----------|------|
| bin | CLI 入口，跨 capability 共享 |
| package.json | 依赖清单与脚本 |
```

选择 project 层而不是项目配置，是因为 `.cometflow/` 被 gitignore：配置里的允许列表换台机器就丢了，
而「哪些文件是全仓库共享」是项目事实，必须随仓库分发。`config.scope.allow` 保留为本地临时覆盖，
两者在 `resolveScopeAllow()` 里合并，hook guard、`change verify`、`change archive` 共用同一份结果。

### Change 上的基线

```text
.cometflow/runtime/changes/<name>/spec-baseline.json  # change 创建时的全量 spec 快照（CAS 基线）
changes/<name>/comet-state.yaml                       # spec_base_hash / spec_version / spec_hash / anchor_hash
```

## 生命周期

```text
spec lock ──────▶ 登记版本 v1..vn + 刷新 spec-lock
                  │
plan freeze ──────┤ 重新登记（内容变则版本 +1）+ 写 anchor_hash + 刷新 lock
                  │
change new ───────┤ 拍全量 spec 基线（CAS）
                  │
change run ───────┤ Builder 提示词注入「冻结版本」的 anchor 原文 + acceptance
                  │
spec diff --impact --change <name>   # 归档前预览：改了哪些 anchor、谁受影响、风险等级
                  │
change archive ───┤ 1. 校验基线未变（否则 SpecConflictError）
                  │ 2. 写入 specs/
                  │ 3. 登记新版本（change=<name>）
                  │ 4. 刷新 spec-lock（归档自动记账）
                  │
plan regenerate ──┘ 把受影响任务重新绑定到新版本，旧任务保留历史
```

## 命令

| 命令 | 作用 |
|---|---|
| `cometflow spec lock [path]` | 登记版本 + 刷新 `spec-lock.json` |
| `cometflow spec diff [path] [--json]` | 与记录基线比较文件级差异 |
| `cometflow spec diff [path] --impact [--change <name>] [--json]` | 锚点级影响分析；`--change` 可在归档前预览提案 spec |
| `cometflow spec drift [path] [--json]` | 冻结任务漂移，含分类与 severity |
| `cometflow spec versions [path] [--spec <ref>] [--json]` | 版本历史 |
| `cometflow spec show <ref> [path]` | 打印某版本原文；`<ref>` 支持 `<path>@<version>` 或 `<hash>` |
| `cometflow spec restore <ref> [path]` | 从版本仓恢复 canonical spec，并登记为一次新变更 |
| `cometflow spec verify [path] [--json]` | 一致性门禁，失败返回退出码 1 |
| `cometflow change rebase <name> [path]` | 把 change 重新冻结到当前 canonical spec 版本 |

## 影响分级

| 变化 | kind | severity |
|---|---|---|
| anchor 标题改名、正文不变 | `renamed` | medium |
| anchor 正文变化 | `modified` | medium |
| 新增 anchor | `added` | low |
| 新增验收项 | `acceptance-changed` | medium |
| 删除验收项、改写验收项文本 | `acceptance-changed` | high |
| 删除 anchor、删除 spec 文件 | `removed` | high |
| 同文件其他位置变化，本 anchor 未受影响 | `file-changed-anchor-unchanged` | low |
| 版本仓缺少冻结内容 | `unknown` | high |

「改写验收项文本」与「删除验收项」同判高危：id 不变而语义改变时，历史验收结论会被错误地继承。

## spec verify 门禁

| code | 含义 |
|---|---|
| `missing-spec-lock` / `stale-spec-lock` | 缺少或过期的一致性基线 |
| `missing-spec-version` | 当前 spec 内容尚未登记为版本（warning） |
| `missing-version-blob` | 冻结任务引用的内容在版本仓中缺失，该任务无法按冻结版本重建 |
| `duplicate-anchor` | 同文件 anchor 标题重复 |
| `anchor-drift` | 冻结的 anchor 正文哈希与当前不一致 |
| `acceptance-drift` | 冻结的验收项（含文本）与当前不一致 |
| `frozen-anchor-missing` | 任务引用的 spec 文件或 anchor 已不存在 |
| `change-base-conflict` | 活跃 change 的 spec 基线已被外部改动 |
| `plan-integrity` | 任务计划内容与写入时盖的 `plan_hash` 不符（被手工改写） |
| `change-state-integrity` | change 状态内容与写入时盖的 `state_hash` 不符（被手工改写） |

## 重建代码的流程

前提：`specs/` 与 `COMETFLOW.md` 仍在，或可从版本仓取回；代码目录丢失。

```bash
cometflow spec verify .                          # 确认版本仓完整、任务绑定可解析
cometflow spec restore specs/auth/spec.md@3 .    # 需要时先恢复 spec
cometflow goal sync .
cometflow plan regenerate G1 . --preserve-approved
cometflow plan validate G1 .
cometflow plan freeze G1 .
cometflow change new auth-login-v4 --goal G1 --task T1 --path .
cometflow change run auth-login-v4 . --agent <agent>
cometflow change verify auth-login-v4 .
cometflow change archive auth-login-v4 .
```

重建的正确性来自两点：

1. Builder 拿到的是**冻结版本**的 anchor 原文与 acceptance。`buildChangePrompt` 从版本仓按 `spec_hash` 读取；版本仓缺失时显式告警，而不是静默降级到可能已漂移的工作区文件。
2. 归档前的 CAS 校验保证代码所实现的契约就是当前 canonical spec，或经过显式 rebase。

## 与 004 的关系

004 描述的影响分类与响应策略在本文件中获得实现：`spec diff --impact` 落地了影响分析与分级，
`change rebase` 落地了「接受新基线」的显式动作，`spec drift` / `spec verify` 落地了漂移检测与门禁。
reconciliation change 的自动创建仍按 004 保留为人工决策。

## 已知边界

- anchor 级哈希是段落文本哈希，不理解语义：`401` 改成 `403` 与把一句话改写成语义等价的另一句话，都会被判为 `modified`。
- 未实现语义级 diff（Reviewer Agent 判定 prose 变化是否改变行为）。

## 后续加固（见 012）

验收可执行、实现范围强制、独立 Verifier、归档事务与审计流水已落地，细节见
[012-comet-borrowings.md](./012-comet-borrowings.md) 与 [ADR 0013](../decisions/0013-verification-must-be-executable.md)；

可靠性加固的第一批也已落地（见 [ADR 0014](../decisions/0014-atomic-and-recoverable-state.md)）：
原子写入（含 Windows rename 重试）、两阶段状态迁移日志、计划与 change 状态的内容哈希；
快照 omission、有界修复循环、凭证脱敏、git 来源绑定、Hook 路由、证据保留上限仍为后续项
（[comet-hardening-plan.md](../plan/comet-hardening-plan.md) 的 H2/H3）。
