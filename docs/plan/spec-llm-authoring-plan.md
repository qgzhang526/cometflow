# LLM 起草 capability spec：输入面、分级生成与人审台账

状态：**B1 已实施**（2026-09-18）；B2–B3 待实施，B4 待评估
来源：2026-09-18 复核「完全靠人写 COMETFLOW.md 与 capability spec 难度较大、capability spec 应向大模型生成靠拢」这一判断
关联：[spec-authoring-plan.md](./spec-authoring-plan.md)（G1–G4 护栏，本计划的前提）、
[ADR 0007](../decisions/0007-ui-headless-service.md)（未来 LLM 版 generate 列在 job 模型下）、
[ADR 0010](../decisions/0010-spec-artifact-kind-model.md)（kind 模型：源与投影的区分）、
[009-spec-artifact-taxonomy.md](../design/009-spec-artifact-taxonomy.md)

## 0. 结论摘要

原判断「capability spec 应逐渐向大模型生成靠拢」**成立**，但它成立的部分是
「LLM 起草 + 机器结构门禁 + 人工定稿」，不是「LLM 直接写进 canonical」。

同时原判断里有两处需要修正：

1. **COMETFLOW.md 与 capability spec 不该并置**。前者是事实的源头（没有上游），
   后者是事实的投影（上游是 goal + 其余 11 类 kind）。能生成的顺序恰恰是后者优先。
2. **「难」要拆成两种**：结构合规与引用一致（套路劳动，LLM 强项）
   与「这段流程到底要怎么做」（设计决策，LLM 只能给候选）。前者是工作量瓶颈，
   后者是正确性瓶颈——本计划的每一批都在处理这个区分。

## 1. B1｜`spec-authoring` 提示词的输入面（已实施）

### 1.1 问题

起草任务的提示词此前只交底 `goal` 的摘要、范围、成功标准与非目标
（`domains/workflow/change-execution.ts` 的 `specAuthoringSection`）。
Agent 因此面对两个都不可能赢的局面：

- 凭空造模型 / 错误码 / 配置键 → `spec validate` 报 `unresolved-*-reference`，
  产物过不了 G4 的收口护栏；
- 干脆一个引用都不写 → 产出一份与既有契约无关的孤儿 spec，
  结构合法但语义上没有进入这个项目的契约网络。

### 1.2 落点

新增 `domains/workflow/spec-authoring-inputs.ts`，提示词里多出两节：

| 段落 | 回答什么 | 内容 |
|---|---|---|
| `## Existing facts you may reference` | 「有哪些值可以引用」 | 已有 capability、模型实体、错误码、协议头、状态码、配置键、实体字段清单；并说明「引用未定义值会怎样」与哪些 kind 文件缺失（缺失时 validate 降级为 warning） |
| `## House style to follow` | 「这个项目怎么写」 | 同一 goal 内一份邻居 capability spec 的全文（上界 6000 字符，超出截断并标注） |

实现上刻意**不重新解析 spec**：事实取自 `buildSpecReferenceIndex`
（`domains/spec/spec-graph.ts`）——那是 `spec validate` 与引用图共用的事实索引。
本模块若自己维护一套正则，就会出现「提示词说可以引用、validate 却报错」这类最难查的分歧。

两条边界：

- **正在起草的 capability 不算「已有」**：它的文件可能是上一轮留下的半成品，
  既不进 capability 列表，也不当体例样本（否则 Agent 照着半成品续写）。
- **取不到输入面时不阻断起草**：读取失败只退化为一句提示；
  真正的护栏仍在 `change verify` / `change archive`（G4）。

### 1.3 验收

- `test/domains/spec-authoring-inputs.test.ts`（6 例）：事实枚举、实体字段、
  体例参照、缺事实时的「明说缺」、半成品不回流、超长截断、无邻居时的首份说明。
- `test/domains/spec-authoring-guard.test.ts`（3 例）保持通过——G4 护栏未被削弱。
- 全量 `npx vitest run` 101 文件 / 587 例全绿；`node scripts/regression.mjs` 157 步 PASS；
  `tsc --noEmit` 通过。

### 1.4 未做（留给 B2）

提示词给的是**事实清单**，还没有给**这个 capability 本身该怎么写**的判别依据——
也就是下面的分级。当前所有起草任务拿到同一份输入面。

## 2. 对原 A/B/C 三档设计的审查

原始设计是按「缺少哪些事实」分三档（A 已有同族 / B goal 新引入 / C 无可靠上游），
并让档位同时决定「生成方式」与「人审强度」。审查后有四处要改。

### 2.1 问题一：把两个正交维度串成了一根阶梯

「事实来源可推导程度」与「这份契约一旦写错的爆炸半径」并不共变：
一个从 goal 原文直推的新 capability 可以很关键（改的是全系统接口协议），
一个照抄同族模板的增量段落也可以无关紧要。

串成一根阶梯会导致两个错误决策：要么对关键契约按「低档」放行，
要么让无关紧要的增量也走满流程，最后人开始跳过审核。

**改法**：拆成两根正交轴——**生成方式由「事实来源」决定，人审强度由「爆炸半径」决定**。

### 2.2 问题二：三档「是什么」没有定义清楚

改后的三档按「**这份 spec 里哪些内容是事实**」划：

| 档 | 事实来源 | 生成方式 | 人的介入点 |
|---|---|---|---|
| **A1 已定义** | 值已在 canonical spec 里（models / errors / protocol / config） | 直接生成引用与接口契约 | 抽查 |
| **A2 可从 goal 推导** | 接口形态可由 goal 成功标准 + 既有 kind 推导 | 生成骨架与候选验收，**不得编造事实** | 逐条确认验收口径 |
| **A3 需要人的判断** | 范围边界 / 模块划分 / 验收判定口径 | **不生成**，转成待定项 | 必须先落成决策 |

### 2.3 问题三：没回答「什么时候会退化成橡皮章」

起草成本趋近于零后，最可能的失败不是「spec 写错」，而是**数量的膨胀**：
draft 过结构门禁 → 人批量 `spec approve` → canonical 实际上由 LLM 撰写、人只签名。

原设计里没有任何反制。**改法**：加一道不依赖模型自觉的机械门
——**approve 时比对「草案落地 ≥N 分钟」**。

这条刻意不是「人必须改多少字」（那会鼓励无意义改动），
而是把「读一遍」的时间成本重新装回去。

### 2.4 问题四：真瓶颈是 `check`，三档完全没提

`spec validate` 对没有 `- check: <command>` 的验收项只报 warning
（`acceptance-without-check`）。而 `change verify` 的判定优先级里，
可执行 check 是唯一「任何人都不能推翻」的一档，其余要靠独立 Verifier 或人工。

LLM 生成会把这个 warning 从少数变成多数：**验收项写得漂亮但判不了**，
于是「重建质量可判定」这个立项目的被悄悄掏空。

**改法**：验收的产出必须**恰好是一行**（口径/证明/证据），且三档都要
对「无 check 的验收」设定上限（见 §3 的 B3）。

### 2.5 一处保留

原设计的「C 档不应由模型生成，而应由人先写决策」被证明是对的，
只是它不该是阶梯的一档，而是 A 轴的 **A3**。这一点原判断没问题，改名不改义。

## 3. 可实施计划

### B2｜生成方式分级（A 轴落到代码里）

**目标**：同一个起草任务，按其事实来源拿到不同的写作策略；A3 不再让 Agent 猜设计。

**改动点**

1. 新增 `domains/spec/authoring-source.ts`：
   - `classifyAuthoringSource(projectRoot, { capability, goal })` → `{ level: 'A1' | 'A2' | 'A3', reasons: string[] }`；
   - 判别依据（全部来自既有事实，不引入新配置）：
     - 该 capability 是否在其它 goal 的 scope 里出现且已有 spec（同族）→ 倾向 A1；
     - goal 的成功标准里是否出现该 capability 拥有的实体 / 错误码名（可从原文推导）→ A2；
     - 是否两者都不成立，且 `specs/<cap>` 从未存在过 → A3；
     - 产出必须带 `reasons`（哪条证据让它落到这一档），便于人反驳。
2. `specAuthoringSection` 按 level 追加策略段：
   - A1：给出可迁移清单（同类 anchor 的标题形态 + 验收写法），禁止新增事实；
   - A2：给出骨架 + 候选验收，并显式标注「不得编造未定义的值」；
   - A3：不产出 spec，改为在提示词与 `brief.md` 里点名「先补上游决策」
     （范围边界 / 模块归属 / 验收口径三问），并要求把答案写进 goal 或对应 kind 文件。
3. `spec-authoring` 任务记录 level：`TaskRecord` 增加可选 `authoring_level`，
   由 `task-plan-generate` 填入，使 plan 面板与 `plan trace` 能看出这条任务属于哪一档。

**验收**

- `classifyAuthoringSource` 三个档位各有单测（含 reasons 断言）；
- A3 的 `change verify` 在产物缺失时报的是「缺上游决策」而不是「产物不存在」；
- 提示词测试：A1/A2/A3 三种策略段互不相同，且 A2 出现「不得编造」。

**不做**：不引入第二份「事实源」——level 只是对现有事实的分类结论，不是新配置项。

### B3｜验收可判定性与人审台账（R 轴 + 橡皮章反制）

**目标**：让「生成得更多」与「判得了」不脱钩，并让「人是否真的看过」留下痕迹。

**改动点**

1. `spec validate` 增加一条 error（不是 warning）：capability spec 里
   **全部** 验收项都没有 `check` 时，报 `no-executable-acceptance`。
   （保留「部分无 check」为 warning：允许验收分阶段补齐。）
2. 起草类 change 的收口护栏（`assertAuthoredSpecReady`）要求：
   产物中「无 check 的验收」占比不超过阈值（默认 1.0，即不阻断；
   `config.verification.require_check_ratio` 可调低）。阈值默认不阻断是刻意的：
   先把事实暴露出来，再决定收紧，避免一次性打断存量项目。
3. `spec approve` 记录草案年龄：front-matter 之外，在版本备注里记
   `spec-authoring → approve` 的间隔；低于 `config.spec.min_review_seconds`
   （默认 0 = 不启用）时拒绝并提示「草案落地到定稿间隔过短」。
4. `cometflow metrics` 增加两项：`draft_approve_ratio`（机器起草后未经人改动的比例）
   与 `acceptance_check_rate`（有 check 的验收占比）。这两项是评估「该不该继续放宽」的依据。

**验收**

- 全验收无 check 的 spec 被 `spec validate` 报 error，且 `change verify` 因此拒绝；
- `require_check_ratio` 与 `min_review_seconds` 各有「启用时拒绝 / 未配置时不阻断」两例；
- metrics 两项在回归夹具里有确定值；
- `docs/USAGE.md` 同步：§1.5 所有权表、§4 语义节、§12 metrics。

### B4｜分层生成的上限评估（待评估，不在本批）

上面两批做完后再回答：

- `draft_approve_ratio` 是否真的低于人工基线（若是，说明人在签字而不是在读）；
- `acceptance_check_rate` 是否随生成量下降（若是，说明 check 是硬瓶颈，
  该投入的是「从测试框架反推 check」而不是继续放宽生成）。

## 4. 不做什么

- **不让 LLM 生成 COMETFLOW.md**：它是事实源头，没有上游可以推导；
  目前只有 UI 的就地编辑（写回 Markdown + `goal sync`）这一条路径。
- **不做「生成即 canonical」**：canonical 只能由 `spec approve` 之后的文件构成，
  这条 G1 已经定死，本计划不放松。
- **不引入第二套事实源**：分级结论与台账都落在既有文件（任务记录、spec front-matter、
  metrics 投影）里，不新建数据库或旁挂索引。

## 5. 完成定义（DoD）

沿用 spec-authoring-plan 的 DoD：①域函数有测试且覆盖失败路径；②与 CLI / HTTP 同源
（同一份判定函数，不复制规则）；③`scripts/regression.mjs` 补对应场景；
④`docs/USAGE.md` 同步；⑤回填本文件与 `docs/plan/README.md` 的状态列。

## 6. 实施记录

### B1（2026-09-18）

| 项 | 落点 | 验证 |
|---|---|---|
| 起草输入面 | 新增 `domains/workflow/spec-authoring-inputs.ts`；`change-execution.ts` 的 `specAuthoringSection` 追加「可引用事实」与「体例参照」两节 | `spec-authoring-inputs.test.ts` 6 例；原有 `spec-authoring-guard.test.ts` 3 例保持通过 |
| 事实来源单一化 | 事实取自 `buildSpecReferenceIndex`（spec-graph），不复制解析规则 | 与 `spec validate` / 引用图同源；typecheck 通过 |
| 边界 | 半成品不回流、无邻居时给首份说明、超长截断、读取失败不阻断 | 三条各有用例 |

测试与验证：全量 `npx vitest run` **101 文件 / 587 例全绿**；
`node scripts/regression.mjs` **157 步 PASS**；`npx tsc --noEmit` 通过。
