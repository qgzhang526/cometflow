# ADR 0001：项目级 spec 是唯一事实源

状态：已批准  
日期：2026-09-01

## 决策

- 人类只编辑 `COMETFLOW.md` 和 `specs/`。
- Agent 不能直接覆盖 canonical spec。
- 机器生成物（goals/*.yaml、task-plan、acceptance、report）不是事实源。

## 理由

- 避免双重事实源和漂移。
- 保证人类意图可读、可审查、可回滚。
- 使自动拆解和验证有明确输入。

## 后果

- 需要 `goal sync` 和生成物校验。
- 需要 Hook Guard 保护 specs/ 与 COMETFLOW.md。
