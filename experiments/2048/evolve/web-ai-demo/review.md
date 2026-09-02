# Evolution Review

## Summary

网页版 AI 自动演示（G8）：点击按钮 AI 自动下棋，可随时手动接管；60 测试全绿

## Risk and gate plan

仅改 src/web/ui.ts 与 index.html，不改 core/ai；演示间隔 150ms，键盘/滑动/重开/提示均会打断

## Decision

- APPROVED
- note: 人工评审批准（清单#3）代码已合入
