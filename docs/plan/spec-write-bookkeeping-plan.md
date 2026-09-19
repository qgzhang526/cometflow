# spec 写入之后的记账：导入即建基线、版本页签自带「建立基线」

状态：**已完成**（2026-09-18）
来源：2026-09-18 复核「已打开项目里怎么再加一个 capability 的 spec」时，顺着产出路径核对发现的两处断头
关联：[spec-authoring-plan.md](./spec-authoring-plan.md)（草案 / 批准）、
[project-adopt-plan.md](./project-adopt-plan.md) §6（磁盘事实校正，本批复用它）、
design [011-spec-versioning](../design/011-spec-versioning.md)（版本与 lock）

## 1. 两处断头

1. **表格导入不记账**。`spec import`（CLI 与 Web 导入页签）写盘后既不登记版本也不刷新
   `.cometflow/spec-lock.json`，而 Web 导入页签的文案早写着「导入后 spec 已落盘并登记版本」——
   文档承诺了、代码没做。后果是导入完 `spec verify` 立刻报 `stale-spec-lock`，
   新导入的 `specs/<cap>/spec.md` 在版本页签里根本不存在。
   同一份导入还漏了 12-kind 校正：导入出来的 capability 不在技术栈推断里，
   `init-manifest` 的 `capability` 行仍停在 `absent`（与 §6 修过的脚手架是同一个缺陷）。
2. **「建立基线」只有一处入口**。`spec lock` 的按钮只在「影响与门禁」页签，
   而**发现某份 spec 没有版本**的地方是「版本」页签——那一页的提示写着「先运行一次『建立基线』」，
   却没有那个按钮，用户得先知道去别的页签找。

两处都是「写入路径的记账」问题：canonical spec 变了，但派生状态（版本、基线、kind 判定）没跟上。

## 2. 修法

| 层 | 改动 |
|---|---|
| 领域（`domains/spec/spec-import.ts`） | `writeImportedSpecs()` 写盘后：`refreshSpecBaseline({ note: 'spec import' })` → `reconcileInitManifest()` → 再 `validateSpecs()`（校验结果要反映校正后的最终状态）。导入与 CLI、docx 三条入口共用这一个收尾 |
| 返回与回显 | `SpecImportResult` 增加 `manifestChanged`；CLI `spec import` 打印 `spec lock: 已登记版本并刷新 …` 与 `init-manifest updated: <kind> → present`；Web 导入结果表加一行「12-kind 校正」，说明文案改成「落盘、登记版本并刷新基线，产物是草案、要审核后批准定稿」 |
| 界面（`VersionsTab.vue`） | 加「建立基线（spec lock）」按钮（与「影响与门禁」同一个端点），并把这一页的说明补成「建立基线 = 承认当前 specs/ 为新基线，旧版仍在版本仓可回放」。不弹二次确认：它不改写任何正文，比同页的「恢复」轻 |

有意不做的取舍：**导入不自动 approve**。导入物一律 `status: draft`，`plan freeze` 依旧会拒；
建基线只是让 diff / impact / CAS 基线有正确的起点，不等于承认契约。人工审核 → `spec approve`
那一步是 G1 定下的把关点，本批不绕过。

## 3. 验证

| 项 | 结果 |
|---|---|
| `spec-import.test.ts` | 新增 1 例：导入后 `specs/order/spec.md` 有 v1（note = `spec import`）、`spec-lock.json` 收录两份新 spec、`verifySpecIntegrity` 不再报 `missing-spec-lock`、`init-manifest.capability` 变 present |
| `serve-gates-api.test.ts` | 「确认导入」用例追加断言：`spec-lock.json` 含新 spec、响应带 `manifestChanged: [capability]` |
| `scripts/regression.mjs` | 新增 4 步（放在最后跑，避免新 capability 干扰前面以基线为准的断言）：导入探针 → 落盘 → 回显 `spec lock: 已登记版本并刷新` → `spec-lock` 收录新 spec，总计 **157 步 PASS** |
| 全量 | `npx vitest run` 102 文件 / 591 例全绿；`tsc` / `vue-tsc` / `vite build` 通过 |

## 4. 明确不做

- 不给「版本」页签加 `spec diff` / 影响分析（那是「影响与门禁」的活），它只补一个建立基线的按钮；
- 不让导入自动 approve 草案（见 §2 的取舍）；
- 不改 `spec scaffold` 的记账：脚手架骨架还没内容，等人工写完保存（`POST /specs`）或批准时才登记版本——
  中间那段「骨架已落盘但没版本」是符合预期的，问题清单会指到「影响与门禁」或「版本」。
