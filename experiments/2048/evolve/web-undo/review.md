# Evolution Review

## Summary

网页版撤销一步（G9）：U 键与按钮恢复上一步棋盘/分数，可配置上限；68 测试全绿

## Risk and gate plan

仅新增 src/web/undo.ts 并在 src/web/ui.ts 视图层接入，不改 core/ai；撤销栈按值复制快照，不侵入引擎

## Decision

- APPROVED
- note: 人工评审批准（清单#4）代码已合入（agent 提交）
