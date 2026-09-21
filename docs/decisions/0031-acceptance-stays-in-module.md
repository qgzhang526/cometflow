# 0031 验收项只断言本 capability 的事实

状态：已批准（2026-09-21）
关联：[0013 验收必须可执行](./0013-verification-must-be-executable.md)、
[0016 修复循环必须有界](./0016-bounded-repair-loop.md)、
[0030 绑定口径只认 capability](./0030-spec-binding-scope.md)

## 背景

任务的边界是一个 capability 模块（`specs/<capability>/spec.md` front-matter 的 `module`），
验收项是任务的判据：一条任务算不算完成，全看它的 `- check:`。

两者之间有一条此前没写下来的约束：**验收项只能断言本 capability 可观察的事实**。
写成跨 capability 的断言（"我把 X 改完，Y 也得跟着对"），任务就变成一个在模块内无法完成的活：

- Agent 为了让 check 变绿，只能去改别的模块的文件；
- 范围报告如实记成越界（`implementation escaped module <module>: <file>`），验收仍然不通过；
- 每轮结论一样 → 失败指纹不变 → `repair_attempts` 打满 → `blocked` 停机（0016）。

演示种子（Go 版 CBB）上撞到过一次：`specs/access/spec.md` 的 A7（吊销）多写了半句
"且该令牌无法再建立通道"，而"被吊销的令牌不能建通道"是 **tunnel** 的事实（判在 `specs/tunnel/spec.md` 的 A18）。
于是 G1 的吊销任务在 `internal/access` 里怎么做都不对：Agent 只能去实现 `internal/tunnel/tunnel.go`，
连续三轮同一指纹，`repair_attempts=3`，停机等人解封。

## 决策

1. **一条验收只断言本 capability 的事实**：状态机、返回码、落库结果、审计事件——
   那些在本模块里就能产生、也能观察到的。
2. **跨 capability 的事实落在拥有它的那份 spec 里**：需要时在正文里指过去
   （"令牌能不能再建通道" → `specs/tunnel/spec.md` 的 A18），不复制第二条验收。
3. **不靠调度顺序兜底**：即使顺序能把依赖方排在后面，验收项也不该依赖它——
   顺序是调度优化，模块边界是契约。
4. **不新增命令**：停机时越界点名的文件与 `change unblock` 的人工出口保持 0016 的原样。

## 理由

- 任务的交付单位是 capability（0030），验收项是任务的判据；判据落在别人家里，任务就没有"可完成"的定义。
- 这是 009「同一件事只有一个 owner」在**判据**上的投影：事实不重复，判据也不重复。
  两条验收覆盖同一个事实，改一条忘一条时还会互相打掩护。
- 0016 的停机兜的是"没进展"；这种停机每轮都在模块外绕圈，代价是三轮 token 加一次人工解封。
  在写 spec 时把断言写对，成本是零。

## 后果

- 写 spec 的人多一步自查：**这条验收，我能在自己的模块里做完吗？**
- 这类停机应该消失——它暴露的是 spec 的分层错误，不是实现错误。
- **不做**：平台不自动检测"验收项是否跨 capability"。判定一条 check 到底碰了哪些模块需要理解被调用的
  测试与实现，静态做不准；这条靠 spec 评审与种子模板把关。

## 实施记录（2026-09-21）

| 落点 | 改动 |
|---|---|
| `experiments/cbb-emergency-access-go/specs/access/spec.md` | A7 收敛为"申请单与授权的状态都变 revoked"；正文补一句指向 tunnel 的 A18 |
| `experiments/cbb-emergency-access-go/tests/acceptance/acceptance_test.go` | `TestA7` 删掉"吊销后 open 必须 403 E_GRANT_REVOKED"那一步，并在注释里写明它归 A18 |
| `experiments/cbb-emergency-access-go/internal/access/access.go` | A1–A8 对照表里 A7 那一行改为指向 tunnel 的 A18（种子注释就是 Agent 的主要输入） |

回归门禁（把这类判据挡在写 spec 的阶段）：

| 落点 | 做法 |
|---|---|
| `test/domains/experiment-cbb-go-seed.test.ts` | 按 COMETFLOW.md 的 `## 调度顺序` + 各 goal 的 `范围` 推出 capability 顺序，逐个 capability 贴参考实现，每贴一个就跑一遍"已交付模块"的全部判据，断言全绿（拿旧 A7 跑会红：`已交付 access 时 … A7 期望 403 E_GRANT_REVOKED，实际 501 E_NOT_IMPLEMENTED`） |

验证（本机实测）：

- 兜底仓库（完整参考实现）+ 新判据：`go test ./tests/acceptance -count=1` → **18/18 PASS**
  （A18 仍然盯着"被吊销的令牌不得产生转发规则"）。
- 把 `internal/tunnel/tunnel.go` 换回种子骨架（`E_NOT_IMPLEMENTED`）后：
  - 旧 A7：`FAIL —— 期望 HTTP 403 + code "E_GRANT_REVOKED"，实际 HTTP 501 + code "E_NOT_IMPLEMENTED"`
    ——这正是把 Agent 逼去改 `internal/tunnel` 的那一步；
  - 新 A7：`PASS` —— 吊销任务在 `internal/access` 里就能验收。
- 平台侧同一条 change（在 tunnel 仍是骨架的仓库上）：
  `change verify G1-T3` → `PASSED A7 [check]`、`scope: 3 changes / unattributed: 0`、
  `reportPassed=true repair_attempts=0`，不再出现 `implementation escaped module`。
- 真 Agent 全流程（隔离的临时演示根目录）：`prepare-demo.ps1 -Force` → `preflight: OK` → 主仓库 Builder（A1–A3、归档）→
  `daemon start --agent opencode` 依次交付 G1:T2 → **G1:T3** → G1:T4，每条的 `verification.md` 都是
  `scope: complete` / `repair_attempts: 0/3` / `result: pass`，Agent 在 G1:T3 的收尾说明里明确写了
  「No changes to `internal/tunnel` or `internal/guard`」。演示仓库侧的细节见
  [go-demo-runbook.md 的问题 4](../demo/go-demo-runbook.md)。
