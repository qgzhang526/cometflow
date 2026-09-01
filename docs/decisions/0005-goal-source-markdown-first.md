# ADR 0005：任务目标以 Markdown 为人类事实源

状态：已批准  
日期：2026-09-01

## 决策

- 人类只编辑 `COMETFLOW.md` 中的任务目标。
- `.cometflow/goals/G1.yaml` 由 `cometflow goal sync` 生成，不手工编辑。
- 若两者冲突，以 `COMETFLOW.md` 为准并重新 sync。

## 理由

- 符合“人类只写项目级 spec 和任务目标”的习惯。
- Markdown 适合自然语言目标。
- 机器投影可再生成，不应成为事实源。

## 后果

- 需要 goal sync 命令。
- 需要 source_hash 校验。
