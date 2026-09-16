# 0026 daemon 进程归 CLI 持有，控制语义走文件

状态：已批准（2026-09-17）
关联：[006-roadmap](../design/006-roadmap.md) 的 P4、[0024-scheduler-durability](./0024-scheduler-durability.md)、
[daemon-drives-change-plan.md](../plan/daemon-drives-change-plan.md)

## 背景

P4 要把「全时无人值守」做成主路径，随之而来的一个问题是：**daemon 是长驻进程，谁持有它？**

在它之前，`cometflow daemon start` 在终端里跑，Ctrl+C 停；设计文档（005）里写过
`daemon pause|resume|stop`，但 CLI 从未实现。而界面上如果要「可控」，最容易的做法是让 serve
去 spawn 一个子进程——那会立刻带来一串没有答案的问题：

- 日志写去哪？进程崩了谁负责重启？
- 浏览器关掉、serve 重启之后，那个游离进程还在不在？谁去收尸？
- 换台机器打开同一个项目，界面上的「停止」按钮停的是哪台机器上的进程？

## 决策

1. **进程由 CLI 持有**：`cometflow daemon start` 是唯一 spawn 点，日志与退出码归它所在的终端。
2. **控制语义走控制文件** `.cometflow/runtime/daemon.control.json`：`daemon pause|resume|stop`
   与界面按钮都只写这个文件（`{schema, action, requested_at, requested_by}`）。
3. **daemon 循环每轮读控制文件**：`stop` → 退出并写 `stopped_reason=stopped-by-control`，
   随后把指令回落为 `idle`（否则下次 start 会立刻又停）；`pause` → 只跳过本轮不退出，
   指令保持到有人 `resume`/`stop`。坏文件按「没有指令」处理，不让投影把调度卡死。
4. **界面只做三件事**：显示状态投影（C5）、显示每行的调度与交付两态（S4）、写控制文件。
   界面**没有**「启动 daemon」按钮——启动是终端的事。

## 后果

正面：

- 「谁持有进程」有唯一答案，日志/退出码/pid 的归属不再模糊；
- 界面与脚本都能暂停/停止无人值守，跨机器也成立（控制文件在项目里，谁跑谁读）；
- 控制是**状态**而不是信号，不依赖 pid 有效性（换机器、重启后依然正确）。

负面与边界：

- 想「从界面一键启动无人值守」需要先做受管子进程（serve 内嵌调度器），那是另一件事，
  本决策明确不做；
- 控制文件是项目级事实，`pause` 会影响该项目所有机器上的 daemon（目前是单用户单写者模型，
  与 ADR 0021 的并发写保护一致）；
- 控制指令是「下一轮生效」，不是即时 kill：单轮任务（含 agent 会话）会跑完当前这一步。

## 与既有机制的关系

| 机制 | 关系 |
|---|---|
| 状态投影（C5） | 控制指令与决策结果都写进 `daemon-state.json`：界面读状态，写控制文件，两不相干 |
| 租约与回收（ADR 0024） | 控制不改变租约语义：`stop` 是优雅退出，回收仍然是「进程真的死了」时的兜底 |
| 写保护（ADR 0021/0023） | 控制文件在 `.cometflow/` 下，属于机器状态，写保护守卫照旧不许 agent 写 |
