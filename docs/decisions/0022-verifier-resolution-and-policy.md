# ADR 0022：独立 Verifier 的 agent 解析与不可用策略

状态：已批准
日期：2026-09-14

## 背景

ADR 0013 规定「验收必须可执行，且不能由实现者自证」。实现上，独立 Verifier 只有在传入 runner 时才会被调用，而 CLI 侧解析 agent 的代码是：

```ts
const verifierId = options.agent ?? config.verification?.agent;
```

**没有回退到项目默认 agent**。默认配置下 `verification.agent` 为空 → runner 恒为 undefined → `checks+agent` 与 `checks` 行为完全一致。也就是说「把 mode 默认值改成 checks+agent」是个**无效动作**，这一点在设计评审时被证伪。

## 决策

1. **agent 解析回退**：`--agent` → `verification.agent` → `config.agent` → 内置默认。
2. **调用前做可用性检查**：`runner.check()`（即 `<agent> --version`，5s 超时）。不可用时不进入 Verifier 分支，而是走下面的策略。
3. **新增 `verification.verifier_policy: skip | warn | fail`（默认 warn）**：
   - `skip`：静默降级（保留旧行为）；
   - `warn`：验证继续，把「本轮没有独立验证」写进 `verification.md` 与 journal；
   - `fail`：把「Verifier 不可用」升级为 violation，验证失败。
   该策略仅在 `mode` 为 `checks+agent` / `agent-required` 时生效；`checks` 模式不要求 Verifier，因此不产生任何提示。
4. **`agent-required` 不受策略影响**：无论 policy 是什么，没有 Verifier 就失败。
5. **成本记账**：Verifier 的 agent id、耗时（`verifier_ms`）、策略与 mode 写入 `verify-result` 事件；`metrics` 汇总为 `verifier.runs` / `total_ms` / `mean_ms`。

## 理由

- 默认值必须不改变已有项目的行为：`mode` 默认仍是 `checks`，所以未显式开启独立验证的项目**完全不受影响**。
- 「Verifier 缺失」与「验收项无法判定」是两件事，必须分开：前者由 policy 决定，后者永远失败——否则 `warn` 会变成绕过 ADR 0013 的后门。
- 成本必须可观测，否则「加了独立验证」会变成一个无法评估的开销；`verifier_ms` 让 `metrics` 能回答代价问题。

## 后果

- 显式开启 `checks+agent` 的项目：Verifier 现在真的会运行（此前是空转）；Agent 未安装时默认只记录警告。
- `verification.md` 增加 `verifier_policy` 与 `verifier_ms` 行；`metrics` 输出 `verifier_runs`。
- 需要「必须有人独立判定」的项目应设 `verification.verifier_policy: fail`（或 `mode: agent-required`）。
