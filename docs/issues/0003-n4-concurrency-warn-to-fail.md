# #3 N4: 并发 spec 写入从 warn 切到 fail（到期约 2026-10-14）

> 状态：OPEN ｜ 创建：2026-09-14T15:24:26Z ｜ 作者：qgzhang526
> 原始链接：https://github.com/qgzhang526/cometflow/issues/3 ｜ 归档时间：2026-09-22

以下为原文正文（逐字保留，未改写）：

---

跟踪项：**N4 的并发 spec 写入策略从 `warn` 切到 `fail`**。

背景见 ADR 0021《并发写保护——单文件 CAS + 多文件事务锁，warn 是有期限的过渡态》。分两步上线是为了先用真实数据校准误报率，但「过渡态」必须有期限，否则会永久停在宽模式。

## 机制（不依赖任何人的记忆）

- `concurrency.specWrites: warn` + `concurrency.warnUntil: <日期>`（落地时默认为当天 + 30 天；按今天算约 **2026-10-14**）。
- warn 期间每次冲突都会留痕：响应 `warning`、journal `cas-conflict-warn`、`metrics` 计数、`doctor` warning、UI 顶部横幅。
- **到期后**：`doctor` 与 `spec verify` 各报 error `concurrency-warn-expired` → CI 的 `spec-gates` 变红。这时只有两条出路。

## 到期时必须做的选择（二选一）

- [ ] **切成 fail**：`concurrency.specWrites: fail`，删掉 `warnUntil`，跑一遍并发脚本确认返回 409 且目标文件不变；
- [ ] **显式延长**：把 `warnUntil` 前推，并在配置里写 `warnReason`（为什么继续观察、观察什么数据）。

## 关闭本 issue 的条件

- [ ] 走完上面二选一，且 `cometflow doctor` 不再出现 `concurrency-warn-expired`；
- [ ] 本次决策的结论（切 fail 的实际误报率，或延长的理由与观察指标）写进 ADR 0021 的「后果」段或本 issue 的评论。

> 这个 issue 是提醒，不是门禁本体；门禁在代码里（到期 → `spec verify` 报 error → CI 红）。

---

## 评论

无（导出时评论数为 0）。

## 迁移备注

- 归档时未改动原文，上面那段也是当时 GitHub 上的完整正文。
- 这条 issue 是**有期限**的提醒：`warnUntil` 到期会让 `spec verify` 报 `concurrency-warn-expired`、
  CI 的 `spec-gates` 变红。迁移到内网 GitLab 之后，门禁仍然在代码里，
  但"谁在什么时间把它切到 fail（或显式延长）"这件事需要在内网重新挂一个跟踪项，
  否则这条归档文件不会主动提醒任何人。
