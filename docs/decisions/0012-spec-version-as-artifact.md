# ADR 0012：spec 内容是可寻址的产物，版本引用可回放

状态：已批准
日期：2026-09-14

## 背景

ADR 0001 规定 spec 是唯一事实源，ADR 0002 规定冻结时记录 spec 版本与 hash，ADR 0004 规定已完成任务不可变。这三条依赖一个未被实现的前提：被引用的那版 spec 内容必须真的能被取回来。此前只有 `spec-lock.json` 里的当前 hash 与任务上的 `spec_hash`，内容本身没有被保存，`spec_version` 也从未真正递增过。结果是「代码丢了按 spec 重建」只是口号。

## 决策

1. **spec 内容按内容哈希寻址存储**：`.cometflow/spec-versions/<sha256>.md`，同一内容只存一份。（目录已迁移，见文末修订）
2. **每个 spec 文件维护单调递增版本号与版本链**：`.cometflow/spec-history.json` 记录 `spec_version` / `hash` / `parent` / `change` / `note`。（同上）
3. **冻结与归档都必须记账**：`plan freeze` 登记版本并刷新 `spec-lock`；`change archive` 在写入 canonical spec 后登记新版本并刷新锁。
4. **change 采用乐观并发（CAS）**：创建时对 canonical spec 拍全量基线，归档前校验本 change 会写入或绑定的目标未被外部改动，否则抛 `SpecConflictError`。
5. **冲突必须显式解决**：用 `change rebase` 重新冻结到当前版本（重取 acceptance 并把 change 退回 build），或按 ADR 0004 创建 reconciliation change；不存在静默覆盖。
6. **Builder 只消费冻结版本的 spec 段落**：`spec_hash` 对应的内容从版本仓读取，缺 blob 时显式告警，不静默降级到工作区文件。
7. **一致性可作为门禁执行**：`cometflow spec verify` 检查锁、版本仓、anchor 绑定、验收项与 change 基线。

## 理由

- 只有内容可寻址，版本号才不是装饰：hash 是身份，内容是产物。
- 任务冻结的 acceptance 与 anchor 必须能回放到当时的原文，否则「历史不可变」无从谈起。
- 归档静默覆盖会丢掉别人的 spec 变更，属于不可逆的数据损失，必须拦在写之前。
- 把影响分析和冲突检测做成命令，使 spec 演进从「靠人记住流程」变成可执行的机械步骤。

## 后果

- `.cometflow/` 体积随 spec 变更次数增长（每个唯一内容一份），置换成本换来可回放性。
- 归档改变 canonical spec 后，绑定旧版本的任务会立即被 `spec verify` 判为漂移，必须通过 `plan regenerate --preserve-approved` 重新绑定，不会静默通过。
- 验收项文本改写被提升为高危影响，因为它会让同一 id 的历史验收结论失效。
- 版本历史默认不随 git 分发；跨机器回放需要额外把版本仓纳入版本控制。（已过期，见文末修订）

## 修订（2026-09-15）：版本仓位置与分发方式

决策 1 / 2 里的 `.cometflow/spec-versions/`、`.cometflow/spec-history.json`，以及上面结论中
「版本历史默认不随 git 分发」都已经过期。现状是：

- 版本仓位于 **`.cometflow-history/`**（`spec-history.json` + `spec-versions/<sha256>.md`），
  刻意放在**被 git 跟踪**的目录里：它随 git 提交、跨机器可直接回放（`spec show specs/x/spec.md@2`），
  这也是「spec 即产物」在协作场景能成立的前提。原先放在 `.cometflow/` 下（被 `.gitignore` 忽略）
  会让换台机器就取不回被引用的那版原文。
- `.cometflow/spec-versions` 只作为旧项目的**兼容读取路径**保留，第一次写入即迁移到新目录；
  见 `domains/spec/spec-version.ts` 与 `docs/design/011-spec-versioning.md`。
- 清理路径明确不触碰它：`change gc` 只删 `.cometflow/runtime/` 下可重新推导的内容（ADR 0015）。
- **推论（写测试时要注意）**：`.cometflow-history/` 属于「要提交的产物」，因此测试**不能**把
  `test/fixtures/**` 这种提交在库里的夹具当项目根做写操作——`plan freeze` / `spec lock` / 归档
  都会写版本仓，而版本记录带 `recorded_at` 时间戳，一跑就在工作区留下会变化的未跟踪文件。
  夹具上的写操作一律先 `fs.cp` 到临时目录再执行。
