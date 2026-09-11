# 演示脚本：用 CometFlow 实现 todoscan

本文是「用 CometFlow 从零实现一个小工具」的完整演示脚本。

- 演示种子（人类该写的部分，已随仓库提供）：[`experiments/todoscan/`](../../experiments/todoscan/README.md)
- 命令对照说明（每条 CLI 到底在做什么）：[`docs/demo/todoscan-demo-cli-notes.md`](./todoscan-demo-cli-notes.md)
- 平台使用说明：[`docs/USAGE.md`](../USAGE.md)

---

## 0. 演示要证明什么

一句话：**人类只写使命和 spec，CometFlow 把它拆成任务、驱动 Agent 实现、独立验收、归档，并用 eval 与 evolve 收口。**

| 演示环节 | 对应平台能力 | 看点 |
|---|---|---|
| A 初始化 | `init --interactive` | 12 类 spec kind 按项目类型自动裁剪 |
| B 写契约 | `COMETFLOW.md` + `specs/` | anchor / acceptance / 跨文件引用（错误码） |
| C 校验 | `spec validate` / `lock` / `index` | 结构与跨文件引用校验、可追踪基线 |
| D 拆解 | `plan generate/validate/review/approve/freeze/trace` | 3 个 capability → 5 个任务，acceptance 精确落位 |
| E 执行 | `change new/transition/run/verify/archive` | Builder 与 Verifier 分离，独立验收才准归档 |
| F 收尾 | `change resume` / `doctor` / `status` | 断点续作与可观测 |
| G 门禁 | `eval` | Pass@k / Pass^k，回归可拦截 |
| H 进化 | `evolve propose/verify/submit/approve` | 有终态、可回滚的改进闭环 |

总时长建议 25 分钟（现场只跑 E 的一个任务，其余预跑或快进）。

---

## 1. 工具定义：todoscan

**todoscan** 是一个零依赖的 Node CLI：递归扫描指定目录里的 `TODO` / `FIXME` / `HACK` 注释并汇总输出，供代码评审和 CI 使用。

### 1.1 CLI 契约

```bash
node bin/todoscan.mjs <dir> [--tag <TAG>]... [--exclude <PATH>]... [--json]
```

| 行为 | 约定 |
|---|---|
| 扫描范围 | 递归 `<dir>`，跳过 `.git/` 与 `node_modules/` |
| 识别标签 | `TODO`、`FIXME`、`HACK`，忽略大小写 |
| 只识别注释行 | 行内首个非空白内容属于 `//`、`#`、`/*`、`*`、`<!--` |
| 输出顺序 | 路径字典序，其次行号升序 |
| text 输出 | 每行 `<path>:<line>:<TAG> <text>`，最后一行 `total: <N>` |
| json 输出 | `{"total":N,"items":[{"path","line","tag","text"}]}` |
| 退出码 | 正常 0；目录不存在 2（`E_NO_PATH`）；配置非法 2（`E_BAD_CONFIG`） |

### 1.2 为什么选它

- **够小**：约 150 行实现 + 几个测试，一次 Agent 会话能完成。
- **零依赖、无网络**：任何机器都能跑，不受内网/代理影响。
- **可确定性验收**：每条 acceptance 都能用一条命令判定，适合演示 eval 门禁。
- **天然有配置和错误码**：可以演示 `config` / `errors` 两个 spec kind 与跨文件引用校验。

---

## 2. 事前准备

```bash
# 平台侧（只需一次）
pnpm install
pnpm build
npm link            # 之后可直接用 cometflow 命令；或改用 node dist/app/cli/index.js

# 确认外部 Agent（真实执行需要至少一个）
cometflow agent list
```

本机实测输出（`mock` 永远可用，用于兜底）：

```text
opencode	opencode	available
claude-code	Claude Code	available
mock	mock	available
```

> 交互式 `init` 必须在**真实终端**里跑：向导每次提问都会新建一个 readline 实例，
> 用管道（`echo ... | cometflow init --interactive`）喂答案会在第二问后静默退出。

---

## 3. 步骤 A：初始化项目

```bash
mkdir -p ~/demos && cd ~/demos
cometflow init todoscan --interactive
cd todoscan
```

依次回答（**照抄即可**）：

| # | 问题 | 回答 |
|---|---|---|
| 1 | 前端框架（无则填 无） | `无` |
| 2 | 后端语言/框架（无则留空） | `Node.js` |
| 3 | 数据库（无则填 无） | `无` |
| 4 | 是否有对外网络接口 / 通信协议？ | 回车（否） |
| 5 | 是否有运行时配置键？ | `y` |
| 6 | 是否有跨接口/跨模块的业务场景？ | 回车（否） |
| 7 | 是否有常驻后台进程或定时循环？ | 回车（否） |
| 8 | 是否有领域 DSL 或业务不变量？ | 回车（否） |
| 9 | 鉴权方式 | `none` |
| 10 | 错误码是否较多（>20 个）？ | `y` |

预期输出（只生成 4 个 kind，其余留痕为 absent）：

```text
initialized .../todoscan/COMETFLOW.md
scaffolded specs/constraints.md
scaffolded specs/errors.md
scaffolded specs/config.md
wrote .../todoscan/.cometflow/init-manifest.yaml
```

核对裁剪结果：

```bash
cometflow spec scaffold --list .
```

```text
project: present (always)
models: absent (database == none)
pages: absent (frontend == none)
constraints: present (backend present)
capability: absent (derived from goals, not init)
protocol: absent (no network interface)
errors: present (many error codes)
config: present (runtime config: yes)
flow: absent (no cross-api scenario)
process: absent (no background loop)
rules: absent (no domain dsl)
permissions: absent (auth: none)
```

> 讲解点：12 类 spec 不是让人类全写一遍，而是由技术栈 + 7 个问题推导出**真正需要的 4 个**；
> 「确定不需要」也会写进 `.cometflow/init-manifest.yaml`，让 `spec validate` 能区分「有意缺席」和「遗漏」。

---

## 4. 步骤 B：写契约

### 4.1 覆盖 COMETFLOW.md

```markdown
# 项目使命

todoscan：一个零依赖的命令行小工具，扫描指定目录里的 TODO / FIXME / HACK 注释并汇总输出，供代码评审和 CI 使用。

## 技术栈

| 维度 | 值 |
|------|-----|
| 前端 | 无 |
| 后端 | Node.js |
| 数据库 | 无 |
| 缓存 | 无 |
| 测试框架 | node --test |
| 构建工具 | 无（纯 ESM，零依赖） |

## 运行环境

| 维度 | 值 |
|------|-----|
| 操作系统 | 跨平台 |
| 部署方式 | 本地 CLI |
| 语言版本 | Node 22+ |

## 任务目标

### G1：todoscan 命令行扫描器
- 目标：实现一个零依赖的 Node CLI，递归扫描目录中的 TODO/FIXME/HACK 注释并输出报告
- 范围：scan, report, settings
- 成功标准：
  - `node bin/todoscan.mjs <dir>` 能输出全部命中项，且顺序稳定
  - `--json` 输出可被程序解析
  - 配置文件与命令行参数的优先级明确且可测
- 非目标：
  - 不做语法解析（按行匹配注释文本即可）
  - 不做增量缓存、不做常驻进程
  - 不做网络请求
```

### 4.2 写 capability spec（关键：每个 anchor 带自己的 Acceptance）

`specs/scan/spec.md`：

```markdown
---
capability: scan
---

# scan capability

负责在文件系统中找出待办注释。

## scan <dir>

递归扫描 `<dir>`，找出所有待办注释。

- 跳过的目录：`.git`、`node_modules`
- 识别标签：`TODO`、`FIXME`、`HACK`（忽略大小写）
- 只识别注释行：行内首个非空白内容为 `//`、`#`、`/*`、`*`、`<!--` 之一
- 输出顺序：路径字典序，其次行号升序
- 错误码：E_NO_PATH

### Acceptance

- A1：运行 `node bin/todoscan.mjs tests/fixtures`，命中 6 条，路径顺序为 app.js → lib/util.js → notes.md → vendor/legacy.js
- A2：运行 `node bin/todoscan.mjs no-such-dir`，stderr 含 `E_NO_PATH` 且退出码为 2

## 过滤

在扫描结果上做标签与路径过滤。

- `--tag <TAG>`：可重复传入，只保留标签匹配的项
- `--exclude <PATH>`：可重复传入，路径包含该片段的项一律排除
- 配置键：exclude、tags

### Acceptance

- A3：`--tag FIXME` 只输出 1 条；`--exclude vendor` 输出 5 条
```

其余三个文件内容见种子（可直接整目录复制）：

| 文件 | 内容要点 |
|---|---|
| [`specs/report/spec.md`](../../experiments/todoscan/specs/report/spec.md) | `## report text`（A4）、`## report json`（A5） |
| [`specs/settings/spec.md`](../../experiments/todoscan/specs/settings/spec.md) | `## load-config`（A6 坏配置、A7 配置优先级） |
| [`specs/errors.md`](../../experiments/todoscan/specs/errors.md) | `E_NO_PATH`、`E_BAD_CONFIG` |
| [`specs/config.md`](../../experiments/todoscan/specs/config.md) | `exclude`、`tags` |
| [`specs/constraints.md`](../../experiments/todoscan/specs/constraints.md) | 零依赖、性能、部署约束 |

### 4.3 铺测试夹具

`tests/fixtures/` 共 6 条待办注释，是 A1/A3/A4/A5/A7 的确定性依据：

```text
tests/fixtures/app.js            // TODO + // FIXME      → 2 条
tests/fixtures/lib/util.js       /* HACK + // TODO      → 2 条
tests/fixtures/notes.md          <!-- TODO ... -->      → 1 条
tests/fixtures/vendor/legacy.js  // TODO                → 1 条
```

懒人做法（用种子一次覆盖到位）：

```bash
cp -r <cometflow 仓库>/experiments/todoscan/COMETFLOW.md .
cp -r <cometflow 仓库>/experiments/todoscan/specs/* specs/
cp -r <cometflow 仓库>/experiments/todoscan/tests .
```

> **讲解点（很重要）**：`### Acceptance` 写在哪个 anchor 下面，验收项就归属哪个任务。
> 若整文件只写一个 `## Acceptance`，则该文件所有任务会共享同一组 acceptance。

---

## 5. 步骤 C：同步与校验

```bash
cometflow context sync .     # 技术栈/运行环境 → .cometflow/project-context.yaml
cometflow goal sync .        # 任务目标 → .cometflow/goals/G1.yaml
cometflow spec validate .    # 结构 + anchor + acceptance + 跨文件引用
cometflow spec lock .        # 快照 spec hash 基线
cometflow spec index .       # 生成 spec-index 投影
```

实测输出：

```text
wrote .../.cometflow/project-context.yaml
wrote .../.cometflow/goals/G1.yaml
spec validate: OK
wrote .../.cometflow/spec-lock.json
wrote .../.cometflow/spec-index/{models,apis,flows,errors,config}.yaml
```

> 可以现场故意把 `specs/scan/spec.md` 里的 `错误码：E_NO_PATH` 改成 `E_TYPO`，
> 再跑 `spec validate`，就会看到 `ERROR unresolved-error-reference`——这一条最能说明
> 「spec 是机器可校验的契约，不是文档」。

---

## 6. 步骤 D：拆解到冻结

```bash
cometflow plan generate G1 .
cometflow plan validate G1 .
cometflow plan review G1 .      # draft → validated
cometflow plan approve G1 .     # → approved
cometflow plan freeze G1 .      # → frozen，锁定 acceptance + spec_hash
cometflow plan trace G1 .
```

实测结果：3 个 capability 拆出 **5 个任务**，acceptance 精确落位——

| 任务 | anchor | acceptance |
|---|---|---|
| T1 | scan - `scan <dir>` | A1, A2 |
| T2 | scan - `过滤` | A3 |
| T3 | report - `report text` | A4 |
| T4 | report - `report json` | A5 |
| T5 | settings - `load-config` | A6, A7 |

```text
plan validate: OK
goal: G1
status: frozen
T1: 实现 scan - scan <dir>
  capability: scan
  spec: specs/scan/spec.md
  anchor: scan <dir>
  acceptance: A1, A2
  status: frozen
...
```

> 讲解点：`freeze` 之后任务才带 `spec_hash`；之后若 spec 被改动，
> `cometflow spec drift .` 会把这个任务标出来——历史不可变。

---

## 7. 步骤 E：执行 T1（现场主要看点）

```bash
cometflow change new scan-core --goal G1 --task T1
cometflow change transition scan-core confirm-acceptance .
cometflow change run scan-core . --agent opencode
```

`change new` 会生成 `changes/scan-core/brief.md`；`confirm-acceptance` 把阶段从 `shape` 推到 `build`；
`change run` 调用 Builder Agent 实现，成功后自动进入 `verify`：

```text
created change scan-core phase=shape
wrote .../changes/scan-core/comet-state.yaml phase=build archived=false
change scan-core phase=verify agentExit=0
```

**可选但推荐**：`brief.md` 默认只含任务标题与 DoD，把验收项贴进去能让演示更稳定
（Agent 就不必自己回读 spec）：

```bash
cat >> changes/scan-core/brief.md <<'EOF'

## Acceptance
- A1：运行 `node bin/todoscan.mjs tests/fixtures`，命中 6 条，顺序 app.js → lib/util.js → notes.md → vendor/legacy.js
- A2：运行 `node bin/todoscan.mjs no-such-dir`，stderr 含 `E_NO_PATH` 且退出码为 2
EOF
```

### 7.1 独立验收（Verifier 的活）

逐条跑 acceptance（这就是「生成与评价分离」——不采信 Builder 的自述）：

| 编号 | 命令 | 期望 |
|---|---|---|
| A1 | `node bin/todoscan.mjs tests/fixtures` | 6 行命中，最后一行 `total: 6` |
| A2 | `node bin/todoscan.mjs no-such-dir; echo $?` | stderr 含 `E_NO_PATH`，退出码 `2` |
| A3 | `node bin/todoscan.mjs tests/fixtures --tag FIXME` | 1 条 |
| A3 | `node bin/todoscan.mjs tests/fixtures --exclude vendor` | `total: 5` |
| A4 | 同 A1 | 每行形如 `tests/fixtures/app.js:1:TODO 支持除 --json 之外的输出格式` |
| A5 | `node bin/todoscan.mjs tests/fixtures --json` | 可 `JSON.parse`，`items.length === total === 6` |
| A6 | `echo '{bad' > .todoscanrc.json && node bin/todoscan.mjs tests/fixtures; echo $?` | stderr 含 `E_BAD_CONFIG`，退出码 `2` |
| A7 | `echo '{"exclude":["vendor"]}' > .todoscanrc.json && node bin/todoscan.mjs tests/fixtures \| tail -1` | `total: 5`；再传 `--exclude lib` 得 `total: 4` |

把结论写进 `changes/scan-core/verification.yaml`（**id 必须与冻结的 acceptance_ids 完全一致**）：

```yaml
schema: cometflow.verification.v1
change: scan-core
acceptance:
  - id: A1
    result: passed
    reason: 对 tests/fixtures 命中 6 条，路径顺序符合字典序约定
  - id: A2
    result: passed
    reason: 目录不存在时 stderr 输出 E_NO_PATH，退出码 2
```

然后归档：

```bash
cometflow change verify scan-core .     # → phase=archive, reportPassed=true
cometflow change archive scan-core .    # → archived=true
cometflow change list .
```

```text
change scan-core phase=archive reportPassed=true
change scan-core archived=true
scan-core archive done archived
```

> 若没有 `verification.yaml`，`change verify` 会退化为直接跑 `.cometflow/eval.yaml`；
> 若 acceptance 数量或 id 对不上，会直接报 `acceptance coverage mismatch`。

---

## 8. 步骤 F：跑完 T2–T5

每个任务都是「新建 → 确认验收 → 跑 Builder → 独立验收 → 归档」的同一套动作：

```bash
for spec in "scan-filter T2" "report-text T3" "report-json T4" "settings-config T5"; do
  set -- $spec
  cometflow change new "$1" --goal G1 --task "$2"
  cometflow change transition "$1" confirm-acceptance .
  cometflow change run "$1" . --agent opencode
done
```

> 演示提速：T2–T5 可以提前跑完并把 change 归档，现场只演示 T1；
> 或者用 `--agent mock` 快速走一遍状态机（**不产生真实代码**，仅演示流转）。

随时可看进度：

```bash
cometflow change resume scan-filter .   # 断点续作：下一步该发什么事件
cometflow status .                      # 目标/计划/变更/进化 一览
cometflow doctor .                      # 健康检查
```

---

## 9. 步骤 G：eval 门禁

写 `.cometflow/eval.yaml`（`.cometflow/` 已被 gitignore，属于本机状态）：

```yaml
schema: cometflow.eval.v1
sampling: 1
pass_at_k: 1
pass_all_k: 1
tasks:
  - name: unit-tests
    command: node
    args: ["--test"]
  - name: acceptance-total
    command: node
    args: ["bin/todoscan.mjs", "tests/fixtures"]
    assertions:
      - target: stdout
        operator: contains
        value: "total: 6"
  - name: acceptance-json
    command: node
    args: ["bin/todoscan.mjs", "tests/fixtures", "--json"]
rubric:
  - id: acceptance
    description: 7 条 acceptance 全部可复现
    task: acceptance-total
judge:
  provider: mock
```

```bash
cometflow eval .
```

```text
unit-tests: PASS (1/1)
acceptance-total: PASS (1/1)
acceptance-json: PASS (1/1)
rubric acceptance [acceptance-total]: PASS passRate=1.00
pass@k rate: 1.00 (k=1)
pass^k rate: 1.00 (k=1)
eval: PASS
```

> 可以现场把 `total: 6` 改成 `total: 7`，再跑一次 `cometflow eval .` 看它变 FAIL——
> 这就是「可拦截回归」的证据。

---

## 10. 步骤 H（进阶）：用 evolve 加一个改进

目标改进：**新增 `--fail-on <TAG>`，命中该标签时退出码为 1，供 CI 直接使用。**

### 10.1 提案

```bash
cometflow evolve propose fail-on --summary "新增 --fail-on，命中即退出码 1，供 CI 使用" \
  --risk "低风险：只影响退出码，不改变扫描与输出格式"
```

### 10.2 门禁配置

`evolve verify` 默认跑 typecheck + tests；本项目没有 TypeScript，显式声明门禁：

```yaml
# .cometflow/evolve.yaml
schema: cometflow.evolve.v1
gates:
  - name: unit-tests
    command: node
    args: ["--test"]
  - name: acceptance-total
    command: node
    args: ["bin/todoscan.mjs", "tests/fixtures"]
```

```bash
cometflow evolve verify fail-on .          # 真实门禁 → verified
cometflow evolve verify fail-on . --eval   # 叠加科学评估（可选）
cometflow evolve submit fail-on .          # 生成 evolve/fail-on/review.md → ready-for-review
cometflow evolve review-list .             # 人工盘点
cometflow evolve approve fail-on . --note "门禁通过，已合入" --commits <sha1,sha2>
```

```text
unit-tests: OK
acceptance-total: OK
evolution fail-on status=verified
evolution fail-on status=ready-for-review
evolution fail-on status=approved
```

`evolve/<name>.yaml` 会留下决策字段，`evolve/<name>/review.md` 追加 `## Decision`：

| 字段 | 含义 |
|---|---|
| `review_note` / `merged_commits` | approve 写入 |
| `rejected_reason` | reject 写入 |
| `decision_at` | 决策时间 |

回滚指引：`cometflow evolve rollback fail-on .`

### 10.3 如果这次改进要改 spec（可选，最能展示 spec 治理）

给 `specs/scan/spec.md` 追加一条验收：

```markdown
- A8：`--fail-on FIXME` 命中时退出码为 1，未命中时为 0
```

然后：

```bash
cometflow spec validate .
cometflow spec diff .          # modified: specs/scan/spec.md
cometflow spec drift .         # T1/T2 的 spec_hash 已漂移
cometflow plan regenerate G1 . --preserve-approved   # T1/T2 回到 draft，其余保留/取消
cometflow plan validate G1 .
cometflow plan approve G1 .
cometflow plan freeze G1 .
```

> 讲解点：**已完成的任务历史不改**，只通过重新拆解 / reconciliation change 去消化 spec 变更。

---

## 11. 收尾：把过程展示出来

```bash
cometflow doctor .            # 健康检查
cometflow status .            # 状态摘要（JSON）
cometflow dashboard .         # 只读看板 http://127.0.0.1:4321
cometflow serve               # 完整 Web 客户端（首页 → 新建/打开项目 → 各面板）
```

`serve` 会打印一次性 token，浏览器访问 `http://127.0.0.1:4321/?token=<token>` 即可；
Goals / Specs / Plans / Changes / Evolve / Eval 面板对应上面每一步的产物。

---

## 12. 时间轴建议

| 分钟 | 内容 | 现场/预跑 |
|---|---|---|
| 0–3 | 讲背景：人类写契约，机器做实现与验收 | 现场 |
| 3–6 | 步骤 A：`init --interactive` 演示 12-kind 裁剪 | 现场 |
| 6–9 | 步骤 B/C：贴 spec，`spec validate` 现场改错演示引用校验 | 现场 |
| 9–12 | 步骤 D：拆解 → 5 个任务 → freeze → trace | 现场 |
| 12–20 | 步骤 E：真实 Agent 跑 T1 + 独立验收 + 归档 | 现场 |
| 20–23 | 步骤 G：eval 门禁（含一次故意失败） | 现场 |
| 23–25 | 步骤 H：evolve 提案与终态；`serve` 看板收尾 | 现场（提案）+ 预跑（门禁） |

---

## 13. 兜底与注意事项

| 风险 | 兜底 |
|---|---|
| 现场没装 opencode/claude-code | 用 `--agent mock` 走完状态机；验收环节改用**预跑好的**产物 |
| Agent 实现不完全符合 spec | 这正是看点：`change verify` 判 fail → 回到 `build`，展示「不可自证完成」 |
| 时间不够 | T2–T5 预跑；现场只演 T1 与 eval |
| `init --interactive` 卡住 | 必须在真实终端运行，不要用管道喂输入 |
| `verification.yaml` 报 coverage mismatch | acceptance 的 id 集合必须与冻结的 `acceptance_ids` **完全一致** |
| 端口冲突 | `dashboard` 与 `serve` 默认都是 `4321`，用 `--port` 分开 |
| 演示产物污染版本库 | `.cometflow/` 已 gitignore；`changes/`、`evolve/`、`reports/` 按需自行忽略 |
| Windows 上 opencode 卡住 | 平台已内置 Windows 控制台继承处理，无需额外配置 |

---

## 14. 附：一键复核脚本（可选）

用于演示前 5 分钟自检（假定已在演示项目根目录、且实现已完成）：

```bash
set -e
cometflow doctor .
cometflow spec drift .
cometflow plan trace G1 .
cometflow change list --all .
cometflow eval .

# 注意：spec validate / plan validate 即使 FAILED 也返回退出码 0，
# 所以必须抓输出文本判断，不能只靠 set -e。
for check in "spec validate ." "plan validate G1 ."; do
  out=$(cometflow $check); echo "$out"
  echo "$out" | grep -q "OK" || { echo "precheck failed: cometflow $check"; exit 1; }
done

echo "demo precheck: OK"
```
