# 度量批次：把已有证据变成数字

状态：已实施
来源：H1–H3 落地后，`journal` / `change state` / `spec` 三层已经记录了完整证据，但没有任何地方聚合它们
前置依赖：ADR 0012（spec 版本即产物）、ADR 0013（验收可执行）、ADR 0016（有界修复循环）

## 要回答的问题

「spec 是根源、代码可重建、重建出来的代码可用」这句话目前**没有数字支撑**。本批次把已有记录变成两组可复查的指标，
分别回答两个问题：

| 问题 | 指标组 |
|---|---|
| 按 spec 重建出来的代码，一次就能通过吗？ | 重建质量（rebuild） |
| spec 本身够不够格当判据？ | spec 健康度（spec health） |

## 数据来源（不新增任何状态）

| 事实源 | 已记录内容 |
|---|---|
| `journal.jsonl` 的 `verify-result` | `passed`、逐条验收结论与来源、`violations`、`repair_attempts`、`max_repair_attempts`、`stalled` |
| `changes/<name>/comet-state.yaml` | `status`（含 `blocked`）、`repair_attempts`、`spec_ref`、`spec_version`、`module`、`archived` |
| `specs/**` + `.cometflow/plans/*.yaml` | anchor、acceptance、`check` 覆盖、任务绑定 |
| `.cometflow-history/spec-history.json` | 版本链与变更时间 |
| `collectSpecDrift` | 冻结任务漂移与分类 |

## 命令

```bash
cometflow metrics [path] [--json]
```

默认输出人类可读摘要；`--json` 输出 `cometflow.metrics.v1` 报告。

## 指标定义

### 重建质量

| 指标 | 定义 |
|---|---|
| `sample_size` | 至少出现过一次 `verify-result` 的 change 数（唯一有意义的分母） |
| `first_pass_rate` | 首次验证即通过（`passed` 且 `repair_attempts=0`）的占比 |
| `mean_attempts_to_pass` | 最终通过的 change 在「首次通过那一刻」的 `repair_attempts` 均值 |
| `pass_rate` | 已归档 / 样本数 |
| `blocked_rate` | 因同一失败结论停机 / 样本数 |
| `verdict_sources` | 结论来源分布（`check` / `document` / `agent` / `eval` / `uncovered`） |
| `check_coverage_rate` | 结论全部来自 `check` 的 change 占比 |
| `per_capability` / `per_module` | 按 capability 与模块切分上述指标 |

### spec 健康度

| 指标 | 定义 |
|---|---|
| `acceptance_checkable_rate` | 带 `- check:` 的验收项 / 全部验收项 |
| `anchor_coverage` | 被冻结或已批准任务绑定的 anchor / 全部 anchor（附未覆盖清单） |
| `drift` | 漂移数量、按 kind 与 severity 的分布、无法比对的数量、最早漂移 spec 的变更年龄 |
| `versions` | 被跟踪 spec 数、版本总数、出现过多版本的 spec 数 |

## 确定性要求

- 所有集合输出按稳定键排序；同一输入两次运行结果逐字相同。
- 所有时间相关字段来自**一个注入的 `now`**（测试传入固定时间，CLI 用当前时间）。
- 样本为空时输出 `null` 而不是 `0`，避免把「没有数据」误读成「表现完美」。
- `sample_size < 5` 时在 `notes` 里显式标注「样本过小，不要据此判断趋势」。

## 验收标准

- [ ] `cometflow metrics .` 在 `experiments/regression-fixture` 上输出非零样本且不报错
- [ ] 同一输入两次运行输出完全一致（注入同一 `now`）
- [ ] `--json` 输出可被 `JSON.parse` 且字段与本文档一致
- [ ] 纯只读：不写任何文件（测试断言运行前后 `.cometflow/` 无变化）
- [ ] 空项目（没有 change、没有 spec）不抛错，输出 `sample_size: 0` 与全部 `null`
- [ ] 单元测试覆盖：首轮通过识别、修复轮数均值、blocked 率、check 覆盖率、验收可判定率、anchor 覆盖率、漂移汇总

## 涉及文件

- 新增 `domains/metrics/types.ts`、`rebuild-metrics.ts`、`spec-health.ts`、`metrics-service.ts`
- 新增 `app/commands/metrics.ts`，`app/cli/index.ts` 注册 `metrics`
- 新增 `test/domains/metrics.test.ts`
- 更新 `docs/USAGE.md`、`experiments/regression-fixture/run-regression.sh`

## 风险

- **样本量误导**：小项目可能只有 2–3 个 change。缓解：`null` 语义 + `notes` 显式标注。
- **journal 轮转**：`readChangeJournal` 默认只返回最近 2000 条；度量必须显式要求全量，否则会低估样本。缓解：`limit: 0` 并单测覆盖。
- **老 change 缺字段**：`repair_attempts` 缺失按 0 处理，但会记入 `notes` 的 `legacy_changes` 计数，避免悄悄污染分母。

## 完成状态

已实施，见下方「实现记录」。

### 实现记录

- `domains/metrics/rebuild-metrics.ts`：从 change 状态 + 全量 journal 推导重建质量指标。
- `domains/metrics/spec-health.ts`：从 specs、plans、spec 版本链与 drift 推导 spec 健康度。
- `domains/metrics/metrics-service.ts`：聚合 + `formatMetrics` 人类可读输出。
- `app/commands/metrics.ts` + `app/cli/index.ts`：`cometflow metrics [path] [--json]`。
- `test/domains/metrics.test.ts`：确定性、空项目、只读、各指标口径。
