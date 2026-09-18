# spec anchor 口径修正：只有 capability 的契约标题是 anchor

状态：**已完成**（2026-09-18）
关联：design [011-spec-versioning](../design/011-spec-versioning.md)（Anchor 身份）、
[009-spec-artifact-taxonomy](../design/009-spec-artifact-taxonomy.md)（flow 三段式）、
`domains/metrics/spec-health.ts`（`anchor_coverage_rate` 口径）

## 1. 现象（用户报的）

「规格 → 验收覆盖」页签底部那张表（标题是「全部锚点」）里出现大量**结构标题**被当成锚点，例如
`specs/flows/session-refresh.md` 的 `前置条件 / 步骤 / 后置条件`，以及 `constraints.md` 的六条约束、
`models.md` 的实体清单……CLI `spec anchors` 在同一个项目上 22 行里只有 6 行是真正的契约锚点。

## 2. 为什么是 bug（两条既有规则被违反）

1. **design 011 的 Anchor 身份**：可绑定 anchor 是**契约标题**（`## POST /api/auth/email-login`）；
   `## Acceptance` 是容器，不是锚点。flow 的 `## 前置条件 / ## 步骤 / ## 后置条件` 与 `## Acceptance`
   同类——`spec validate` 甚至**强制要求**这三段存在（`missing-flow-sections`），
   flow 真正的可绑定单位是步骤 `### 步骤N …`。
2. **指标层的既有口径**：`domains/metrics/spec-health.ts` 一直写着
   「只有 capability 参与 anchor 覆盖率：其它 kind 的标题不是任务绑定单位」。
   也就是说 `anchor_coverage_rate` 早就排除了这些标题，只有「验收覆盖」这张表和 `spec anchors`
   的投影把它们当成锚点——**同一个概念两套口径**，界面于是显示出一堆永远"未绑定"的假缺口
   （表自己的说明是"未绑定 = 写了契约但没人实现"）。

## 3. 修法

| 层 | 改动 |
|---|---|
| 解析（`domains/spec/spec-parse.ts`） | flow 文档的 anchor 层级直接取三级标题：三段式骨架（二级）不再产出锚点，步骤成为流程的可绑定单位 |
| 投影（`domains/spec/spec-anchors.ts`） | 只列 **capability** 的锚点（与 `anchor_coverage_rate` 同口径）；`spec anchors` CLI、`GET /spec/anchors`、面板共用它 |
| 界面（`ChecksTab.vue`） | 标题改为「可绑定锚点（capability 的契约标题）」，并说明其它 kind 的标题为什么不列 |
| 文档 | design 011 的 Anchor 身份补三条规则；USAGE §5.2 增加「哪些标题不是 anchor」 |

## 4. 验证

| 项 | 结果 |
|---|---|
| `spec-parse.test.ts` | 新增「flow 只把步骤当锚点，三段式骨架不算」：`['步骤1 读取会话', '步骤2 判断是否需要重新登录']` |
| `serve-gates-api.test.ts` | V3 锚点平铺用例追加断言：每条 `kind === 'capability'`、没有 `specs/flows/` 行 |
| 真实项目（`cometflow-ui-demo`） | `spec anchors` 从 **22 行 → 5 行**（全部 capability；3 条被冻结任务绑定、2 条未绑定），`前置条件 / 步骤 / 后置条件`、constraints 六条、models 实体等噪音全部消失 |
| 全量 | `npx vitest run` 99 文件 / 572 例；回归 152 步 PASS；`tsc` / `web:typecheck` / `build` / `package-e2e` 全通过 |

## 5. 边界（做了什么、没做什么）

- **没做**：给非 capability 文档（models 的实体、rules 的规则）提供"可绑定"能力——那是新特性
  （要扩 `task-plan generate` 的绑定口径 + 覆盖率定义），不在本次修正范围；
- **没做**：把 flow 的步骤做成可绑定锚点（解析层已经能识别，但绑定与覆盖率仍只认 capability）。
  将来若要"按步骤派任务"，应连同 `plan generate` 与覆盖率口径一起改，并另开 ADR；
- **保持不变**：`spec_anchor` 的绑定对象、`plan freeze` 的 `anchor_hash`、`spec-verify` 的漂移判定都不受影响
  （它们本来就只针对 capability 契约）。
