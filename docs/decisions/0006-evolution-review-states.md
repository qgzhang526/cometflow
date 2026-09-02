# ADR 0006：Evolve 提案采用 approved/rejected 终态与评审命令

状态：已批准
日期：2026-09-02

## 决策

- `EvolutionStatus` 增加 `approved` 终态，与既有 `rejected` 构成完整终态集合。
- 新增 `evolve approve`（--note / --commits）与 `evolve reject`（--reason）命令，从
  `ready-for-review` 或 `verified` 进入终态。
- 新增 `evolve review-list` 盘点提案，支持 --json。
- approve/reject 决策写入 proposal（review_note / merged_commits / rejected_reason /
  decision_at）并追加到 review.md。

## 理由

- 自举实验发现：提案停在 ready-for-review 后无落地/归档动作（断头流程），评审只能靠手工改文件。
- 人类评审应只有一次明确决策点（批准或拒绝），之后状态机自行归档。
- merged_commits 回填让「先实现后补提案」与「先提案后落地」两种模式都可审计。

## 后果

- `rollback` 指引需要 merged_commits 才有可执行目标（后续 approve 自动打 tag 增强）。
- 既有提案文件需补 decision 字段（本次 6 个提案已全部补录并 approved）。
