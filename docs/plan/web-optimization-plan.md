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
