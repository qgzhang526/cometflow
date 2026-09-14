# ADR 0019：Web 客户端采用 Vue 3 + Vite + TypeScript

状态：已批准
日期：2026-09-14
关联：ADR 0007（UI headless service）、008-client-visualization.md、[web-ui-enrichment-plan.md](../plan/web-ui-enrichment-plan.md)

## 背景

0.1.x 的 Web 客户端是 `web/app.js` 单文件 vanilla JS（约 800 行）+ `web/style.css`，由 `cometflow serve` 直接静态托管源码目录。它在「8 个面板 + 一个向导」的规模上还能用，但已经出现三类结构性问题：

1. **界面状态与领域状态没有分层**：面板用 `innerHTML` 整体重建，动作完成后会把用户正在看的详情/日志一起冲掉（评估跑完面板变成变更列表、验收结论无处安放）。
2. **没有类型契约**：`/api` 返回的领域结构（change 状态、verdict、实现范围报告）在客户端全是 `any`，字段改名只有运行时才暴露。
3. **事件与任务没有归属**：SSE 事件到达就整页重渲染，job 只在某个面板里被轮询，刷新即丢失。

按 [web-ui-enrichment-plan.md](../plan/web-ui-enrichment-plan.md)，W2–W5 还会把面板数翻倍（spec 内核、change 审计、调度、Skill/Bundle、Hook）。继续在单文件上叠加，维护成本会先于功能增长到达上限。

## 决策

1. Web 客户端改用 **Vue 3 + Vite + TypeScript** 重写，源码位于 `web/src/`，Vite 根目录为 `web/`，构建产物为 `web/dist/`。
2. **不引入组件库**（008 §10 的「最小依赖优先」）：依赖只保留 `vue`、`vue-router`(hash 路由)、`pinia`，样式沿用既有 `web/src/styles/main.css` 的设计令牌与类名。
3. **前端依赖挂在仓库根 `package.json`**，不做独立的 pnpm workspace：`pnpm install` 一次装齐 CLI 与 Web，`pnpm build` 同时产出 `dist/`（CLI）与 `web/dist/`（SPA）。理由见下。
4. `cometflow serve` 的静态目录解析改为「优先命中有 `index.html` 的候选目录」：默认 `web/` 时自动使用 `web/dist/`，`--web-dir` 与 `COMETFLOW_WEB_DIR` 仍可显式指定。
5. 客户端侧强制三件事：**只读 store 拿数据、动作走 API 并给反馈（toast）、事件驱动刷新（按区域去抖 + 编辑中挂起）**；`alert()` 与 `innerHTML` 拼装不再使用。
6. Job 结果随记录留存（`JobRecord.result`），使「刷新页面后仍能看到刚才那次运行的结果」成立。

## 理由

- **Vue 单文件组件 + `<script setup>`** 让「面板 = 视图 + 状态 + 动作」三者同处一文件，正好对应 8 个面板的边界；相比 vanilla JS，新增面板是新增文件而不是继续加长一个文件。
- **TypeScript 是这套系统的主要收益**：领域结构（`ChangeState`、`AcceptanceVerdict`、`ImplementationScopeReport`）在客户端有声明后，后端字段改名会在 `pnpm web:typecheck` 阶段暴露，而不是在用户点按钮时。
- **不做独立 workspace**：本仓库根已经有 pnpm workspace 文件（历史遗留、内容为空）；再引入第二个 lockfile 会让「装依赖」这件事分裂成两条路径，而两者都只是同一台机器的本地工具链。放在根 devDependencies 里，`pnpm install && pnpm build` 即可得到可运行的 serve + UI。
- **保留 hash 路由**：serve 是纯静态托管，hash 路由不需要任何 rewrite 规则，刷新任意面板都不会 404。
- **保留既有视觉**：迁移只换实现，不换外观，避免把一次架构调整变成一次全量重设计。

## 后果

正面：

- 面板的状态与动作有明确归属，P0 类缺陷（结论被冲掉、日志丢失、保存丢字段）在结构上不再容易复现。
- `pnpm web:typecheck` 把前后端契约纳入 CI 可检查范围。
- `web/dist` 进入 npm `files`，全局安装后 `cometflow serve` 自带 UI，不再需要 `--web-dir` 指到仓库。

代价与约束：

- 首次构建需要 Vite/esbuild；`pnpm-workspace.yaml` 的 `allowBuilds` 必须允许 `esbuild` 的安装脚本，否则 `pnpm install` 以非零码退出。
- `web/dist` 是构建产物，仍被 `.gitignore` 忽略，只在发布时进入 npm 包。
- 迁移期删除了 `web/app.js`；旧客户端的等价能力已全部在新实现中（本 ADR 不保留兼容层）。
- 前端框架与后端 Node 版本解耦：serve 依旧是零前端依赖的静态服务器。

## 备选方案

- **继续 vanilla JS**：改动最小，但 W2–W5 的面板复杂度会让单文件膨胀到数千行，且无法获得类型检查。
- **React + Vite**：能力等价；选 Vue 是因为设计文档 008 §10 已把 Vue 列为首选，且单文件组件的心智负担更接近现有「一个面板一段渲染函数」的结构。
- **独立 `web/` workspace + 独立 lockfile**：隔离更彻底，但会在同一仓库里制造两条安装路径与两份依赖版本，收益不抵成本。
