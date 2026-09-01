# ai capability

AI 玩家与 benchmark：可配置深度的启发式搜索，输出可复现指标。

## FR-AI-001 AI 决策

AI 基于当前棋盘选择下一步方向；搜索深度可配置；单次决策时间有界（可配置超时）。

## 验收

- A201：AI 返回合法方向（上/下/左/右）
- A202：搜索深度配置生效且结果可复现
- A203：单次决策在配置超时内返回

## FR-AI-002 benchmark

benchmark 模式：固定种子运行 N 局，输出 JSON 指标。

## 验收

- A210：benchmark 输出合法 JSON
- A211：指标包含 max_tile、score、moves、win_rate
- A212：相同种子运行两次结果一致
- A213：默认 N=100 且 N 可配置
