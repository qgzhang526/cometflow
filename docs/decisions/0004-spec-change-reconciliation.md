# ADR 0004：已完成任务不可变，spec 变更走 reconciliation

状态：已批准  
日期：2026-09-01

## 决策

- 已完成任务及其验收记录不可修改。
- spec 变更后，通过 `spec diff --impact` 识别受影响任务。
- 受影响任务不重开，而是创建新的 reconciliation change。

## 理由

- 保持历史可信。
- spec 演进可追溯。
- 避免污染已完成工作的状态。

## 后果

- 每个任务冻结时必须记录 spec 版本和 hash。
- 需要影响分类和 drift 检测。
