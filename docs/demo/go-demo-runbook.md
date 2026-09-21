# Go 版演示说明（按这个顺序执行）

面向：**Agent 轻度使用者 + 管理者**。全程在浏览器里点，只有「启动服务」这一步在终端。
项目是 Go 版（`experiments/cbb-emergency-access-go`），判据命令形如
`go test ./tests/acceptance -run '^TestA1$' -count=1`。

**已实测的数字**：Go 版真 Agent 完成一个任务 **175 秒**（约 3 分钟）；mock 跑完剩下 8 条约 30 秒；
18 条判据全绿；`gate check` PASS。

> 顺序就是上台顺序：第 1 节是开场讲稿（约 2 分钟，先讲清这是什么），第 2 节起才是浏览器里的操作。

**章节 ↔ PPT 页码对照**（讲 PPT 和翻这份 runbook 是同一个屏幕，按这张表找页）：

| runbook | PPT | 说明 |
|---|---|---|
| §0 上台前 10 分钟 | — | 放映前完成 |
| §1 开场讲稿 | 第 2–5 页 | 症状 → 边界 → 术语 → 分工；末段的「今天要看什么」对应第 21 页的五个步骤 |
| §2 启动服务 / §3 打开项目 | — | 唯一的终端操作 + 打开两个标签页 |
| §4 演示一　契约可校验 | 第 22 页 | 含那条刻意留下的 `spec-is-draft` 警告 |
| §5–§6 演示二　定稿、拆解与冻结 | 第 23 页 | 现场把 G3 从草案推到冻结 |
| §7 演示三　跑 Builder | 第 24 页 | 全场核心，约 3 分钟 |
| §8 演示四　启动调度器 | 第 25 页 | |
| §9 演示五　账本与门禁 | 第 26 页 | 用兜底仓库看门禁 |
| §10 五个错误演示 | 第 27 页 | 约 4 分钟 |
| §11 spec 版本迭代 | 第 28 页 | v1 → v2 |
| §12 收尾与兜底 | 第 29–30 页 | 上手路径与下一步 |

> PPT 第 31–47 页是备查附录（架构分层、校验规则、状态机、配置项、已知缺陷、Q&A 备答），
> 讲演时不翻，被问到直接跳过去。

---

## 0. 上台前 10 分钟

> 要打印的话，另有一页更细的 **[上台前 15 分钟检查清单](./preflight-15min.md)**（含开服务、
> 两个仓库各点一遍、三句口径、应急口令）。

```powershell
# ① 让 cometflow 命令可用（只需一次）
cd D:\zqg\github\cometflow-enrich-ui
npm link

# ② 重建两个演示仓库（会把旧的改名备份，不删除）
.\scripts\demo\prepare-demo.ps1 -Force

# ③ 自检：环境、Agent、两个仓库的状态
.\scripts\demo\preflight.ps1
```

> 别写成 `powershell -ExecutionPolicy Bypass -File ...`：`pwsh` 是 PowerShell 7，只装在 Codex 运行时里，没进系统 PATH，
> 直接跑会报「无法将 pwsh 项识别为 cmdlet」。用上面的 `.\scripts\...` 即可（走当前的 Windows PowerShell）。
> 如果提示「禁止运行脚本」，改用 `powershell -ExecutionPolicy Bypass -File scripts\demo\preflight.ps1`。

期望最后一行 `preflight: OK —— 可以上台`。它会检查：cometflow 与 go 在 PATH 上、
主仓库停在 G3 的现场起点（G1/G2 已冻结、G3 计划是 draft、13 份 spec 里只有 `specs/audit/spec.md` 是草案）、
工单停在构建阶段、队列幂等（连续 rebuild 仍是 7 行）、兜底仓库 18/18 与门禁通过。

**如果 preflight 报错就别上台**：先按它指出的那一项修。

---

## 1. 开场：先用两分钟说清这是什么（讲稿）

这一节是 PPT 第 2–5 页的压缩版（症状 → 边界 → 术语 → 分工），末段那句「今天要看什么」对应第 21 页的五个步骤。
按 45 分钟方案讲时 PPT 已经说过，那就直接跳到第 2 节；
只做浏览器演示、或者听众换了一批，就照下面念一遍再开页面。括号里是提示，不念。

**一句话定位**：「CometFlow 做的是把 AI 写出来的代码变成能交付的东西——**人写规格，Agent 实现，机器判卷**。」

**它要解决什么**（一个症状一句话，别展开）：vibe coding 的前半小时很好用，第二公里很难走。
改动不可控——让它改一个接口，它顺手重构了三个文件；上下文会丢——上一轮说好不动数据库，这一轮又动了；
验收靠人——改一次点一次，改十次还是那一遍；不敢托管——想让它夜里自己跑，可是没有任何东西拦得住它说「我做完了」。

**它管哪一段**：不换模型、不替你写提示词、也不替你决定需求。它管的是「写完了 → 可交付」这一段，就三件事：
这次改动到底改了哪些文件、什么叫做对了、人不在场时怎么跑不飞。

**两个前提**（后面每个页面都是这两条的投射）：

- 人只写两个地方：使命文件 `COMETFLOW.md` 和 `specs/` 目录；计划、队列、基线、索引都是机器生成的投影。
- 契约就是说明书：一个接口 = 一个锚点 = 一条任务的来源；每条验收都挂着一条能跑的命令（check）。

**演示项目是什么**：`cbb-emergency-access`，一个 Go 写的「应急运维接入」服务。
场景很朴素：运维要临时拿到某台服务器的通道，必须先提交申请、由另一个人审批、发一张一次性令牌、
建立通道、到期自动回收，全程留审计记录。
（**「另一个人」是身份不是人**：演示环境里用请求头 `X-Actor-Id` / `X-Actor-Roles` 表示，
同一台机器换一行头就换人；生产走管理平台会话。验收用例 A4/A5 就是这么跑的，详见文末
「编译、运行与手动验证」一节。）
为了让今天讲得完，规模压到 **3 个目标 / 8 条任务 / 18 条判据**，判据就是 18 条 `go test` 用例
（现场特意留了一条没冻结的任务，让你亲手把最后一段推完）。
另一个项目 `cbb-emergency-access-done` 是同一个仓库提前跑完的样子，Agent 卡住时切过去兜底。
（**兜底是怎么来的**：`prepare-demo.ps1` 把参考实现落盘后，用 `mock` 把 8 条流程走完——
它验的是"流程与账本"，不是"Agent 现场产出"。要证明 Agent 真能做，用的是主仓库那一次；
真 Agent 的完整跑通记录见文末「验证记录」。）

**今天要看什么**：契约可校验 → **亲手把一份草案批准成契约、再拆解冻结成任务** → 让真 Agent 做一个任务 →
调度器无人值守 → 账本与门禁，最后留几分钟看五个「故意犯的错」。

---

## 2. 启动服务（唯一的终端操作）

```powershell
cd D:\zqg\github\cometflow-enrich-ui
cometflow serve --workspace D:\zqg\demos --port 4321
```

它会打印两行：

```text
CometFlow: http://127.0.0.1:4321
token: <一串随机字符>
```

**必须在这个目录（cometflow 仓库根目录）里启动**——它按相对路径找前端产物 `web/dist`；
换目录启动会提示「web 下没有 index.html」，那就加 `--web-dir D:\zqg\github\cometflow-enrich-ui\web\dist`。

浏览器打开打印出来的完整地址（带 `?token=...`）。地址栏里的 token 会被自动收进 localStorage 并清掉，
之后刷新页面不用再带。

> 端口冲突就换 `--port 4400`。启动的窗口别关，演示全程都要它在。

---

## 3. 打开项目

1. 首页「最近项目」里已经有两条，点名字打开：**`cbb-emergency-access`（现场用）**。
2. 顶栏右侧能看到 `opencode / claude-code / mock` 三个徽章——这是本机可用的 Agent 适配器。
3. 顶栏还有一个 `任务 N` 按钮，点开是任务中心：后面运行 Builder 的实时日志在这里。

先把 `cbb-emergency-access-done` 也在另一个标签页打开，兜底时直接切过去。

---

## 4. 演示一：契约可校验（约 2 分钟）

| 步骤 | 操作 | 预期看到 |
|---|---|---|
| 1 | 左侧点「规格」→ 页签「影响与门禁」→ 点「校验引用（spec validate）」 | 校验通过；一致性门禁 **1 条 finding**：`WARNING spec-is-draft specs/audit/spec.md`；无漂移 |
| 2 | 页签「Spec 文件」→ 找到 `specs/tunnel/spec.md` → 点「编辑」 | 弹出编辑器；底部是引用语法说明（模型 / 错误码 / 配置键 / 协议头 / 状态码 / 调用），并给出解析状态「引用全部可解析」 |
| 3 | 把那一行 `- 错误码：E_GRANT_ALREADY_USED` 改成 `E_TOKEN_ALREADY_USED` | **不用保存，底部立刻变成「1 条未解析」**，该行标红，旁边出现 `L36 E_TOKEN_ALREADY_USED` 的跳转按钮 |
| 4 | 点「保存」，再回到「影响与门禁」→ 点「校验引用」 | 报 `ERROR unresolved-error-reference … E_GRANT_ALREADY_USED`，`spec validate: FAILED` |
| 5 | 把名字改回来，保存，再校验一次 | 重新 OK |

> **为什么改 `errors.md` 看不到底部变化**：编辑器底部统计的是**引用**（`错误码：Y` 这种语法）。
> `specs/errors.md` 里那些错误码是**定义**（写成 Markdown 表格），那个文件里引用数本来就是 0，
> 改名不会让徽章有任何变化。要现场看到"当场标红"，就照上面在 `tunnel/spec.md` 里改**引用**。
>
> 按老写法改 `errors.md` 的定义也可以，只是现象出现在别处：**引用图**里那条引用标红、
> **总览 → 问题清单**报出来、`spec validate` 报 `unresolved-error-reference`。
>
> 这一组现象正好讲清"定义"与"引用"是两回事：改定义不报错，改引用才报错；而**定义被改坏时，
> 受伤的是引用它的那些文件**——这正是「单一事实源 + 跨文件引用校验」要解决的问题。

**讲解点**：契约里的引用是机器校验的。改坏一个名字不用等人评审，30 秒内被抓住。

> 那条 `spec-is-draft` 是**故意留的**，别顺手批准——下一节就演它。
> 连括号里的口径一起说：「它说的是 audit 那份契约还没有人点头，所以还不能被计划冻结。
> 这只是 warning，不挡其它事；一会儿我们把这份草稿变成契约。」

---

## 5. 演示二 · 前半（约 3 分钟）：草案 → 定稿 → 拆解 → 冻结

### 先说清现在的状态（这句必须讲）

`prepare-demo.ps1` 特意把 **G3 留在起点**：`specs/audit/spec.md` 是**草案**，G3 的计划已经生成但
**没有冻结**，所以队列里还差 `G3:T1` 那一条（此刻 6 条待办 + 1 条在飞）。
其余 12 份 spec 是已定稿——种子里那些 capability spec 没写 `status` 字段，平台的判定就是「缺省即定稿」，
存量项目接进来也是这个样子。这一段就是让你亲手把「机器起草 → 人点头 → 机器拆解 → 冻结」推完。

| 步骤 | 操作 | 预期看到 |
|---|---|---|
| 1 | 左侧「规格」→ 页签「Spec 文件」 | `specs/audit/spec.md` 是橙色徽章 **草案**，右侧有「批准定稿」按钮；其余 12 份都是绿色**已定稿** |
| 2 | 点「批准定稿」→ 确定 | 徽章变绿；提示里带版本号（实测 `版本 v3`，从种子的 v1 顺延——退回草案和批准各登记了一版） |
| 3 | 页签「影响与门禁」→ 点「重新扫描」 | 一致性门禁从 1 条 finding 回到 **OK，0 finding**（上一步顺手登记了版本与基线） |
| 4 | 左侧「计划」→ 选 G3 | 计划状态 `draft`；下面 1 条任务（审计导出，绑 `specs/audit/spec.md`）；此时 生成 / 校验 / 评审 / 批准 可点，**冻结**按钮是灰的 |
| 5 | 依次点「校验」→「评审」→「批准」→「冻结」 | 校验只出结论、不动状态；评审后徽章 `draft → validated`，批准 `→ approved`（这时冻结才亮），冻结 `→ frozen`。**冻结**这一步才把「任务 ↔ 规格版本 / 哈希 / 验收项」固化 |
| 6 | 左侧「调度」→ 点「重建」 | 队列从 7 行变 **8 行**，多出 `G3:T1 queued` |

**讲解点**（这一段是全场的骨架，值得多说两句）：

- 机器可以起草——脚手架骨架、表格导入、Agent 起草，落盘时都带 `status: draft`；但**草案不能被
  `plan freeze` 绑定**：冻结会被直接拒绝，原文是「Spec … 仍是草案，不能冻结任务 …；先 cometflow spec
  approve … 再冻结」。这句拒绝现场撞不到（上一行你已经先把契约定稿了），口述带过即可——它回答的是
  「能不能先冻上、回头再让人看」，答案是不能。
- 拆解这一步不调用模型：4 条（这里是 1 条）任务全部从锚点派生，任务就绑在这个规格版本上。
- 「人只写规格」这句话的另一半在这里：规格必须有人负责，点头这个动作不能外包给机器。

> 三个容易混的说法，现场别混：**spec 定稿**（人批准这份契约，`status: approved`）、
> **计划冻结**（任务绑死规格的版本 / 哈希 / 验收，`plan freeze`）、
> **重新冻结基线**（工单换绑到新版本规格，`change rebase`）。中文都叫「冻结」，不是同一件事。

**这一步做完之后的状态**：队列 7 条待办 + 1 条在飞（共 8 行）、一致性门禁 0 finding、顶栏问题清单 0 warning。
后面第 6 节看 G1 的拆解结果、第 10 节的错 5 变体 A 都依赖这个「已经冻结的 G3」。

**别在主仓库点门禁卡**：主仓库没有 `metrics-baseline.json`（那是兜底仓库跑出来的），门禁卡会报一条
`FAIL metrics baseline`。门禁这一页在第 9 节用兜底仓库看。
顺带一提：主仓库「质量与健康度」里的锚点覆盖率现在是 **7/8（87.5%）**——G3:T1 还没冻结；第 5 步冻完就回到
**8/8**，兜底仓库一直是 8/8。这行数字本身也是个好例子：指标是推导出来的，不是人手填的。

**时间不够就跳过**：口述一句带过——「机器起草的 spec 是草案，人要点头才算契约，草案冻结不了计划」，
然后直接进第 6 节。但**跳过它就意味着第 10 节的错 5 只能用变体 B**：G3:T1 还没冻结，开不出工单。

**这一节被用掉了怎么办**（比如彩排时点完了）：重跑一次 `prepare-demo.ps1 -Force` 就回到起点。
不想重建仓库，也可以用「规格 → 脚手架 → 新增 capability 骨架」现造一份草案（填 `notify` 之类不撞名的名字），
照第 1–3 步走一遍；但那条只能演到「定稿」——新 capability 不在任何目标的范围里，`plan generate`
不会为它派生任务，也就冻结不出东西来。

---

## 6. 演示二 · 后半（约 2 分钟）：看已有的拆解结果

| 步骤 | 操作 | 预期看到 |
|---|---|---|
| 1 | 左侧「计划」→ 选 G1 | 一排按钮：生成、校验、评审、批准、冻结、重新生成、追溯 |
| 2 | 看下面的任务列表 | 4 条任务，每条标着接口标题、能力、绑定的 spec 文件与状态 frozen |
| 3 | 点「追溯」 | 展开任务 → 规格 → 验收条目的对应关系 |
| 4 | 左侧「调度」→ 看「队列内容」 | 8 行：G1:T1 标 running（就是那个工单），其余 queued——其中 G3:T1 是上一节刚冻出来的 |

**讲解点**：这 8 条任务没有一条是人手写的，全部从锚点派生。

（这一步和上一节合起来看：G1/G2 的 7 条是提前冻结好的，G3 那条是你刚刚亲手批准契约、拆解、冻结出来的。
第 4 步如果只有 7 行，说明上一节的「冻结」没点上。）

---

## 7. 演示三：运行 Builder（约 3 分钟，全场核心）

| 步骤 | 操作 | 预期看到 |
|---|---|---|
| 1 | 左侧「变更」→ 选中 `access-request` | 四个阶段停在「构建」；下方是契约快照（锚点、规格版本 v1、哈希、模块 `internal/access`、验收 A1–A3） |
| 2 | Agent 选 `opencode`，模型留空 | 留空即用项目配置里的默认模型 |
| 3 | 点「运行 Builder」 | 任务中心出现 job；inline 日志框只有三行摘要（`change run: agent=opencode` / `finished: phase=verify exit=0` / `succeeded`）——**平台不采集 Agent 的原始输出**，别等"先红后绿" |
| 4 | 等待约 2–3 分钟 | 实测 130 秒（Go 项目 + opencode）；这段只给最终判定，不给过程 |
| 5 | 跑完点「验收」 | 三行 `PASSED A1/A2/A3 [check]`，括号里是 `go test … -run '^TestA1$' -count=1` |
| 6 | 切到「范围」页签 | 改动的文件逐条列出，**归属**列显示 module-prefix / allow-list，越界 0 |
| 7 | 点「归档」 | `archived=true`，这一轮产生的规格变更一起落地 |

**「先红后绿」怎么讲**：界面上看不到 Agent 的中间输出（job 日志只有摘要）。红的状态在开场那一刻就是事实——主仓库没有实现，`go test` 是红的（`preflight.ps1` 也替你确认过）。口径用「**它自己反复跑到绿为止，界面只呈现最终判定**」，不要说"我们一起看它先红后绿"。

**等待时的口播**（避免冷场，任选）：
- 「Agent 拿到的是冻结版本的规格段落，加上这个任务的三条验收，它不用猜我们要什么。」
- 「注意它做判断的依据：规格里写了来源地址不在白名单时要拒绝，所以 A3 就是测这个行为。」
- 「如果它只做了一半，接下来我们会看到判据仍然是红的、任务被打回构建——这就是不接受自述。」

**卡住了怎么办**：超过 5 分钟没结束，就说「这正是不可自证完成」，点「验收」展示判 fail 打回构建，
然后切到兜底项目继续。

---

## 8. 演示四：启动调度器（约 3 分钟）

| 步骤 | 操作 | 预期看到 |
|---|---|---|
| 1 | 左侧「调度」→ 控制区 | 启动调度器 / 暂停 / 继续 / 停止 |
| 2 | 点「启动调度器」 | 它按顺序领走 G1 的第二个任务，队列里该行变 running |
| 3 | 看「调度器最近一次决策」 | 写着为什么领这一条、跳过了哪一条 |
| 4 | 点「停止」 | 真跑完剩下七条要十几分钟，时间不够 |
| 5 | 切到兜底项目 →「调度」 | 8 条全部交付，最后因为队列空了自己停 |

**讲解点**：这一段看的是调度决策，不是再让 Agent 写一遍代码——写代码的能力上一个桥段已经用真 Agent 证明过了。

---

## 9. 演示五：账本与门禁（约 1.5 分钟）

| 步骤 | 操作 | 预期看到 |
|---|---|---|
| 1 | 兜底项目 →「总览」 | 3 个目标全部冻结、8 个变更全部归档 |
| 2 | 看「问题清单」 | 与命令行门禁同一份投影，0 error 0 warning |
| 3 | 看「质量与健康度」 | 首次通过率、验收可执行率、锚点覆盖率、漂移 |
| 4 | 点「门禁」卡 | 逐项 PASS：规格校验、一致性检查、健康检查、计划校验、指标阈值、基线对比 |

**讲解点（原话）**：「和 CI 是同一份实现」的意思是判断过不过的代码只有一份。命令行调的、界面上点的、
CI 里跑的都是它，CI 那边只是一个薄壳负责把命令跑起来。所以本地绿就是流水线绿；反过来，CI 自己另写一套
脚本才危险，看着在拦其实没拦。

---

## 10. 五个错误演示（点击清单，约 4 分钟）

这五个错落在流程不同位置，用来回答「这些机制到底能拦住什么」。

### 错 1：改坏错误码的名字 → 规格校验拦住
「规格 → Spec 文件 → `specs/errors.md` → 编辑」把 `E_GRANT_ALREADY_USED` 改名 → 保存
→「影响与门禁 → 校验引用」。
**预期**：`ERROR unresolved-error-reference`，校验 FAILED。看完改回来。

### 错 2：验收只写一句「应该正常工作」、不挂命令 → 被标成不可执行
「规格 → Spec 文件 → `specs/guard/spec.md` → 编辑」把某条验收下面的 `- check:` 那一行删掉 → 保存
→ 切到「验收覆盖」页签。
**预期**：顶部「可执行 check」计数从 18 变成 17；那条验收在列表里没有命令。
**讲解**：判不出来的任务，无人值守会直接停机，不会白跑。看完把 `- check:` 加回来。

### 错 3：改到模块之外的文件 → 范围报告标越界

**第一步：先看健康态**（兜底项目「变更 → 勾选显示已归档 → 打开任意 change → 范围」）
页面显示「所有改动都在模块边界内」，每条改动标 `module-prefix` 或 `allow-list`。
注意 `metrics-baseline.json` 显示的是 `allow-list`——它是度量基线，属于项目产物，
已经写进使命文件的模块归属允许清单，**所以它不是越界例子**。

**第二步：当场造一个真的越界**（推荐在资源管理器里做，不需要命令行）
在 `D:\zqg\demos\cbb-emergency-access` 根目录新建一个文本文件，比如 `probe.txt`。
或者用第二个终端一行：

```powershell
cd D:\zqg\demos\cbb-emergency-access
New-Item probe.txt -ItemType File -Force
```

然后回浏览器「变更 → 选中 `access-request` → 点「刷新详情」→ 范围」页签。
**实测预期**：顶部出现「越界改动」区块，列表里是 `added probe.txt [OUTSIDE]`，
底部统计 `unattributed: 1`。

**第三步：让它拦住验收**：点「验收」，会被拒并报 `unattributed changes: probe.txt`，
任务退回构建阶段。删掉该文件（`Remove-Item probe.txt`）再验收一次就通过。

**实测证据**（放了两个模块外文件时的原始输出）：

```text
added docs/notes.md [OUTSIDE]
added probe.txt [OUTSIDE]
changes: 2 unattributed: 2
```

**讲解**：越界的改动会被直接拒绝；要放行就得在使命文件的模块归属里显式声明。
这条约束是多 Agent 并行时不互相踩的前提，也是"改动范围可审计"的来源。

### 错 4：还没实现就想点「验收」 → 流程上过不去
回到主项目「变更 → access-request（构建阶段）」。
**预期**：「验收」按钮是灰的，只有「运行 Builder」可点。
**讲解**：流程不给「跳过实现直接宣布通过」留口子。

### 错 5：让 Agent 自己说做完了 → 判据仍然红

**这条要看的是一个动作的后果**：让一个"什么都没做"的实现推进到验收阶段，看平台认不认。
两个演法，选一个即可。

**变体 A：零改动，最省事（推荐）**
用还没实现的能力开工单——当前主仓库只实现了 `access` 与 `tunnel`，`guard` / `audit` 还没有。
（前提：第 5 节已经把 G3 冻结过，否则 `G3:T1` 还不是可开工的任务；跳过第 5 节就改用变体 B。）

| 步骤 | 操作 | 预期 |
|---|---|---|
| 1 | 变更 → 新建：名字填 `self-claim`，goal 选 **G3**，task 选 **T1**（审计导出） | 工单停在 shape |
| 2 | 点「确认验收」→ Agent 下拉选 **mock**（它什么都不写）→ 点「运行 Builder」 | `change run: agent=mock` / `finished: phase=verify exit=0`——**它"完成"了** |
| 3 | 点「验收」 | 三行 **FAILED**，任务退回构建阶段，`repair_attempts=1` |

**变体 B：故意改坏一行（在演示四之后做，效果更戏剧）**
打开 `internal/access/service.go`，找到返回 `E_SELF_APPROVAL` 的那个判断（搜 `E_SELF_APPROVAL` 就能定位），
把它删掉或改成永不触发，保存；然后用 **G1 / T2（审批接口）** 开一个工单走同样的三步。
判据 A5 是「审批人不能审批自己的申请」，改坏之后 A4/A5/A6 一起变红。看完把那一行改回来。

**实测的预期输出**：

```text
FAILED A4 [check] check exited with code 1 [go test ./tests/acceptance -run '^TestA4$' -count=1]
FAILED A5 [check] check exited with code 1 [go test ./tests/acceptance -run '^TestA5$' -count=1]
FAILED A6 [check] check exited with code 1 [go test ./tests/acceptance -run '^TestA6$' -count=1]
change self-break phase=build reportPassed=false verifier=(none) repair_attempts=1
```

注意最后一行：`phase=build`——**任务被打回构建阶段**，不是被标记完成；`repair_attempts=1` 是修复轮次计数。

**讲解（这几句是关键）**：
- Builder 的退出码是 0、任务也确实推进到了验收阶段，从"过程"看一切正常；
- 但平台不认这个过程：`[check]` 表示结论来自可执行的判据，判据不过就是不完成；
- 这就是这一页要说的"不接受自述"——**完成的定义权不在实现者手里**，无论是真 Agent、mock，
  还是"看起来跑完了"；
- 失败之后任务回到构建阶段继续修，修复轮次有上限，连续几轮没有进展平台会停机等人介入，
  而不是无限重试烧预算。

---

## 11. spec 版本迭代：从 v1 到 v2（约 3 分钟）

**已实测的完整链路**（在 Go 项目上跑过）：

| 步骤 | 操作 | 实测预期 |
|---|---|---|
| 1 | 「规格 → Spec 文件 → `specs/tunnel/spec.md` → 编辑」把 A12 的措辞改一处，保存 | 保存即产生新版本 |
| 2 | 「影响与门禁 → 校验引用」 | `spec validate: OK` |
| 3 | 同页看「与基线的差异」和「冻结任务漂移」 | diff 显示 `specs/tunnel/spec.md modified`；漂移报 2 条：G2/T1 为 `LOW file-changed-anchor-unchanged`，**G2/T2 为 `HIGH acceptance-changed`** |
| 4 | 点「建立基线（spec lock）」 | 登记新版本：`versioned specs/tunnel/spec.md @v2` |
| 5 | 「计划 → 选 G2 → 重新生成（保留已批准）→ 校验 → 批准 → 冻结」 | 计划重新绑到新版本：绑这份文件的 G2/T1、G2/T2 退回 `draft`，绑 `guard` 的 G2/T3 原样保留；再冻结后 `spec_version` 从 v1 变 v2 |
| 6 | 「变更 → 新建」名字填 `tunnel-close-v2`，goal 选 G2、task 选 T2 → 新建 → 确认验收 → 运行 Builder（可选 mock）→ 验收 → 归档 | 验收输出 `PASSED A12/A13 [check]`（`go test` 形式） |
| 7 | 「规格 → 版本」页签 | `specs/tunnel/spec.md (2 versions)`，可查看历史正文并回放 |

**讲解点**：硬规矩是执行过程中不再重新解释规格——要按新写法做，就得先改规格、重新冻结、再开工单。
好处是每一份交付都能对回到一个确定的规格版本；半年后有人问「当时为什么这么定」，答案在版本历史里，
不在聊天记录里。

> **第 5 步的「重新生成」在冻结计划上也能点**（2026-09-20 修好）：它走的是 `plan regenerate
> --preserve-approved`。判据是**整份 spec 文件的哈希**：改了 `specs/tunnel/spec.md`，绑这份文件的
> G2/T1、G2/T2 就都退回 `draft`——哪怕 T1 的锚点一个字没动（漂移报告里它是 LOW 也是这个意思）；
> 绑别的文件的 G2/T3 原样保留。退回 draft 之后照旧走 校验 → 批准 → 冻结。
> **如果这个按钮是灰的**，说明拿的是旧前端产物，在仓库根目录重跑一次 `pnpm build` 再刷新页面。

**时间不够的删法**：只演 1→3（改规格 + 看漂移分级），第 4 步之后口头带过。

---

## 12. 收尾与兜底

| 情况 | 动作 |
|---|---|
| 时间还剩 | 打开「进化」「评估」两个面板各停 20 秒，说明平台还有这两块能力 |
| Agent 卡住/网络不通 | 切 `cbb-emergency-access-done`，流程照走，判据全绿 |
| 界面出问题 | 切到提前录好的录屏（第 7 节那四段） |
| 有人问演示环境怎么来的 | 说明两个仓库都由 `scripts/demo/prepare-demo.ps1` 从种子生成，脚本在仓库里，可以自己跑 |
| **Builder 跑完了但判据没过** | 这不是故障，是这一页想讲的事：点「验收」→ 三行 FAILED → 任务退回构建、`repair_attempts=1`。然后**再点一次「运行 Builder」**（多数第二轮就过），或直接切兜底仓库把后面的桥段演完 |

演示结束后，把主仓库恢复成上台前的样子：

```powershell
powershell -ExecutionPolicy Bypass -File D:\zqg\github\cometflow-enrich-ui\scripts\demo\prepare-demo.ps1 -Force
```

---

## 附：术语一句话（PPT 第 4 页「先把几个词说清楚」的口径，被问到就照这个说）

- **spec / 规格**：一个模块该做什么的说明书，放在 `specs/` 里，人和机器都读它。
- **锚点**：说明书里的一个小标题，一个锚点对应一件要做的事，也是任务的来源。
- **check / 判据**：一条能跑的命令。有它，对错不用靠人争论。
- **变更**：一次改动的工作区，从开工到归档的证据都在这个目录里。
- **验收**：拿判据核对这次改动，结论由机器给出，不由写代码的人自己说。
- **定稿（spec approve）**：规格自己的一步，front-matter 从 `status: draft` 变成 `approved`。
  机器起草的（脚手架 / 导入 / Agent）都是草案，草案不能被计划冻结绑定，得有人点这一下。
- **冻结（plan freeze）**：把「任务 ↔ 规格版本」固化下来（版本、哈希、模块、验收项）。
  冻的是「这次按哪一版规格做」，不是把规格文件锁死；规格改了要重新冻结、开新工单（第 11 节）。

---

## 附：编译、运行与手动验证

演示项目是**能真的编译、起服务、打接口**的。这一节是两条命令就能跑通的最短路径。

### A. 前置

| 检查 | 命令 | 期望 |
|---|---|---|
| Go 在 PATH | `go version` | go1.25 或更高 |
| cometflow 在 PATH | `cometflow --version` | 0.3.1 |
| 演示仓库就绪 | `powershell -ExecutionPolicy Bypass -File scripts\demo\preflight.ps1` | 末行 `preflight: OK —— 可以上台` |

### B. Windows

```powershell
cd D:\zqg\github\cometflow-enrich-ui

# ① 起服务（默认兜底仓库；端口 8080；Ctrl+C 停）
powershell -ExecutionPolicy Bypass -File scripts\demo\run-server.ps1

# ② 或者一条命令跑完：编译 → 起服务 → 打三条接口 → 断言 → 停服务
powershell -ExecutionPolicy Bypass -File scripts\demo\smoke-api.ps1
```

`smoke-api.ps1` 末行是结论：`smoke-api: OK —— 编译、起服务、三条接口全部符合契约`。

### C. Linux（含 WSL）

```bash
cd /mnt/d/zqg/github/cometflow-enrich-ui      # WSL 里的路径；原生 Linux 用你自己的仓库路径
chmod +x scripts/demo/*.sh

./scripts/demo/run-server.sh                  # 起服务（默认兜底仓库、端口 8080）
./scripts/demo/smoke-api.sh                   # 编译 → 起服务 → 打三条接口 → 断言
```

**离线环境**（WSL 默认没有外网、模块缓存里没有 SQLite 驱动）：把模块缓存指到 Windows 上已经下好的那一份，或在一台有网的 Linux 上先跑一次 `go mod download`。

```bash
export GOMODCACHE=/mnt/c/Users/zqg/go/pkg/mod
export GOFLAGS=-mod=mod
```

### D. 手动打三条（服务已在 8080 跑着）

三条命令演示的是**一台机器、一个人、三顶身份帽子**——不需要第二个人：

| 步骤 | 身份（请求头） | 预期 |
|---|---|---|
| 1 发起申请 | `x-actor-id: ops-on-call`、`x-actor-roles: requester` | 200，返回 `request_id`，状态 `pending` |
| 2 自己批自己 | `x-actor-id: ops-on-call`、`x-actor-roles: approver` | **403 `E_SELF_APPROVAL`** |
| 3 换人审批 | `x-actor-id: ops-lead`、`x-actor-roles: approver` | 200，状态 `approved`，返回一次性令牌 |

```bash
BASE=http://127.0.0.1:8080

# 1) requester 发起申请
cat > /tmp/req.json <<'JSON'
{"server_id":"srv-prod-01","reason":"磁盘告警","duration_minutes":15}
JSON
curl -s -X POST "$BASE/api/emergency/access/request" \
  -H 'content-type: application/json' \
  -H 'x-actor-id: ops-on-call' -H 'x-actor-roles: requester' -H 'x-forwarded-for: 10.0.0.8' \
  --data-binary @/tmp/req.json

# 2) 同一个人换审批角色去批自己（把 <RID> 换成上一步返回的 request_id）
printf '{"request_id":"%s","decision":"approve","comment":"自己批自己"}' <RID> > /tmp/self.json
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/emergency/access/approve" \
  -H 'content-type: application/json' \
  -H 'x-actor-id: ops-on-call' -H 'x-actor-roles: approver' \
  --data-binary @/tmp/self.json          # → 403

# 3) 换 ops-lead 审批
printf '{"request_id":"%s","decision":"approve","comment":"同意"}' <RID> > /tmp/appr.json
curl -s -X POST "$BASE/api/emergency/access/approve" \
  -H 'content-type: application/json' \
  -H 'x-actor-id: ops-lead' -H 'x-actor-roles: approver' \
  --data-binary @/tmp/appr.json          # → 200，响应里带 grant.token
```

> 为什么一台机器就能演"另一个人审批"：合同里 `auth.mode=header` 就是为演练与验收准备的
> （`specs/config.md`：`header=读 X-Actor-Id / X-Actor-Roles（仅演练与验收）`），
> 生产走管理平台会话。**审批人是身份，不是人。**验收用例 A4/A5 也是这么跑的。

### E. 配置文件

两个脚本都会在项目里生成 `demo/config.json`（键与 `specs/config.md` 一一对应）。改端口用
脚本的 `-Port` / 第二个参数；其余键一般不用动。三个容易踩的：

| 键 | 说明 |
|---|---|
| `auth.mode` | 必须是 `header`，否则服务拒绝一切请求（生产才用 `platform`） |
| `targets.file` | 目标服务器清单；`server_id` 不在清单里会返回 `E_SERVER_NOT_FOUND` |
| `access.allowed_source_cidrs` | 来源白名单；`x-forwarded-for` 不在里面会返回 `E_SOURCE_NOT_ALLOWED` |

### F. 常见现象与处置

| 现象 | 原因 | 处置 |
|---|---|---|
| 启动报 `实现尚未产出（spec 先行的种子项目的预期状态）` | 主仓库还没跑 Builder | 这是**预期状态**（判据此刻是红的）；跑完 Builder 或改用兜底仓库 |
| `E_SERVER_NOT_FOUND` | `server_id` 不在 `targets.file` 里 | 用夹具里的 `srv-prod-01` / `srv-prod-02` |
| `E_SOURCE_NOT_ALLOWED` | `x-forwarded-for` 不在白名单 | 用 `10.0.0.8`，或把网段加进配置 |
| 端口被占用 | 上一次的服务没退 | 换 `-Port 8090`，或关掉旧窗口 |
| `go build` 卡在下载依赖 | 离线环境没有模块缓存 | 见 §C 的 `GOMODCACHE` |

---

## 附：验证记录（2026-09-21 凌晨，本机实测）

### 一、这一版修掉的问题（按发现顺序）

**问题 1：真 Agent 跑到 G2-T2 时被 blocked，理由是"越界"。**

根因不在 Agent，在种子的接线方式：参考实现的 `internal/app` 要 import 全部 5 个 capability 包，
而种子只给了 `internal/app/seam.go` 与 `internal/contract`。于是**第一个任务（access）为了能编译，
必须把 `internal/tunnel`、`internal/guard`、`internal/audit` 一起造出来**——它们在别人的模块里，
范围报告如实记成 `OUTSIDE`，连续三轮同指纹，`repair_attempts` 打满 3，停机。

修法：种子补上「骨架」——`cmd/server/main.go`（契约里写明的进程入口）、
`internal/store`、`internal/access`、`internal/tunnel`（含演练用的内存转发器）、`internal/guard`、
`internal/audit` 的**接缝声明**，函数体返回 `E_NOT_IMPLEMENTED`。于是：

- 仓库从第一天就能 `go build`、能起服务、判据仍然是红的（`app.Start` 还是走 `ErrNotImplemented`）；
- 每个任务只动自己模块里的那个文件，不再需要为了编译去碰别人的模块。

修后实测（真 Agent，opencode）：Builder 136 秒完成，A1–A3 全过，范围报告变成

```text
change: access-request
module: internal/access
modified internal/access/access.go [module-prefix]
added internal/app/server.go [allow-list]
modified internal/store/store.go [allow-list]
changes: 3  unattributed: 0
```

**0 越界**（修之前是 7 个文件、1 个 OUTSIDE）。

**问题 2：兜底仓库是 mock 跑出来的，没法现场编译运行。**

两件事分开说：

- **能编译能运行**：参考实现是完整可运行的（纯 Go SQLite 驱动，免 cgo，Windows / Linux 都能编）。
  这一版补了 `run-server.ps1` / `run-server.sh` 与 `smoke-api.ps1` / `smoke-api.sh`，
  **一条命令完成「编译 → 起服务 → 打三条接口 → 断言」**，两个系统都实测通过（见下面第二、三节）。
- **provenance（这份代码是谁写的）**：兜底仓库确实是用 `mock` 把流程走完得到的——它验的是
  "流程与账本"，不是"Agent 现场产出"。要证明 Agent 真能做，看的是主仓库那一次 Builder；
  10 轮真 Agent 的通过情况见下一节。**演示时如实说明即可**，别把兜底说成 Agent 现场产出的。

**问题 3（做验证时才暴露）：种子注释在指引 Agent 去找"参考实现"，结果它真的去找了。**

跑第 11 次时 Agent 一行代码都没写（`changes: 0`），日志里能看到它做的事：

```text
=== search reference ===
Get-ChildItem -Path D:\zqg -Recurse -Directory | Where-Object { $_.Name -match 'reference|_reference' }
```

原因：种子的注释里写着「参考实现在 `_reference/` 下」（`seam.go` 与各 capability 的骨架都写了）。
演示仓库**不会**拷 `_reference/`，于是 Agent 满盘找、找不到，就把预算耗在找路上，最后什么都没写。
这也解释了 10 轮里那两次失败——那两轮分别只用了 119 秒和 141 秒。

修法：把种子注释里所有指向"参考实现"的话删掉，改成指向 **spec**
（例如「该写成什么样，以 `specs/access/spec.md` 的验收条目为准」）。
修完立刻复测：真 Agent 一次通过（A1–A3 全绿、`changes: 3 unattributed: 0`）。
顺带一张 A1–A8 对照表也写进了 `internal/access/access.go` 的注释。

**问题 4（2026-09-21 彩排暴露）：`access` 的 A7 写在别人的模块里，吊销任务只能越界去改 tunnel。**

现象：daemon 跑到 **G1:T3（`POST /api/emergency/access/revoke`）** 时连续三轮同一结论、`repair_attempts=3` 停机，
验收记录里判据反而是过的：

```text
- A7: passed [check] - check passed [go test ./tests/acceptance -run '^TestA7$' -count=1]
- violation: implementation escaped module internal/access: internal/tunnel/tunnel.go
```

根因不在 Agent，在这条验收的措辞。A7 原来写的是「申请单与授权都变 revoked，**且该令牌无法再建立通道**」，
而后半句是 **tunnel** 的事实（`specs/tunnel/spec.md` 的 A18 就是这么判的，用例里连「不得产生转发规则」都断言了）。
`tunnel` 属于 G2、调度顺序排在 G1 后面，于是：

- 只在 `internal/access` 里做，A7 永远红了（打开通道仍然返回 501 `E_NOT_IMPLEMENTED`）；
- 想让 A7 变绿，Agent 只能去实现 `internal/tunnel/tunnel.go` ——那是别人的模块，
  范围报告如实记成 `OUTSIDE`，验收不通过；每轮情况一样，指纹不变，三轮后停机。

顺带说明：Node 版种子没这个毛病（它的 A7 只断状态，Node 的 A18 单独判通道），是 Go 版移植时多写的半句。

修法（三处，都指向「一条验收只断言本 capability 的事实」，见 ADR 0031）：

| 落点 | 改动 |
|---|---|
| `specs/access/spec.md` | A7 收敛为「申请单与授权的状态都变 revoked」；正文补一句指向 tunnel 的 A18 |
| `tests/acceptance/acceptance_test.go` | `TestA7` 删掉「吊销后 open 必须 403 `E_GRANT_REVOKED`」那一步，注释写明它归 A18 |
| `internal/access/access.go`（种子注释） | A1–A8 对照表里 A7 那一行改为指向 tunnel 的 A18 —— 注释就是 Agent 的主要输入 |

修完实测（本机）：

- 兜底仓库（完整参考实现）：`go test ./tests/acceptance -count=1` → **18/18 PASS**，A18 照样盯着"被吊销的令牌不得产生转发规则"；
- 把 `internal/tunnel/tunnel.go` 换回种子骨架后：旧 A7 `FAIL`（期望 403 `E_GRANT_REVOKED`，实际 501 `E_NOT_IMPLEMENTED`）、
  新 A7 `PASS` —— 吊销任务在 `internal/access` 里就能验收；
- 平台侧同一条 change（tunnel 仍是骨架）：`change verify G1-T3` →
  `PASSED A7 [check]`、`changes: 3 unattributed: 0`、`reportPassed=true repair_attempts=0`，
  不再出现 `implementation escaped module`。
- **真 Agent 全流程复跑**（2026-09-21，opencode + deepseek-flash，隔离的临时演示根目录）：
  `prepare-demo.ps1 -Force` → `preflight: OK` → 主仓库跑 Builder（access-request，A1–A3 全绿、`unattributed: 0`、归档）
  → `daemon start --agent opencode`：G1:T2、**G1:T3**、G1:T4 依次交付（各自的 `verification.md` 都是 `scope: complete`、
  `repair_attempts: 0/3`、`result: pass`），daemon 里那句 `needs-human:verify-failed` 再没出现。
  G1:T3 那一轮 Agent 的收尾说明自己写着：「No changes to `internal/tunnel` or `internal/guard`;
  post-revoke channel behavior remains owned by tunnel A18.」——**措辞改了，行为就跟着改了**。
- 补了一条**平台级回归**（`test/domains/experiment-cbb-go-seed.test.ts`）：按 COMETFLOW.md 的调度顺序
  逐个 capability 贴参考实现，每贴一个就跑一遍「已交付模块」的全部判据，断言全绿。
  拿旧 A7 跑它会红（`已交付 access 时，判据 A1/…/A8 应当全绿：A7 期望 HTTP 403 + code "E_GRANT_REVOKED"，
  实际 HTTP 501 + code "E_NOT_IMPLEMENTED"`），拿新 A7 跑它是绿的——这条跨模块判据以后进不来。

> **为什么之前的 10 轮没抓到**：`validate-flow.ps1` 跑到「主仓库 Builder + 验收 + 归档 + 兜底 18/18」就收尾，
> 也就是只到 `G1:T1`；`G1:T3` 是调度器接着往下领任务时才会遇到的。要复现这个场景，
> 得让调度器把队列跑干（`cometflow daemon start <主仓库> --agent opencode`，约 10–15 分钟），
> 或者直接跑上面那条平台级回归（20 秒，不动 Agent）。

### 二、完整流程验证 ×10（真 Agent = opencode）

每轮跑的都是上台顺序：重建两个仓库 → `preflight` → G3 现场链路（批准定稿 / 校验 / 评审 / 批准 / 冻结）
→ 队列补齐到 8 行 → 主仓库跑 Builder → 验收 → 归档 → 范围报告 → 兜底仓库 18/18 → 接口冒烟。

| 轮 | 耗时 | 结果 |
|---|---|---|
| 1 | 141 秒 | 验收未过（Agent 首次没写全） |
| 2 | 194 秒 | 全过 |
| 3 | 119 秒 | 验收未过（同上） |
| 4 | 220 秒 | 全过 |
| 5 | 242 秒 | 全过 |
| 6 | 236 秒 | 全过 |
| 7 | 241 秒 | 全过 |
| 8 | 230 秒 | 全过 |
| 9 | 209 秒 | 全过 |
| 10 | 215 秒 | 全过 |

**结论**：

- 除"Agent 首次实现"这一步，其余每一步 **10/10 全过**（重建、自检、G3 四步、队列补齐、
  0 越界、兜底 18/18、编译起服务打接口）。
- 首次实现 **8/10 直接通过**；没过的两次都发生在耗时明显偏短的轮次（119–141 秒）。
  当时以为是"Agent 提前收工"，后来定位到真因是**种子注释在指引它去找参考实现**
  （见上一节问题 3）——修掉之后立刻恢复。
- 应对写在 §12 风险预案：点「验收」看它退回构建（这本身就是第 13 页要讲的事），
  **再点一次「运行 Builder」**，通常第二轮就过。
- 加固两处：删掉种子注释里指向 `_reference/` 的话；在 `internal/access/access.go` 的注释里
  补一张 A1–A8 对照表。加固后复测见第五节。

### 三、Windows：编译、起服务、打接口

```text
> powershell -ExecutionPolicy Bypass -File scripts\demo\smoke-api.ps1
build  : go build -o demo/server.exe ./cmd/server
  ok   服务就绪：http://127.0.0.1:8080
== A1 发起申请
  ok   HTTP 200 / code=0 / 返回 request_id / 状态 pending
== A5 自己批自己
  ok   HTTP 403 / code=E_SELF_APPROVAL
== A4 换人审批
  ok   HTTP 200 / code=0 / 状态 approved / 发放一次性令牌
smoke-api: OK —— 编译、起服务、三条接口全部符合契约
```

### 四、Linux：编译、起服务、打接口

```text
$ wsl -d Ubuntu-22.04 -e bash scripts/demo/smoke-api.sh /mnt/d/zqg/demos/cbb-emergency-access-done 8081
build  : go build -o demo/server ./cmd/server
  ok   服务就绪：http://127.0.0.1:8081
== A1 发起申请
  ok   HTTP 200（实际 200）/ code=0 / 返回 request_id / 状态 pending
== A5 自己批自己
  ok   HTTP 403（实际 403）/ code=E_SELF_APPROVAL
== A4 换人审批
  ok   HTTP 200（实际 200）/ code=0 / 状态 approved / 发放一次性令牌
smoke-api: OK —— 编译、起服务、三条接口全部符合契约
```

（Linux 侧环境：WSL Ubuntu-22.04 + Go 1.25.1 linux/amd64；离线，模块缓存借用 Windows 那一份。）

### 五、加固后复测

删掉指向 `_reference/` 的注释、并把 A1–A8 对照表写进 `internal/access/access.go` 之后，又跑了一轮 4 次：

| 轮 | 耗时 | 结果 |
|---|---|---|
| 1 | 211 秒 | 全过 |
| 2 | 251 秒 | 全过 |
| 3 | 238 秒 | 全过 |
| 4 | 197 秒 | 全过 |

**4/4 全过**，而且耗时都落在 197–251 秒这个"确实把活干完"的区间里
（之前失败的两轮是 119–141 秒）。再加上修完注释后单独跑的那一次（一次通过），
累计：**完整流程验证 15 次**，其中真 Agent 首次实现通过 13/15，加固后 **5/5**。
