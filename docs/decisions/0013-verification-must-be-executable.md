# ADR 0013：验收必须可执行，且不能由实现者自证

状态：已批准
日期：2026-09-14

## 背景

ADR 0004 与 011 让 spec 成为唯一事实源，并让冻结任务绑定确定的 spec 版本。但「验收」这一环此前仍然依赖文本：
`change verify` 读取 `changes/<name>/verification.yaml` 里的结论，或退化为跑一次项目级 eval。
这意味着验收结论可以是一句「看起来没问题」，而实现者与判定者可以是同一个 agent、同一个上下文。

结果是 `code is regenerable` 成立，`regenerated code is correct` 不成立：没有客观判定，就无法回答「重新生成的代码能不能用」。

## 决策

1. **spec 的验收项可以携带可执行检查**：`- check: <command>`，命令退出码即结论。
2. **判定优先级固定**：`check` > 独立 Verifier > `verification.yaml` > 项目 eval > `blocked`。
3. **失败的 check 不可被推翻**：任何 agent 或文档都不能把失败的检查判成通过。
4. **无法判定即失败**：既没有 check 也没有 Verifier 结论的验收项记为 `blocked`，整体不通过。
5. **Builder 与 Verifier 分离**：Verifier 使用独立会话与只读提示词，输入是冻结 spec 段落、验收项、实现范围与确定性检查结果，必须逐条给出 passed / failed / blocked 与理由。
6. **Verifier 覆盖度必须精确**：重复、未知、遗漏任何一条验收项，整份 Verifier 结论作废。
7. **模式可配置**：`verification.mode` 为 `checks` / `checks+agent` / `agent-required`；`agent-required` 下没有可用 Verifier 就直接失败。

## 理由

- 没有机器证据的验收是意见，不是结论；spec 是根源就必须同时是判据。
- 实现者自证会系统性高估完成度，尤其在长上下文里「自己检查自己」几乎必然通过。
- 精确覆盖度把「漏测」变成硬失败，而不是被平均分掩盖。
- check 命令写在 spec 里，评审 spec 就等于评审验收标准，不需要额外维护测试清单。

## 后果

- spec 作者需要为能自动化的验收项写 `check`；暂时写不出的项会进入 `blocked`，需要 Verifier 或人工补齐。
- `spec validate` 会对没有 check 的验收项给出 `acceptance-without-check` 警告，`spec checks` 可列出全部未覆盖项。
- change 的验收结论可以回溯到具体命令与退出码，重建质量的改善可以被度量。
- 尚未实现的是「spec 自身的正确性」的第二来源（例如从 acceptance 反向生成性质测试），仍是人工评审为主。
