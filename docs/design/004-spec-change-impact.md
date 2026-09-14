# 004 Spec 变更对已完成任务的影响

状态：已实施（影响分析与分级见 [011-spec-versioning.md](./011-spec-versioning.md)）

## 核心原则

**已完成任务是历史，历史不可变。**

spec 变更后，不修改已完成任务的历史记录，而是生成新的 reconciliation change。

## Spec 版本锁定

每个任务冻结时记录：

```yaml
spec_ref: specs/auth/spec.md
spec_version: 3
spec_hash: "abc123"
acceptance_ids: [A1, A2, A3]
```

## 影响分析

```bash
cometflow spec diff --impact
```

（实现为 `cometflow spec diff <path> --impact`，另支持 `--change <name>` 在归档前预览提案 spec 的影响。）

变更分类：

| 类型 | 示例 | 影响 |
|---|---|---|
| 新增字段/接口 | 响应增加可选字段 | 低，通常兼容 |
| 修改约束 | 字段长度变化 | 中，可能回归 |
| 修改语义 | 返回码变化 | 高，已有实现冲突 |
| 删除接口/字段 | 删除 API | 高，直接影响 |
| 全局约束变化 | 认证方式变化 | 极高，跨模块影响 |

## 响应策略

### 未开始任务

重新生成受影响任务的关联：

```bash
cometflow plan regenerate G1 --preserve-approved
```

### 进行中任务

```bash
cometflow change revise <change>
```

### 已完成任务

创建 reconciliation change：

```text
spec v3 → v4
T1 已完成并引用 v3
  → 不修改 T1 历史
  → 创建 change: spec-drift-auth-v4
  → 按 v4 重新实现/修改/删除
```

## 高影响变更暂停

以下情况必须暂停等待人工：

- 删除已有 capability。
- 修改数据模型主键或关系。
- 修改认证/权限模型。
- 影响多个已完成任务。
- 涉及数据迁移。

生成 impact report：

```text
specs/auth/spec.md v3 → v4

影响任务：
  T1 completed — 登录返回码变化
  T3 completed — email 字段改为唯一
  T5 completed — 认证方式变化

建议：
  - 创建 2 个 reconciliation change
  - T5 涉及权限模型，需人工确认
```

## 机器 diff 与语义 diff

- 机器 diff：表格字段、API 路径、模型字段、acceptance 增删。
- 语义 diff：Reviewer Agent 判断 prose 变化是否改变行为。

## 相关命令

```bash
cometflow spec diff --impact
cometflow spec drift
cometflow change rebase <change>
cometflow plan regenerate <goal> --preserve-approved
```
