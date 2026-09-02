# 基线记录（2026-09-01）

实验项目：experiments/2048（终端 2048 + AI 玩家，CometFlow 自举验证）

## 基线命令与结果

| 命令 | 结果 |
|---|---|
| `cometflow init experiments/2048` | initialized |
| `cometflow goal sync .` | 生成 G1~G5 共 5 个 goal |
| `cometflow spec validate .` | spec validate: OK |
| `cometflow spec lock .` | 写入 spec-lock.json（12 个 anchor） |
| `cometflow plan generate G1 .` | 生成 3 个实现任务 |
| `cometflow plan validate G1 .` | OK |
| `cometflow plan review / approve / freeze G1 .` | frozen，acceptance_ids 已提取 |
| `cometflow plan trace G1 .` | T1~T3 均带 spec anchor + acceptance |

## 平台观察（实验起点）

1. `pnpm dev` 被 pnpm deps-status-check 拦截（ERR_PNPM_IGNORED_BUILDS: esbuild@0.28.2），
   已改用 `node ./node_modules/tsx/dist/cli.mjs app/cli/index.ts` 直接运行 CLI。
2. `evolve verify` 默认门禁为 stub（只跑 `node -e process.exit(0)`），H3 需以
   `cometflow eval` 人工放行 —— 已列入 specs/report/spec.md 的 A410。
3. G1 拆解结果：3 个任务、10 条 acceptance，plan validate 一次通过（无拆解缺陷捕获，
   符合小规模纯函数模块的预期；H2 的完整判据需在全部 5 个 Goal 执行后统计）。
## 更新（同日）：opencode 安装与平台修复

- 安装：`npm install -g opencode-ai@1.18.25`（全局，实际可执行文件为 opencode.exe）。
- 平台修复：`platform/process/spawn-command.ts` 增加 Windows `.cmd` shim 解析——
  `execFile` 无法直接执行 `.cmd`，ENOENT 时解析 npm/pnpm shim 转发到真实程序
  （`opencode.exe` / `node <script>.mjs`），参数以数组直传、不经 shell（无注入/拆词问题）。
- 结果：`agent check opencode` → available；`agent list` 双 agent 可用。
- 新增 `test/domains/spawn-shim.test.ts`（4 用例），tsc + vitest 共 26 用例全部通过。
## 更新：G1 真实 Agent 试跑（opencode / deepseek-v4-flash）

- 2026-09-01 首次真实 Agent 无人值守试跑成功：`cometflow run --agent opencode --model deepseek/deepseek-v4-flash`。
- Agent 自主完成：G1 引擎复验、G2 CLI 补测试（含修复快照按引用共享 bug）、G3 AI 从零实现
  （expectimax 启发式搜索 + benchmark）+ 单测；并自行把 G2/G3 计划 review→approve→freeze。
- 最终状态：`tsc --noEmit` 通过；vitest 8 文件 / 49 用例全部通过；`--snapshot` 输出 ANSI-free 可解析；
  benchmark 输出合法 JSON（100 局 ≈53s，max tile 可达 2048，win_rate≈0.01）。
- Agent 决策记录见 reports/latest.md（AI 默认 depth=1/timeout 200ms、main.ts→bin.ts 重构等）。
- 平台修复（本次 dogfooding 发现，均已在 cometflow 核心落地并单测覆盖）：
  1) spawn-command Windows `.cmd` shim 解析（npm 全局 CLI 可被 agent check/run 使用）；
  2) Windows 控制台程序（opencode.exe）在 execFile 管道/关闭等待下卡 init → 新增 spawn+stdio inherit 路径；
  3) opencode runner 移除 `--dir`（绝对路径被误解析为 git 根）；
  4) `cometflow run` 完成时输出摘要行（inherit 模式下原本零输出）；
  5) flow prompt 增加「读取冻结计划、只实现冻结任务」指令（agent 实际遵守：未动 G4/G5）。
## 更新：G4/G5/H3/H4 完成（daemon 无人值守轮，2026-09-01）

- `daemon start --mode always --budget 35min` 无人值守一轮：Agent 完成 G4 验收归档（A301~A312，
  change g4-persistence / g4-persistence-robustness 全生命周期 archive）与 G5 自举验证报告
  （reports/self-bootstrap-report.md + tests/report/report.test.ts），H1~H4 逐条数据+判定。
- H3：`.cometflow/eval.yaml`（typecheck/tests/benchmark-smoke）接入，`cometflow eval` 三项 PASS；
  `evolve verify ai-heuristic-weight` 经真实门禁 → verified；平台侧 evolve 默认门禁已从 stub 升级为
  真实 tsc+vitest（domains/evolution/evolution-service.ts，支持 .cometflow/evolve.yaml 覆盖）。
- H4：change 状态机 shape→build→verify→archive 全链路验证；跨会话断点恢复 2/2。
- 终态：游戏 9 文件 55 用例全过；平台 12 文件 28 用例全过；5 goal 12 任务全部完成并归档。
## 更新：H2 补强实验（2026-09-02）

- 平台：plan validate 新增 missing-coverage 与 dependency-cycle 检查。
- 负测试：注入 6 类拆解缺陷全部被拦截（+7 用例，平台 35 全绿）。
- 正测试：G1~G9 全部 9 个冻结计划 validate OK（0 误报）。
- G9（撤销一步）真实 agent 实验：26 个冻结任务 validate 0 缺陷；spec 歧义点由 Agent 决策日志消解
  （撤销上限默认 10、快照重建不侵入引擎）；68 测试全绿；commit 9270aa6。
- H2 判定由「部分成立」升级为「成立（条件成立）」。