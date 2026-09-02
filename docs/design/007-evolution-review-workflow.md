# 007 Evolve 评审与终态工作流

状态：已实现（2026-09-02，commit c66ec5a）
关联：005-cli-and-workflow.md、ADR 0006

## 目标

给进化提案一条**可评审、可落地、有终态**的完整生命周期，取代「停在 ready-for-review 等人手工处理」的断头流程。

## 状态机

```text
propose ──► draft ──► verifying ──► verified ──► ready-for-review ──► approved
                       │   ▲                               │            ▲
                       │   │ (verify 失败)                  │            │
                       ▼   └─────────────── rejected ◄─────┴── reject ──┘
                     rejected
```

- `verified`：真实门禁通过（typecheck/tests/benchmark/web-build 等，来自项目 `.cometflow/evolve.yaml`；`--eval` 叠加本地科学评估 pass@k/pass^k）。
- `ready-for-review`：`submit` 生成 `evolve/<name>/review.md`（摘要+风险计划），等待人类决策。
- `approved` / `rejected`：**终态**。approve 支持从 `ready-for-review` 或 `verified` 进入（允许"验证后直接批准"的轻流程）；reject 支持从任意非终态进入。

## 命令

```bash
cometflow evolve propose <name> --summary ... [--risk ...] [--path .]
cometflow evolve verify <name> [path] [--eval]        # 真实门禁 (+科学评估)
cometflow evolve submit <name> [path]                 # → ready-for-review，生成 review.md
cometflow evolve status <name> [path]
cometflow evolve review-list [path] [--json]          # 提案盘点（含终态标注）
cometflow evolve approve <name> [path] --note <text> [--commits <csv>]   # → approved（终态）
cometflow evolve reject <name> [path] --reason <text>                    # → rejected（终态）
cometflow evolve rollback <name> [path]               # 打印回滚指引
```

## 决策字段（写入 evolve/<name>.yaml）

| 字段 | approve 写入 | reject 写入 |
|---|---|---|
| `status` | `approved` | `rejected` |
| `review_note` | 评审备注 | — |
| `merged_commits` | 已合入代码的 commit 列表 | — |
| `rejected_reason` | — | 拒绝原因 |
| `decision_at` | 决策时间 | 决策时间 |

approve/reject 同时把决策（APPROVED/REJECTED + note）追加到 `evolve/<name>/review.md`。

## 评审清单流程（人工侧）

1. `evolve review-list` 盘点提案（状态/摘要/门禁证据/关联 commit）；
2. 人工逐项决策：批准 / 拒绝 / 退回修订；
3. **批准落地**：
   - 代码已合入的提案 → approve 时用 `--commits` 回填实际 commit；
   - 未落地的提案（如 AI 权重调优）→ 先落地并跑对比评估，再 approve；
4. **拒绝**：已合入按 rollback 指引 git revert；未合入直接 reject；
5. 决策回填 reports/latest.md 与项目自举报告。

## 实测案例（experiments/2048，2026-09-02）

- 6 个提案全部经 `evolve approve` 归档为 approved（web-version / web-animations / web-ai-demo /
  web-undo / sci-eval-demo / ai-heuristic-weight），merged_commits 均回填；
- ai-heuristic-weight：落地 c1（EMPTY_WEIGHT 270→320，commit a86b4c4）后 approve——
  确定性对比（n=100 seed=1 depth=1）：win_rate 0.01→0.03、avg score +5.3%、avg max tile +2.2%
  （H3 的 ≥10pp 判据未达，记录为部分正结果）。

## 后续增强

- approve 时自动打 `evolve-<name>` git tag，让 rollback 指引可直接执行；
- `evolve review-list --pending` 过滤待评审；
- 评审意见多人/多轮（退回修订状态）。
