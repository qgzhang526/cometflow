# 实验：终端 2048 + AI 玩家（CometFlow 自举验证）

## 实验定位

用 cometflow 自身开发一款**可玩、可测、可自动评估**的终端 2048 游戏，产出平台首个
「真实 Agent 端到端自举验证报告」。这是平台第一次被真实用户项目使用（dogfooding）。

## 实验假设

| # | 假设 | 可测结果 |
|---|---|---|
| H1 | spec → task → acceptance → trace 闭环能指导真实 Agent 交付 | 全部 acceptance_ids 有 trace，核心单测 100% 通过 |
| H2 | 自动拆解（plan generate/validate/review）足够精确 | plan validate 捕获的问题数、rework 次数 |
| H3 | eval 门禁能拦截回归，evolve 能提升质量 | AI benchmark 胜率/指标变化 |
| H4 | 无人值守（daemon + change 恢复）可持续产出 | 预算内完成率、断点恢复成功率 |

## 目录结构

```text
experiments/2048/
├── COMETFLOW.md            # 人类唯一事实源：使命 + 目标 G1..G5
├── specs/                  # 项目级 spec（core/cli/ai/persistence/report）
├── .cometflow/
│   ├── config.yaml         # 项目配置（plan_review: auto）
│   ├── goals/*.yaml        # goal sync 生成
│   └── plans/*.task-plan.yaml
├── reports/                # 自举验证报告（G5 验收）
├── src/                    # 引擎/CLI/AI 实现（G1~G4）
└── tests/                  # vitest 单测 + benchmark
```

## 执行路线

```bash
# 0. 基线（已完成）
cometflow goal sync .                 # 生成 .cometflow/goals/G1..G5.yaml
cometflow spec validate .             # specs 结构校验
cometflow spec lock .                 # 快照 spec hash 基线

# 1. 每个 Goal：拆解 → 审核 → 冻结 → trace
cometflow plan generate G1 .
cometflow plan validate G1 .
cometflow plan review G1 .
cometflow plan approve G1 .
cometflow plan freeze G1 .
cometflow plan trace G1 .

# 2. 执行：先受控 run，再切无人值守
cometflow run . --budget 2h --agent opencode
cometflow daemon start . --mode idle --budget 4h
cometflow status . --watch
cometflow dashboard .

# 3. 评估与进化（H3）
cometflow eval .                        # 执行 .cometflow/eval.yaml
cometflow evolve propose "AI 启发式加权改进" --summary ... --path .
cometflow evolve verify <name> .
cometflow evolve submit <name> .

# 4. 收尾（G5）
cometflow spec trace G1 .
# 汇总 reports/self-bootstrap-report.md
```

> 本机 pnpm 的 deps-status-check 会被 esbuild 构建脚本拦截（ERR_PNPM_IGNORED_BUILDS），
> 运行 cometflow CLI 时请直接使用：`node ./node_modules/tsx/dist/cli.mjs app/cli/index.ts <cmd>`
> （在仓库根目录执行），或先 `pnpm approve-builds`。

## 已知平台发现（实验起点，G5 需复核）

- **（已修复）Windows shim 兼容**：`platform/process/spawn-command.ts` 现可解析
  npm/pnpm `.cmd` shim（opencode 等 npm 全局 CLI 在 Windows 可被 agent check/run 使用）。
- **evolve verify 默认门禁是 stub**：`domains/evolution/evolution-service.ts` 的 DEFAULT_GATES
  只执行 `node -e process.exit(0)`，typecheck/tests 不会真实运行。H3 的 eval 门禁在平台补齐前，
  需要以 `cometflow eval` 结果人工放行——这本身就是一条平台改进项（specs/report A410）。

## 成败判据

- 平台侧：无人值守完成 ≥80% 冻结任务；plan validate/review 捕获 ≥1 个真实拆解缺陷；
  eval 门禁拦截 ≥1 次回归（或记录 0 拦截的原因）；产出 ≥1 条平台缺陷/改进项。
- 游戏侧：引擎单测 100% 通过；`benchmark -n 100` 无崩溃；AI 胜率（max tile ≥ 2048）
  经 evolve 提升 ≥10 个百分点，或记录明确负结果。