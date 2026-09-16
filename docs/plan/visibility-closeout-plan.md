# 可见性收口批次：C5 调度器状态投影 + C12 bundle 分发

状态：**已完成**（2026-09-16；本批之后审计的 C 类缺口全部关闭）
来源：[web-ui-coverage-audit.md](./web-ui-coverage-audit.md) 的 C5 与 C12
关联：[024-scheduler-durability](../decisions/0024-scheduler-durability.md)、[web-ui-visibility-plan.md](./web-ui-visibility-plan.md)（V1–V4）

## 1. 这一批解决什么

C 类只剩两条真开口，都是「信息或动作已经在，但人够不着」：

| 项 | 缺口 | 本批做法 |
|---|---|---|
| C5 | 调度面板只读本身是有意设计，但**「daemon 最近一次决策」连只读投影都没有**——用户无法判断无人值守到底有没有在工作 | daemon 在每个决策点写 `.cometflow/runtime/daemon-state.json`（投影，非事实源），`GET /scheduler/queue` 附带 `daemon` 字段，面板顶部新增「调度器最近一次决策」卡 |
| C12 | Bundle 页签能看到 manifest / 编译产物 / 平台列表，却只能回 CLI 敲 `bundle distribute` | `POST /bundles/distribute`（默认 `dryRun` 预告），Bundle 页签按平台一键分发 |

## 2. 关键设计决策

**C5：状态投影不是事实源。** 队列（`queue.json`）与预算（`budget.json`）仍是唯一权威，
`daemon-state.json` 只记「最近一次决策」这几个字，丢了不影响调度正确性——所以它的写入
失败不阻断调度（`reportState` 吞掉异常）。反过来，面板也**不猜**「是不是还在跑」：
它只显示最后一次写状态的时间戳与 pid，并明说 pid 只是线索（进程可能已退出，也可能换台机器在跑）。

**C12：预告必须与执行同源。** 预告与执行打同一个端点、同一份 `distributeBundle` 数据，
只靠 `dryRun` 区分——否则「给你看的」与「实际做的」会分叉。分发是 `rm -rf 目标 + cp` 的
覆盖式写入，所以确认框逐行列出目标路径，并在有覆盖时点明「会被整个替换」。
分发前先 `compile` 一遍：清单读不出来时宁可在这里失败，也不要在「一半 skill 拷进去了」的状态下退出。

**C12 有意未做的部分**：`skill add` / `skill import` 仍留 CLI。它们属于 §5.2 的安装类运维动作
（要选源目录、要风险扫描），与「把已编译的 bundle 送进平台目录」不是同一件事。

## 3. 落点

| 项 | 落点 |
|---|---|
| C5 投影 | `domains/scheduler/daemon-state.ts`（新）；`daemon.ts` 的 `reportState` 在 start / skip / ran / stopped 四处写 |
| C5 端点 | `GET /api/projects/<id>/scheduler/queue` 新增 `daemon` 字段（从未跑过为 `null`） |
| C5 界面 | `SchedulerPanel.vue` 顶部「调度器最近一次决策」卡 |
| C12 端点 | `POST /api/projects/<id>/bundles/distribute`（`{platform, dryRun?}`） |
| C12 界面 | `AssetsPanel.vue` Bundle 页签的平台按钮 + 预告确认 |
| 测试 | `daemon-state.test.ts`（3 例：读写与坏文件、队列计数、主循环决策点写状态）；`serve-assets-api.test.ts`（+2 例：预告不落盘 → 确认后落盘且再预告显示会被覆盖、未知平台 400）；`serve-visibility-api.test.ts`（`daemon` 字段存在、未跑过时为 null） |
| 回归 | `scripts/regression.mjs` +2 步：分发产物落在平台目录、daemon 写下状态投影 |

## 4. 验证

回归 **135 步 PASS**；全量 `vitest` **81 文件 / 487 例全绿**；`tsc`、`vue-tsc`、`pnpm build`、
`pnpm package-e2e` 全部通过（结果明细见 [capability-map.md](./capability-map.md) §4「验证链」）。

浏览器走查（另起一个 serve 实例跑新构建，避免影响运行中的 4321）：

- 调度面板「调度器最近一次决策」卡在**两种状态**下都验过——没有投影时显式说明
  「这台机器上没写过状态投影」，有投影时显示 phase / mode / agent / 轮次 / pid / 最近活动 /
  最近决策 / 上一次任务结论与耗时 / 队列计数 / 预算快照；
- Bundle 页签出现 8 个「分发到 &lt;平台&gt;」按钮，预告接口返回逐项目标路径与覆盖标记，
  未知平台 400 并列出可选值；
- 控制台无 error/warning。走查用的 `daemon-state.json` 与临时 serve 实例都已清理。
