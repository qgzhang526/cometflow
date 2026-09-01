# 003 任务规划：拆解、关联、审核与纠错

## Task Plan 结构

```yaml
# .cometflow/plans/G1.task-plan.yaml
goal: G1
status: draft | validated | approved | frozen

tasks:
  - id: T1
    title: 实现邮箱验证码登录
    capability: auth
    spec_ref: specs/auth/spec.md
    spec_anchor: "POST /api/auth/email-login"
    acceptance_ids: []
    spec_version: null
    spec_hash: null
    depends_on: [T0]
    test_scope: internal/auth
    definition_of_done:
      - 所有 acceptance 通过
      - 相关测试通过
    status: draft
```

## 任务与 Spec 关联时机

关联分为两个阶段：

| 阶段 | 命令 | 关联状态 |
|---|---|---|
| 拆解 | plan generate | 草稿关联 |
| 校验 | plan validate | 机器校验 |
| 审核 | plan approve | 人工/策略确认 |
| 冻结 | plan freeze | 冻结关联，提取 A1..An |

**执行阶段不再建立或重新解释关联，只消费冻结后的关联。**

### plan generate

Decomposer 读取 goal 和 specs/，生成草稿关联：

```text
G1.scope = [auth]
specs/auth/spec.md
  → POST /api/auth/email-login
  → POST /api/auth/register
  → Flow: login-flow

T1 → POST /api/auth/email-login
T2 → POST /api/auth/register
T3 → Flow: login-flow
```

### plan validate

机器校验：

- Coverage：goal scope 内每个 spec anchor 至少有一个任务。
- Precision：每个任务必须引用存在的 spec anchor。
- Acceptance：每个任务至少有一个 acceptance。
- 依赖无环。
- 无重复任务。
- test_scope 明确。

### plan freeze

```yaml
tasks:
  - id: T1
    spec_ref: specs/auth/spec.md
    spec_anchor: "POST /api/auth/email-login"
    acceptance_ids: [A1, A2, A3]
    spec_version: 3
    spec_hash: "abc123"
    status: frozen
```

## 审核策略

```yaml
plan_review: auto | high-risk | human
```

| 模式 | 行为 |
|---|---|
| auto | 机器校验 + Reviewer 通过后执行 |
| high-risk | 一般任务自动，高风险暂停人工 |
| human | 所有拆解人工确认 |

首次拆解某个 goal 时，默认人工审核。

## 纠错决策树

```text
发现子任务 spec 或拆解不合理
        │
        ▼
任务目标写错？
  ├─ 是 → cometflow goal update G1
  │       → cometflow plan regenerate G1
  │
  └─ 否 → 拆解结果错？
         ├─ 是 → cometflow plan edit G1
         │       → cometflow plan validate
         │
         └─ 否 → 项目级 spec 错？
                ├─ 是 → 编辑 specs/
                │       → cometflow spec diff --impact
                │       → cometflow plan regenerate G1 --preserve-approved
                │
                └─ 否 → change spec 错？
                       ├─ 是 → cometflow change revise <change>
                       │       → 重新 spec freeze
                       │
                       └─ 否 → 记录评审意见，人工处理
```

## 重新拆解保留原则

`cometflow plan regenerate` 使用 `--preserve-approved`：

- 未受影响的已批准任务保留。
- 受影响的已批准任务更新 acceptance 或重新生成。
- 目标范围变化导致的多余任务标记为 cancelled。
- 新增任务追加。

## 相关命令

```bash
cometflow plan generate <goal>
cometflow plan validate <goal>
cometflow plan review <goal>
cometflow plan approve <goal>
cometflow plan freeze <goal>
cometflow plan edit <goal>
cometflow plan regenerate <goal> [--preserve-approved]
cometflow plan trace <task-id>
```
