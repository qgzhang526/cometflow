# 星尘前哨 Stardust Outpost

> 放置经营类太空殖民地小游戏：作为 **cometflow Web 前端（serve + 面板 UI）的功能验证靶子**。
> 每一个游戏操作驱动一个前端面板，每一类游戏实体对应一个 spec kind。

## 定位

- 游戏本身 = 一个持续演进的「殖民地开发项目」，玩家通过 cometflow 前端面板操作它。
- 前端每个面板都有对应玩法，不是「为了测 UI 硬套」，而是玩法自然产生前端需求。
- 核心引擎是纯 TS（后续 G1 实现），本目录当前为 **spec + goal 骨架**，可直接导入前端验证。

## 目录结构

```text
COMETFLOW.md            使命 + 技术栈/运行环境表 + G1~G5 目标
specs/
  models.md             实体（Colony/Resource/Building/ProductionTask）+ 枚举 + 状态机
  config.md             平衡参数（产量/成本/tick）
  errors.md             错误码目录
  rules.md              领域规则（建造前提/上限/单目标单任务）
  processes.md          常驻进程 production-tick
  protocol.md           传输契约
  constraints.md        非功能约束
  permissions.md        认证与鉴权（本地单机）
  pages.md              前端页面（由 cometflow Web 面板承担）
  flows/build-facility.md    建造流程（引用 POST /buildings、GET /state）
  flows/research-tech.md     研究流程（引用 POST /research、GET /state）
  engine/spec.md        引擎能力（GET /state、POST /tick）
  build/spec.md         建造能力（POST /buildings）
  research/spec.md      研究能力（POST /research）
.cometflow/init-manifest.yaml   12-kind 状态（本机验证用，可经 spec scaffold 重建）
```

## 如何导入 cometflow Web 前端

```bash
cd D:\zqg\github\cometflow
pnpm exec tsx app/cli/index.ts serve --workspace <你的工作区目录>   # 或 cometflow serve
# 打开打印的 http://127.0.0.1:PORT ，首页 [打开已有项目]
# 输入本目录路径：D:\zqg\github\cometflow\experiments\stardust-outpost
```

## 前端功能验证清单（面板 → 操作 → 预期）

| 面板 | 操作 | 预期（验证点） |
|------|------|----------------|
| 首页 | [打开已有项目] 导入本目录 | 项目列表出现「星尘前哨」，含 G1~G5 目标数摘要 |
| Goals | 点 [同步 (context + goal)] | 生成 .cometflow/goals/G1..G5.yaml；目标列表显示 5 条 + scope |
| Specs | 查看 12-kind 状态 | 全部 present 徽章；kind/reason 正确 |
| Specs | 点 [校验引用] | **0 error**；models/apis/flows/errors/config 计数正确 |
| Specs | 点 spec 文件 | 编辑 models.md/config.md 等可保存 |
| Specs | 故意改坏一处引用（如 rules.md 的 `模型：Building` 改成 `模型：Nope`）再校验 | 红色 unresolved-model-reference 定位到文件 |
| Plans | 选 G1 点 [生成]→[校验]→[批准]→[冻结] | 计划状态流转；任务列表覆盖 spec_ref |
| Changes | 按计划任务新建 change → run | job 日志终端轮询输出；施工进度实时 |
| Evolve | propose 科技提案 → submit → approve | 提案状态机流转（G4 落地后可用） |
| Eval | 运行评估（G5 落地后） | job 返回结果 + Eval 面板展示 |
| Settings | 改默认 agent/model | 保存后 config 回读一致 |
| 全局 | 任意面板操作 | SSE state.changed 触发界面自动刷新 |

## 可扩展性路线

| 期 | 游戏机制 | 新增 spec/前端验证点 |
|----|----------|---------------------|
| G1 | 引擎 + 数据模型 | models/process/config |
| G2 | 建造工作流 | flow + change + job/SSE |
| G3 | 目标拆计划 | goals + plan 面板 |
| G4 | 科技树 | evolve 面板 |
| G5 | 平衡评估 | eval 面板 |
| G6+ | 新资源/新建筑/随机事件/多殖民地/成就/离线收益 | 每加一个 = 新 spec + 新 change，持续 dogfooding |

## 备注（可扩展点，非本骨架职责）

- Settings 面板当前只暴露平台 config（agent/model/scheduler）；游戏平衡参数在 `specs/config.md`，经 Specs 面板编辑。
- .cometflow/ 按平台约定不入库；换机器后先点 Goals 面板 [同步]、Specs 面板 [生成/补全] 即可重建。
- `.cometflow-history/` **入库**：它是 spec 的内容寻址版本仓（`spec lock` 登记，14 个 spec 各 v1）。
  换机器后 `cometflow spec versions .` / `spec show specs/engine/spec.md@1` 仍可回放；
  这也是 Specs 面板「版本」页签的数据来源。运行状态（config/goals/plans/runtime）仍在 `.cometflow/`，不入库。
