# Phase 1：Workflow / Spec 闭环补强

状态：待开始
前置依赖：当前 MVP 已实现 change 状态机与 spec lock/diff。

## 目标

让断点续作和 spec 演进不再依赖人工阅读 `comet-state.yaml` 或 `spec-lock.json`。

## 范围

### 包含

- `cometflow change list [path]`
- `cometflow change resume <name> [path]`
- `cometflow spec drift [path]`
- `cometflow plan regenerate <goal> [path] --preserve-approved`

### 不包含

- 科学评估 Pass@k / Pass^k
- 调度器队列持久化
- Skill / Bundle
- 完整 Builder / Verifier 分离

## 具体任务

### T1：实现 `change list`

工作项：

- 枚举 `changes/*/comet-state.yaml`。
- 输出字段：`name`、`phase`、`status`、`task`、`archived`。
- 默认隐藏已归档 change；`--all` 显示全部。
- 支持 `--json`。

验收标准：

- [ ] `cometflow change list` 只列出 active change。
- [ ] `cometflow change list --all` 包含 archived change。
- [ ] `--json` 输出可被程序解析。
- [ ] 单测覆盖 active/archived/json 三种情况。

### T2：实现 `change resume`

工作项：

- 读取目标 change 的 `comet-state.yaml`。
- 根据 `phase` 输出下一步动作：

```text
shape   -> confirm-acceptance
build   -> submit-candidate
verify  -> verify-pass
archive -> archive-complete
```

- 若 `archived=true`，报告“已归档，无需续作”。
- 支持 `--json`。

验收标准：

- [ ] 四个 phase 均给出正确下一步动作。
- [ ] 已归档 change 不给出 transition 建议。
- [ ] change 不存在时报错清晰。
- [ ] 单测覆盖 4 个 phase 和 archived 分支。

### T3：实现 `spec drift`

工作项：

- 读取 `spec-lock.json` 和当前 spec hash。
- 读取所有冻结 task 的 `spec_hash`。
- 找出 spec 当前内容与任务冻结版本不一致的任务。
- 输出 drift 报告：

```text
task: T1
  spec: specs/auth/spec.md
  frozen_hash: <old>
  current_hash: <new>
```

验收标准：

- [ ] spec 未变化时 drift 为空。
- [ ] spec 变化时能定位到具体冻结任务。
- [ ] `--json` 输出可解析。
- [ ] 单测覆盖“无 drift / 有 drift / 多任务受影响”。

### T4：实现 `plan regenerate --preserve-approved`

工作项：

- 以现有 goal 和最新 spec 重新生成计划。
- 未受影响且已批准的任务保留原状态。
- 受影响任务更新：

```yaml
spec_version: <new>
spec_hash: <new>
acceptance_ids: [A1..An]
```

- 目标范围变化产生的多余任务标记为 `cancelled`。
- 新增任务追加，并进入 `draft`。

验收标准：

- [ ] 无 spec 变化时，`--preserve-approved` 不改变已批准任务。
- [ ] spec 变化时，只更新受影响任务。
- [ ] goal 范围变化时，正确新增/取消任务。
- [ ] 单测覆盖“无变化 / spec 变化 / 目标变化”。

## 涉及文件

- `app/commands/change.ts`
- `domains/workflow/change-store.ts`
- `app/commands/spec.ts`
- `domains/spec/spec-lock.ts`
- `app/commands/plan.ts`
- `domains/task-plan/task-plan-generate.ts`
- `domains/task-plan/task-plan-store.ts`

## 风险

- `plan regenerate` 可能误判“未受影响任务”。
- 缓解：以 `spec_hash` 为准，不比较任务标题或 summary。

- `spec drift` 依赖冻结任务保留 `spec_hash`。
- 缓解：冻结逻辑已记录 `spec_hash`；缺失时标记为 `unknown`，不静默跳过。

## 完成状态

未开始。
