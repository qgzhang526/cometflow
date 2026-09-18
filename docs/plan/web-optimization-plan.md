# 前端优化：实时性 / 可读性 / 拆分

状态：**已完成**（2026-09-18）
来源：并发与顺序两批做完之后的前端体检（`docs/plan/capability-map.md` 是能力对照基线）

## 1. 三件事与证据

| # | 问题 | 证据 | 处理 |
|---|---|---|---|
| 1 | 调度面板**不会自动更新** | `areaForPath()` 没有 `/api/scheduler` 分支（服务端明明在广播 `state.changed('/api/scheduler/queue')`），`RefreshArea` 里也没有 `scheduler`/`assets`，`SchedulerPanel` 是唯一没订阅刷新的核心面板 | 抽出 `api/refresh-areas.ts`（纯函数 + 单测）并补全映射；调度面板订阅 `scheduler` 区域；**再按租约做轮询**（见下） |
| 2 | 状态词是**机器词**，「为什么没领它」看不见 | 面板直接渲染 `waiting-on-active-change` / `needs-human:verify-failed`；C5 的 module 冲突跳过只写在 stdout 里 | `utils/scheduler-labels.ts` 翻译（认不得的原样显示）；daemon 状态投影新增 `last_skips`（谁挡住了谁、module 是什么），面板逐条列出 |
| 3 | 两个大面板**该拆** | `ChangesPanel.vue` 26KB、`SchedulerPanel.vue` 17KB；加载/错误/空态各写一遍 | `composables/panel-loader.ts`（单飞 + 失败保留旧值，纯逻辑可测）+ `usePanelData`；调度面板拆出「决策卡」「顺序卡」，变更面板拆出「列表卡」 |

## 2. 两个判断（为什么这样做）

**「在不在跑」用租约，不用状态投影的时间戳。** 投影只在决策点写，一个任务能跑几十分钟；
拿 `updated_at` 当心跳会把"正在跑"误判成"停了"。租约（ADR 0027）每 10s 心跳、60s 过期，
正好是这个粒度——所以 `GET /scheduler/queue` 多返回一个 `lease` 字段（owner / mode / fresh），
面板据此显示「调度器在跑 / 没有调度器在跑」并决定轮询。

**轮询不能"停了就停"。** 第一版写的是"租约活着才轮询"，实测发现一个洞：面板打开时没有调度器，
用户在终端 `daemon start`，面板永远看不到它（没有 SSE，也没有轮询）。改成**常驻轮询**：
活着 4s 一次、闲着 20s 探一次；页面上的动作仍走 SSE 即时刷新。

## 3. 落点

| 文件 | 作用 |
|---|---|
| `web/src/api/refresh-areas.ts` | SSE path → 面板区域的**唯一映射**（`scheduler` / `assets` / `eval` 补齐；其余回落总览） |
| `web/src/composables/panel-loader.ts` | 单飞 + 失败保留旧值（纯逻辑，单测覆盖） |
| `web/src/composables/usePanelData.ts` | 加载 + 失败 toast + 订阅区域刷新，面板一行接入 |
| `web/src/utils/scheduler-labels.ts` | 停止原因 / 决策原因 / 交付结论的措辞与语义色（含 `needs-human:<verdict>` 拆解） |
| `domains/scheduler/daemon-state.ts` | 新增 `last_skips`（task / reason / holder / module / occupier_module） |
| `domains/scheduler/daemon.ts` | 领取被跳过时把原因写进投影；有槽在跑时也写一次 `skipping` 投影 |
| `domains/server/api.ts` | `GET /scheduler/queue` 增加 `lease`（活证据） |
| `web/src/views/panels/scheduler/*.vue` | 决策卡（含 skip 列表）、顺序卡 |
| `web/src/views/panels/changes/ChangeListCard.vue` | 变更列表卡（`defineModel` 接新建表单，emit 接动作） |

## 4. 验证

```
npx vitest run          → 98 文件 / 564 例（新增 web 侧 3 个纯逻辑用例文件：refresh-areas / scheduler-labels / panel-loader）
node scripts/regression.mjs → 152 步 PASS
tsc / pnpm web:typecheck / pnpm build / pnpm package-e2e → 全通过
```

浏览器走查（真实 serve + 合成项目，`?token=` 直接开）：

| 检查 | 结果 |
|---|---|
| 决策卡渲染租约与状态词 | 「调度器在跑」+「当前租约：活着 · 12345@demo-host」；`waiting-on-active-change` 显示为「在等在飞 change 让出 module」 |
| skip 列表 | 「G3:T1：module 与在飞 change human-core 冲突（src/report vs src/report）」「G1:T1：并发单元已被 G3:T1 占用」 |
| **自动刷新（轮询）** | 外部改写 `daemon-state.json`（轮次 7→9、换成 `needs-human:verify-failed`）后**不点任何按钮**，8s 内面板自动变成「轮次 9 · 需人工介入：验收未通过 · 验收未通过」 |
| **自动刷新（SSE）** | 外部 `POST /scheduler/queue/rebuild` 后，面板自动从"空队列提示"切到带「更新时间」列的真实队列 |
| 变更面板拆分后可用 | 列表卡渲染（指针 / 新建工具栏 / 表 + 打开 + 设为当前）；点「打开」加载详情卡；goal 下拉切到 G1 后任务下拉自动出现 `T1`；输入框 v-model 双向生效；控制台无 error/warning |

## 5. 明确不做

- 不把全体面板的 `toasts.error` 统一改造（85 处，收益低、面大）：只把**加载这一类**收进
  `usePanelData`，其余按需替换；
- 不做前端状态管理重构（Pinia store 边界不动）；
- `ChangesPanel` 只拆出列表卡：详情卡与四个页签的耦合（selected / pointer / resume / verify / archive）
  还没降到值得拆的程度，硬拆只会变成一堆 props 透传。

## 6. 后续补丁：问题清单的「去处理」要落到能处理它的那一页（2026-09-18）

用户报的具体缺陷：`cometflow-ui-demo` 的总览里有一条 error `stale-spec-lock`
（「spec 与 spec-lock 不一致」），点「去处理」只切到「规格」面板的**默认页签**（12-kind 状态）——
那里既看不到差异、也没有「建立基线」按钮，手动找到「影响与门禁」之后也不知道该点哪个。

根因是旧映射只产出一个 `PanelId`：`if (finding.source === 'spec-verify') return 'specs'`。
现在映射到 `(panel, tab, subject)`：

| code | 落点 | 落地后能看到什么 |
|---|---|---|
| `stale-spec-lock` / `missing-spec-lock` | 规格 · 影响与门禁 | 「建立基线（spec lock）」按钮 + 差异表里那份 spec 排最前并标「问题清单指向」+ 意图横幅说明两条出路 |
| `missing-spec-version` / `missing-version-blob` | 规格 · 版本 | 复用版本页签的过滤，只看那一份 |
| `anchor-drift` / `acceptance-drift` / `duplicate-anchor` / `spec-is-draft` | 规格 · Spec 文件 | 列表把那一份排最前并标记（草稿行上就有「批准定稿」） |
| `change-*` / `multiple-active-changes` / `pending-change-transition` | 变更 | rebase / 选当前 change / 收尾 |
| `hook-*` | 资产 · Hook 预览 | 写保护状态与安装动作 |
| 并发写策略三条 | 设置 | 策略与到期日 |
| `no-plans` / `plan-integrity` | 计划 | 拆解 / 重新冻结 |
| `invalid-specs` | 规格 · 影响与门禁 | 「跨文件引用校验」的逐条结论 |
| 临时文件 / 证据占用 | 不给按钮 | 这些总览自己就能处理，点了也是原地 |

实现：`utils/finding-targets.ts`（纯映射 + 单测）、`stores/navigation.ts`（跨面板的意图传递，
因为面板是 `<component :is>` 动态挂的、切换靠路由）、`SpecsPanel` 消费意图并渲染横幅、
`IntegrityTab` / `FilesTab` 按 `subject` 聚焦。顺带把 `PANELS` 从 `router.ts` 挪到 `panels.ts`：
路由要 `createWebHashHistory()`（依赖 `location`），而面板标签是纯数据、必须能在 node 里单测。

验证（真实 serve + 合成项目：`spec lock` 之后手改一行 spec 制造不一致）：点 error 行的「去处理」→
落在「规格 · 影响与门禁」，横幅写明对象与两条出路，差异表第一行是 `specs/core/spec.md` 且带
「问题清单指向」；点「建立基线（spec lock）」后 `spec verify` 变 0 finding、差异变「与基线一致」，
再点同一行的「去处理」时引导文案切换成"已对齐"分支；`multiple-active-changes` 那条落到「变更」。

## 7. 后续补丁二：多活跃 change 的「怎么办」（2026-09-18）

同一类问题的另一条 finding：`multiple-active-changes`（「4 active changes；未指定 current-change，
hook 会拒绝归属不明的写入，运行 `cometflow change select <name>`」）。落到「变更」之后依然不知道
**该选哪个、这些遗留 change 怎么办**。

- 落地横幅改成**通用组件**（`components/ArrivalBanner.vue`，挂在 `ProjectView` 上）：
  之前横幅写在 `SpecsPanel` 内部、且只在面板 `consume` 时设置，于是"去变更"这类不需要页签逻辑的落点
  没有落地说明。现在点击那一刻就挂上，离开目标面板时自动收掉。
- 「变更」面板新增**「当前 change（写保护路由）」卡**（`changes/CurrentChangeCard.vue`）：
  活跃 change 列成一排「设为当前 `<name>` · `<phase>`」按钮，写清后果（没指针 → agent 写入被拒；
  设好 → 那条 finding 从 warning 降级为 info；不跑 agent 可以先不管）。
- `multiple-active-changes` 的引导语不再是笼统的"去变更"，而是"选一个设为当前"。

验证（合成项目 4 个活跃 change、无指针）：点「去处理」→ 落在「变更」，横幅与卡片都在；
点「设为当前 shape-change」→ `.cometflow/current-change.json` 写入 `shape-change`、卡片徽章变「已设置」，
回总览后该 finding 从 warning 变 **info**、顶部徽章变 `0 error / 0 warning`。

**登记一个缺口**：产品目前**没有「废弃 change」入口**——遗留的半成品 change 只能走完流程归档
（空的 change 归档不应用 spec 变更，但 build 阶段会真的跑一次 agent），或人工删 `changes/<name>/`。
这属于 `change` 生命周期该补的一条命令（`change abandon`？），本轮只做引导，不在界面上放删除按钮。
