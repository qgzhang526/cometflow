# 能力地图：CLI 能力 ↔ HTTP 端点 ↔ 界面面板，以及「你怎么自己验证它对不对」

状态：**已产出**（2026-09-16，随可见性收口批次一起）
用途：打结阶段的对照表。回答两个问题——**这个功能在哪儿**（CLI / 端点 / 面板），
以及**我怎么确认它对**（每一步都有可执行的自验入口）。
口径基线：`app/cli/index.ts` **86 条叶子命令**（96 处 `.command(` 注册 − 13 个命令组；其中
`daemon pause|resume|stop` 由循环注册）；
`domains/server/api.ts` **92 处方法判定** + `serve.ts` 的 `/api/events`；
界面 **10 个面板 + 任务中心**（Specs 8 页签、Changes 4 页签、Assets 3 页签）。

## 1. 主链路：每一步在哪儿，怎么验

表格里的「自验」一列都是可直接粘贴执行的命令，判定标准写在括号里。

| 步骤 | CLI | HTTP 端点 | 面板 | 自验 |
|---|---|---|---|---|
| 建项目 / 接入已有项目 | `init`、`project migrate` | `POST /projects`、`POST /projects/import` | 首页（新建向导 / 打开已有项目） | 建完跑 `cometflow spec validate .`（OK） |
| 使命与目标 | `context sync`、`goal sync` | `POST /context/sync`、`POST /goals/sync`、`GET/PUT /config` | 目标（含就地编辑/删除） | 改 `COMETFLOW.md` 后 `goal sync`，看 `.cometflow/goals/*.yaml` 是否同步 |
| 契约（specs/） | `spec validate｜lock｜index｜diff｜drift｜graph｜anchors｜checks｜verify｜versions｜show｜restore｜scaffold｜import｜approve` | `GET /specs`、`POST /specs`、`POST /spec/scaffold`、`POST /spec/approve`、`GET /spec/checks｜verify｜diff｜drift｜impact｜versions｜graph｜anchors`、`POST /spec/import｜lock｜restore｜proposal` | 规格（12-kind / 脚手架 / Spec 文件 / 验收覆盖 / 版本 / 引用图 / 影响与门禁 / 导入） | `cometflow spec verify .`（退出码 0；草案会给 `spec-is-draft` 警告但不算失败） |
| 拆解与冻结 | `plan generate｜validate｜review｜approve｜freeze｜regenerate｜trace` | `POST /plans/generate`、`POST /plans/regenerate`、`POST /plans/<goal>/{validate,review,approve,freeze}`、`GET /plans/<goal>/trace` | 计划 | `plan generate G1 .` → `plan validate G1 .`（OK）；`plan_review: auto` 时 generate 后计划应直达 approved |
| 执行一个任务 | `change new｜transition｜run｜verify｜archive｜resume｜list｜status｜select｜gc｜rebase｜unblock｜scope｜journal` | `POST /changes/...`（new/transition/run/verify/archive/rebase/select）、`GET /changes/.../{scope,journal,rollback}` | 变更（概览 / 范围 / 流水 / 证据） | `change run <name> . --agent mock` → 任务中心看到 `change-run` job；`change verify <name> .`（未通过时列出 acceptance 结论） |
| 起草 spec（无 spec 时的分支） | 同 `change` 全链路 | 同 `change` | 变更 + 规格（Spec 文件页签批准定稿） | `plan generate G9 .` 产出 `kind: spec-authoring` 任务 → `change verify` 在产物缺失/不合格时报错指路；产物带 `status: draft`，`spec approve` 后才能被冻结绑定 |
| 无人值守（P4 交付通道） | `daemon start｜budget｜pause｜resume｜stop｜queue rebuild｜reset｜retry` | `GET /scheduler/queue`（`tasks`/`derived`/`queue`/`budget`/`daemon`/`control`）、`POST /scheduler/queue/rebuild\|reset\|retry`、`POST /scheduler/daemon/control` | 调度 | `daemon start . --mode always --agent mock` → 队列任务被推进成 change 并归档（`changes/G1-T1/comet-state.yaml` 里 `archived: true`）；面板同时显示调度状态与交付状态（change/phase）；`daemon stop` 写控制文件，下一轮退出并记 `stopped-by-control`；停机后 `daemon queue retry G1:T1` 只重排那一条 |
| 评估 | `eval` | `POST /eval/run` | 评估（含历史对比轮） | `cometflow eval .`（PASS/FAIL + Pass@k）；面板「运行评估」后日志进任务中心 |
| 进化 | `evolve propose｜verify｜submit｜approve｜reject｜status｜review-list｜rollback` | `POST /evolutions/...`、`GET /evolutions`、`GET /evolutions/<name>/rollback` | 进化 | `evolve propose x` → `evolve verify x --eval` → `submit`；面板「回滚指引」给出 `git revert` 路径 |
| 门禁与问题清单 | `gate check｜install｜status｜uninstall`、`hook check｜install｜status｜uninstall`、`doctor`、`metrics` | `GET /findings`、`GET /metrics`、`GET /gates`、`POST /gate/install`、`GET/POST /hook/...`、`GET /project/doctor` | 总览（问题清单 / 门禁 / 质量与健康度 / 维护动作）、资产（Hook 预览） | `cometflow gate check . --findings` 与总览「问题清单」逐条同源；`doctor .` 的三个维护动作在总览「维护动作」卡里是同一套护栏 |
| 任务中心（跨面板） | `jobs`（HTTP 侧） | `GET/DELETE /jobs`、`GET /jobs/<id>` | 任务中心抽屉（含 `flow-run` / `change-run` / `eval-run` / `plan-*` / `evolve-verify`） | 任意长任务后刷新页面，任务与结果仍在（`.cometflow/runtime/jobs/`） |
| 一次性试跑 | `run --agent <id>` | `POST /run` | 设置（一次性试跑） | 跑一次 `mock`：任务中心出现 `kind=flow-run`，日志含「不绑 change」 |
| 资产分发 | `skill add｜import｜list｜show`、`bundle create｜compile｜distribute` | `GET /skills`、`GET /skills/<name>`、`GET /bundles`、`POST /bundles/distribute` | 资产（Skills / Bundle / Hook 预览） | 面板「分发到 claude-code」先给预告（目标路径 + 是否覆盖），确认后 `.claude/skills/<name>` 落盘 |

## 2. 面板 → 端点对照（谁在读什么）

| 面板 | 主要端点 | 写动作（都带二次确认或预告） |
|---|---|---|
| 总览 Overview | `/project/status`、`/findings`、`/metrics`、`/gates`、`/project/doctor` | 维护动作三件套（clean-temp / clean-jobs / force-unlock，预告数字不符则 409 且不删） |
| 目标 Goals | `/goals`、`/config`、`/context/sync` | 目标块就地编辑/删除 → 写回 `COMETFLOW.md` + `goal sync` |
| 规格 Specs | `/specs`、`/spec-index`、`/spec/checks｜verify｜diff｜drift｜impact｜versions｜graph｜anchors｜proposals` | `POST /specs`（保存即版本）、`/spec/proposal`、`/spec/import`、`/spec/lock`、`/spec/restore`、`/spec/scaffold`、`/spec/approve` |
| 计划 Plans | `/plans`、`/plans/<goal>`、`/plans/<goal>/trace` | `generate` / `regenerate` / `review` / `approve` / `freeze`（策略由 `plan_review` 决定自动推进到哪一步） |
| 变更 Changes | `/changes`、`/changes/<name>/{scope,journal}`、`/changes/<name>/rollback` | `new` / `transition` / `run` / `verify` / `archive` / `rebase` / `select`（指针可写，决定写入门禁归属） |
| 进化 Evolve | `/evolutions`、`/evolutions/<name>/rollback` | `propose` / `verify` / `submit` / `approve` / `reject` |
| 评估 Eval | `/jobs`（`kind=eval-run` 的历史与结果） | `POST /eval/run` |
| 调度 Scheduler | `/scheduler/queue`（queue / derived / next / budget / **daemon**） | 无写入（只读立场不变：不启停 daemon、不改队列状态） |
| 资产 Assets | `/skills`、`/skills/<name>`、`/bundles`、`/hook/status` | `POST /bundles/distribute`（预告 → 确认 → 执行） |
| 设置 Settings | `/config`、`/config/project`、`/agents`、`/project/concurrency` | 写项目层配置（增量合并）、并发策略切换/延长、`POST /run`（一次性试跑） |

## 3. 没进界面的能力去哪了（不是遗漏）

按审计 §5.1/§5.2 的分类维持不变，这里只登记结论：

- **安装/运维/长驻进程类（14 条）**：`update` / `uninstall` / `init --interactive` / 守护脚本安装、
  skill 安装、hook 安装卸载等——需要源目录选择、风险扫描或长期进程，留在 CLI；
- **按决策退出界面（4 条）**：Classic 工作流 3 条（弃用）+ `spec index` 1 条（保留给脚本的投影）；
- **保留给 CLI/脚本的对外投影**：`GET /config/project`、`GET /spec-index`（V4-5 决策：标注保留，不删）。

## 4. 验证链（打结基线）

以下命令在收口时全部跑过，结果如下——下次做改动时，这就是回归基线：

| 命令 | 覆盖 | 本次结果 |
|---|---|---|
| `npx vitest run` | 领域 / 平台 / serve 端点（含起真服务器） | **86 文件 / 511 例全绿** |
| `node scripts/regression.mjs` | 端到端 CLI + 真实夹具（含 git hook、写保护、门禁、daemon 交付） | **145 步 PASS** |
| `pnpm typecheck` | 平台侧 `tsc --noEmit` | 通过 |
| `pnpm web:typecheck` | 前端 `vue-tsc --noEmit` | 通过 |
| `pnpm build` | `tsc` + `vite build`（产出 `dist/` 与 `web/dist/`） | 通过 |
| `pnpm package-e2e` | 打包产物自检 + 全量测试复跑 | **PASS**（`dist/app/cli/index.js`、`web/dist/index.html` 体检通过） |
| 浏览器走查 | 10 个面板 + 新增卡片（home hero、最近项目整卡可点、调度器决策卡、bundle 分发按钮、试跑卡片） | 控制台无 error/warning；`relativeTime`、定稿状态、策略文案均按预期渲染 |

维护规则：这张表是**当次实测**，不是永久承诺。改动主链路后请重跑并在本文件更新结果，
同时同步 [web-ui-coverage-audit.md](./web-ui-coverage-audit.md) §1 的数字。
