# #30 实现越界（unattributed）导致 change 停机：判定、影响与处理

> 状态：OPEN ｜ 创建：2026-09-21T04:42:14Z ｜ 作者：qgzhang526
> 原始链接：https://github.com/qgzhang526/cometflow/issues/30 ｜ 归档时间：2026-09-22

## 正文

正文与仓库内的 [docs/guide-out-of-module-writes.md](../guide-out-of-module-writes.md) **同源**：
这条 issue 建出来时就是把那份指南整篇贴成正文的（当时先写了指南、后补的 issue）。
这里不再复制一份，避免两处各自漂移——要改内容请改指南。

## 评论

**qgzhang526 @ 2026-09-21T04:42:24Z**

补建说明（2026-09-21）。

这条 issue 是补出来的。原始案例发生在演示项目「CBB 应急接入（Go 版）」上，出问题的是工单 G2-T2（access 能力）：参考实现要 import 全部 5 个 capability 才编译得过，而种子只给了 internal/app/seam.go 与 internal/contract，于是第一个任务为了让项目能编译，必须越界造出 tunnel / guard / audit 的文件 → 范围报告如实记成 OUTSIDE → 连续三轮同指纹 → repair_attempts 打满 3 → blocked。

当时决定把它写成仓库文档而不是 issue，所以 GitHub 上一直没有记录，这次补上以便检索。

关联：

- 文档正文：docs/guide-out-of-module-writes.md（已随 PR #29 合入 main，merge commit 0e9365c）
- 现场记录：docs/demo/go-demo-runbook.md 附录「问题 1」；同类根因另见 ADR 0031（验收项只断言本 capability 的事实）
- 处置入口：cometflow change scope / journal / unblock

## 迁移备注

- 原始 issue 的正文是那份指南的快照；指南本身已经随 PR #29 合入 main，是本仓库的长期版本。
- 处置入口的完整命令见指南第 4 节（分流 A：`git restore` 撤越界改动；分流 B：先 `internal/store`
  下沉共享面、再 `change unblock` + `run` + `verify`）。
