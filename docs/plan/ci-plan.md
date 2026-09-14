# CI 门禁计划：让已有的闸门真的生效

状态：已实施
来源：H1–H3 与度量批次落地后，所有门禁都还是「有能力」而不是「在生效」
前置依赖：ADR 0012–0018（spec 版本、可执行验收、原子状态、有界循环、来源绑定、指针路由）、[metrics-plan.md](./metrics-plan.md)

## 背景

仓库此前**没有任何 CI 配置**（`.github/` 不存在）。结果是：

- `spec verify`、`plan validate`、`doctor`、回归脚本都只能靠人手敲；
- 手工改写 `plan_hash`、跳过 `spec lock`、越界改动这类问题，没有任何自动化阻止它们进入仓库；
- 唯一的回归脚本 `experiments/regression-fixture/run-regression.sh` 是 **bash-only**，而主要开发环境是 Windows——本机根本执行不了，「本地没法验证、只能等 CI」。

## 决策

1. **回归执行器改为 Node**（`scripts/regression.mjs`），bash 脚本退化为 shim 转发。两边共用同一份逻辑。
2. **门禁脚本独立**（`scripts/spec-gates.mjs`）：只读判定，失败即退出码非零，可单独在本地跑。
3. **度量作为回归基线**：`experiments/regression-fixture/metrics-baseline.json` 锁住关键指标，只许持平或变好。
4. **CI 三个 job**：`build-test`（双平台）、`spec-gates`、`regression`（双平台）。
5. **依赖构建审批显式化**：提交 `pnpm-workspace.yaml`（`allowBuilds: esbuild`）并放开 `.gitignore`，
   否则 `pnpm install --frozen-lockfile` 会以 `ERR_PNPM_IGNORED_BUILDS` 退出 1。

## 门禁内容

`node scripts/spec-gates.mjs [projectPath] [--update-baseline]`：

| 判定 | 说明 |
|---|---|
| `spec validate` | 结构、anchor、acceptance、跨文件引用 |
| `spec verify` | 一致性门禁（lock 新鲜度、版本仓完整、anchor/验收漂移、plan/state 内容哈希、change 基线冲突） |
| `doctor` | 项目健康（含 spec 完整性、git 漂移、证据占用、残留临时文件） |
| `change gc --json` | 证据回收计划可计算（dry-run，不修改） |
| `plan validate <goal>` | 计划覆盖度与依赖；跳过 fixture 中故意损坏的 `broken.*` |
| `metrics` 对照基线 | 关键指标只许持平或变好（见下） |

指标方向：`acceptance_checkable_rate`、`anchor_coverage_rate`、`specs`、`capabilities`、`versions_total` 越大越好；`drift_count` 越小越好。

## 验收标准

- [x] `node scripts/regression.mjs` 在 Windows 上完整跑通（62 步）
- [x] 故意改写 fixture 的 `plan_hash` → `spec-gates` 退出码 1
- [x] 恢复后重新通过；fixture 工作区不被污染
- [x] `pnpm install --frozen-lockfile` 与 `pnpm test` 在 main 上可用
- [ ] GitHub 上首次运行三个 job 全绿（推送到远端后才能确认）

## 涉及文件

- 新增 `.github/workflows/ci.yml`
- 新增 `scripts/spec-gates.mjs`、`scripts/regression.mjs`
- 新增 `experiments/regression-fixture/metrics-baseline.json`
- 改写 `experiments/regression-fixture/run-regression.sh` 为 shim
- 新增 `pnpm-workspace.yaml`，`.gitignore` 放开该文件
- 更新 `docs/USAGE.md` 第 15 节

## 风险

- **CI 里没有 agent CLI**（opencode/claude-code）：`change run` 类场景继续用 `--agent mock`，
  独立 Verifier 相关路径无法在 CI 覆盖——这是刻意的，CI 只保证「确定性部分」。
- **Windows runner 较慢**：回归在双平台跑会拉长总时长；用 `concurrency` 取消旧运行来抵消。
- **基线需要人工更新**：指标变好不会自动改基线，用 `--update-baseline` 显式更新并在提交里体现。

## 维护记录

- **2026-09-14 首轮 CI（run #1/#2/#3）**：三轮才绿，暴露的问题全部是「只在本机成立」的假设：
  1. 两个测试硬编码开发机绝对路径 `D:/zqg/...`；
  2. `spawn-shim` 用例测的是 Windows `.cmd` shim 解析，未按平台跳过；
  3. `findOrphanTempFiles` 在 `maxAgeMs=0`（默认「不过滤」）时会漏报 mtime 略新于 `Date.now()` 的文件；
  4. 两个测试硬编码了旧版版本仓路径 `.cometflow/spec-versions/`——本机因 fixture 里残留旧副本而通过，干净检出上直接失败。
  第 4 条只有靠 **clean-room 复现**（`git clone` 到临时目录再跑同一条命令）才定位得到，本机全绿与 CI 红并存时这是最快的定位手段。
- **action 版本**：`actions/checkout@v7` / `actions/setup-node@v7` / `pnpm/action-setup@v6`（均 `using: node24`），消除 Node 20 弃用警告；升级前已核对这三个版本仍支持本项目用到的 `node-version` / `cache: pnpm` / `version` 输入。
- **手动触发**：workflow 增加 `workflow_dispatch`，重跑不必空提交。
- **状态徽章**：README 顶部接入 CI badge。

## 完成状态

已实施（除「GitHub 上首次运行」需推送后确认）。

### 实现记录

- **回归执行器的移植立刻抓出一个真实缺陷**：H3-2 那段 bash 脚本从未在本机执行过
  （没有 bash），`git-demo` 少了一步 `confirm-acceptance` 就调用 `change run`，
  于是「被阻断」断言实际是因为阶段不对而通过——门禁看起来是绿的，其实没验证到漂移。
  移植后修正，并把否定断言收紧到必须匹配具体原因（`git provenance drift` / `is blocked` / `denied: multiple-active-changes`）。
- `pnpm-workspace.yaml` 与 `.gitignore` 的改动与并行会话在 W 分支上的版本**逐字一致**，
  避免后续 rebase 冲突。
