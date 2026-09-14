# ADR 0016：修复循环必须有界，停滞必须停机

状态：已批准
日期：2026-09-14

## 背景

`verify-fail` 之前无条件把 change 送回 build。在有人盯着的时候这没问题；一旦进入无人值守（daemon、长跑任务），
一次「改了但没改对」的实现会无限循环：agent 每轮都跑一遍，每轮都得到同样的失败结论，时间和 token 就这样烧掉，
而 change 永远不会停下来等人。

更要命的是这种循环没有留下「已经试过几轮、结论有没有变化」的记录，事后也无法判断是卡住了还是在收敛。

## 决策

1. 每次失败都计算**失败结论指纹**：只包含未通过的验收项（`id:结果`）与越界项，**不含自由文本理由与证据来源**。
2. 指纹与上次相同 → 视为「没有进展」，`repair_attempts + 1`；指纹变化 → 视为有进展，计数重置为 1。
3. `repair_attempts` 达到上限（`verification.max_repair_attempts`，默认 3）时，把 change 置为 `blocked`。
4. 停机不改变阶段：`phase` 仍然回到 `build`，用 `status=blocked` 表达「需要人」，避免污染阶段机。
5. 停机的 change 不允许 `change run`；`change resume` 不再给下一步 transition，而是给出人工介入指引。
6. 提供唯一的重置入口 `change unblock`：清空计数与指纹、恢复 `active`，并把决定写进审核流水。

## 理由

- 理由措辞每轮都会变（agent 会换说法），把自由文本纳入指纹会让停滞检测永远失效。
- 证据来源（check / document / agent）反映的是证据质量，不是结论；同一个问题换了判定方式不该被当成新问题。
- 连续两次「换了失败项」说明在收敛，这时停机是错的；所以只在**同一指纹**上累加。
- `blocked` 必须是可逆的显式动作，否则 change 会永久卡死；但重置必须由人触发并留痕，不能自动发生。

## 后果

- `comet-state.yaml` 增加 `repair_attempts` 与 `last_verdict_hash`；老 change 缺字段时按 0/空处理。
- `verification.md` 与 journal 会记录每轮的 `repair_attempts`、指纹前缀与是否停机。
- 无人值守场景建议把 `verification.max_repair_attempts` 调小（例如 2），让停机更早发生。
- 停机的 change 会出现在 `doctor` 与 `change list` 的 `blocked` 状态里，便于集中处理。
