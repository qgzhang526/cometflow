# 002 Spec 驱动内核

## 原则

**代码质量的根本是 spec 质量。**

CometFlow 不把 spec 当作普通文档，而把它当作机器可校验、可派生 acceptance、可追踪的契约。

## Spec 分层

```text
① 使命层   COMETFLOW.md
② 领域层   specs/
③ 变更层   changes/<name>/
④ 正式层   specs/（Archive 后原子更新）
```

### ① 使命层

人类编写的项目使命、当前目标、质量基线、约束和模块归属。

### ② 领域层

人类维护的项目级规范：

- specs/models.md
- specs/constraints.md
- specs/permissions.md
- specs/rules.md
- specs/<capability>/spec.md
- specs/flows/<flow>.md

### ③ 变更层

一个 Change 的工作区：

- brief.md
- specs/<capability>/spec.md（可选，仅在需要新增或修改 spec 时出现）
- acceptance.md（机器生成）
- comet-state.yaml
- verification.md

### ④ 正式层

Change 通过验收并 Archive 后，由 Runtime 原子更新 canonical spec。

## 单一事实源

### 任务目标

- **人类只编辑 COMETFLOW.md。**
- **.cometflow/goals/G1.yaml 是机器生成的投影，不手工编辑。**

```text
人类编辑：COMETFLOW.md
      │
      ▼
cometflow goal sync
      │
      ▼
生成：.cometflow/goals/G1.yaml
      │
      ▼
cometflow plan generate G1
      │
      ▼
生成：.cometflow/plans/G1.task-plan.yaml
```

### 项目级 spec

- **人类只编辑 specs/。**
- Agent 只能生成 [DRAFT] 草案，人工批准后才能成为正式 spec。
- Agent 不能直接覆盖 canonical spec。

## 目录布局

```text
project/
├─ COMETFLOW.md
├─ specs/
│  ├─ models.md
│  ├─ constraints.md
│  ├─ permissions.md
│  ├─ rules.md
│  ├─ auth/spec.md
│  └─ flows/login.md
├─ .cometflow/
│  ├─ config.yaml
│  ├─ goals/G1.yaml
│  ├─ plans/G1.task-plan.yaml
│  └─ runtime/
├─ changes/
│  └─ auth-email-login/
│     ├─ brief.md
│     ├─ specs/auth/spec.md
│     ├─ acceptance.md
│     ├─ comet-state.yaml
│     └─ verification.md
└─ reports/
```

## Spec Anchor 与 Acceptance

### Spec Anchor

任务绑定 spec 时使用可机器解析的 anchor：

```yaml
spec_ref: specs/auth/spec.md
spec_anchor: "POST /api/auth/email-login"
```

不允许使用自由文本如“用户登录相关 spec”。

### Acceptance 提取

spec 中应包含明确的 Acceptance 段落：

```markdown
## Acceptance

- A1：未注册邮箱可以获取验证码
- A2：验证码错误返回 401 INVALID_CODE
- A3：验证码过期返回 401 CODE_EXPIRED
```

`cometflow plan freeze` 时提取为 `A1..An` 并锁定。

## Spec 生命周期

```text
spec 缺失
  → Brownfield Draft：Agent 逆向生成 [DRAFT]
  → 人工 review
  → 批准为正式 spec

spec 已存在
  → 任务引用 spec anchor
  → freeze 提取 acceptance
  → 实现
  → 验证
  → Archive 应用新 spec
```

## 相关命令

```bash
cometflow goal sync
cometflow spec validate
cometflow spec diff
cometflow spec freeze <change>
cometflow spec apply <change>
cometflow spec trace <change>
cometflow spec generate --draft
```
