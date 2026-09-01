# ADR 0002：任务与 spec 关联发生在拆解与冻结阶段

状态：已批准  
日期：2026-09-01

## 决策

任务与 spec 的关联分两阶段：

1. `plan generate` 建立草稿关联。
2. `plan freeze` 冻结关联并提取 A1..An、记录 spec 版本与 hash。

执行阶段不再重新解释关联。

## 理由

- 让关联可机器校验、可追溯。
- 避免 Agent 在执行时现场理解 spec 导致漂移。

## 后果

- Task Plan 必须结构化。
- 需要 plan validate 的 coverage / precision 检查。
