# Evolve 提案评审清单（Review Checklist）

生成日期：2026-09-02
项目：experiments/2048（CometFlow 自举实验）
说明：本清单汇总全部 evolve 提案的评审材料。人工逐项决策后，按「批准落地 / 拒绝回滚 / 退回修订」推进，
并将结果回填至 reports/latest.md 与 reports/self-bootstrap-report.md。

## 评审依据

- 每个提案的 review.md（摘要 + 风险计划）与 proposal.yaml（门禁、eval 证据）；
- verify 均为真实门禁：typecheck / tests / benchmark / web-build；
- 代码是否已合入：对照关联 commit diff 与当前工作树。

## 决策表（请逐项填写「决策」与「备注」）

| # | 提案 | 状态 | 关联 Goal | 代码落地 | 门禁/eval 证据 | 建议 | 决策（批准/拒绝/退回） | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | web-version | ready-for-review | G6 网页版 | ✅ 已合入（b25e70d 实现 + 69ce0ff 正规化） | 4 门禁 OK | **批准**（确认一致后回填 commit） | ✅ 批准 | 待 evolve approve 正式归档 |
| 2 | web-animations | ready-for-review | G7 动画 | ✅ 已合入（51614d8） | 4 门禁 OK | **批准** | ✅ 批准 | 待 evolve approve 正式归档 |
| 3 | web-ai-demo | ready-for-review | G8 AI 演示 | ✅ 已合入（985267d） | 4 门禁 OK | **批准** | ✅ 批准 | 待 evolve approve 正式归档 |
| 4 | web-undo | ready-for-review | G9 撤销 | ✅ 已合入（9270aa6，agent 提交） | 4 门禁 OK + spec lock 归零 | **批准** | ✅ 批准 | 待 evolve approve 正式归档 |
| 5 | ai-heuristic-weight | verified | G3 AI 权重 | ❌ 未落地（src/ai/ai.ts 未改） | 4 门禁 OK（仅验证提案本身） | **需落地实测后决策**：改权重→100 局对比 win_rate | 落地对比中 | 结果决定 approve/reject（H3 判据 ≥10pp） |
| 6 | sci-eval-demo | verified | 平台 Phase 2 | 无代码改动 | 4 门禁 OK + eval pass@k/pass^k=1.00 | **批准=记录** | ✅ 批准 | 待 evolve approve 正式归档 |

## 批准后的落地动作

1. **web 系列（#1~#4，代码已合入）**：确认工作树与提案一致 → 在提案 yaml 追加 `merged_commits` 与 `reviewed_at`/决策字段 → 状态记为 accepted
   （平台暂无 `evolve approve` 命令，先以文档字段记录，待平台补 evolve 终态工作流）。
2. **sci-eval-demo（#6）**：纯验证提案，批准后归档记录即可。
3. **ai-heuristic-weight（#5，若批准）**：执行落地对比：
   - 基线（已记录）：benchmark --n 100 --seed 1 --depth 1 → win_rate≈0.01、avg score≈9560、avg max tile≈699；
   - 动作：调整 src/ai/ai.ts 启发式系数（EMPTY/SMOOTH/MONO/CORNER 权重）；
   - 判据：同参数 100 局 win_rate 提升 ≥10pp（H3 判据）；达标→合入并更新 G5 报告 H3 为正结果；不达标→拒绝归档并保留负结果记录。

## 拒绝 / 退回

- 已合入代码（#1~#4）：不涉及回滚（提案与实现同步合入，批准仅确认）；若评审认为实现有问题，走
  `cometflow change` 或直接 git revert 对应 commit，并在提案记录 rejected 原因。
- 未落地（#5）：直接置 rejected 归档即可，无代码需要回滚。

## 后续（平台增强建议，非本次范围）

- `evolve approve|reject <name>` 命令 + approved/rejected 终态；
- `evolve review-list` 自动生成本清单；
- approve 时自动打 `evolve-<name>` tag，支撑 rollback 指引。
