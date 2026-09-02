# Evolution Review

## Summary

调整 AI 启发式权重（空位/单调性/平滑度），目标是提升 benchmark 胜率

## Risk and gate plan

仅改 src/ai/ai.ts 启发式系数；若胜率下降可回滚

## Decision

- APPROVED
- note: 清单#5 落地 c1(EMPTY=320)：win_rate 0.01->0.03、score +5.3%、max +2.2%（≥10pp 判据未达，记录部分正结果）
