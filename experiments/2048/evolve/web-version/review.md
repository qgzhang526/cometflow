# Evolution Review

## Summary

新增网页版（G6）：与终端版共用引擎/AI，web/index.html 双击可玩，含 AI 提示与 localStorage 最高分

## Risk and gate plan

仅新增 src/web/ui.ts 视图层与构建脚本，不改动 core/ai；已过 typecheck/tests/benchmark/web-build 四道门禁
