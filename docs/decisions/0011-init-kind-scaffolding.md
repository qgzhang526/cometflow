# 0011 Init 按项目类型裁剪生成 spec kind

状态：已批准  
日期：2026-09-07  
关联：[010-init-scaffolding.md](../design/010-init-scaffolding.md)、[009-spec-artifact-taxonomy.md](../design/009-spec-artifact-taxonomy.md)、[ADR 0010](./0010-spec-artifact-kind-model.md)

## 背景

009 引入 12 个 spec kind；当前 `init` 只生成 `COMETFLOW.md` 与空 `specs/`，不生成任何 kind 文件。需要明确：人类起步时不是 12 个都手写，而是按项目类型裁剪，只生成真正需要的 kind。

## 决策

1. `init` 按「项目类型」裁剪生成 spec kind：第一层从 `COMETFLOW.md` 的 `## 技术栈` 推断（前端≠无 → pages；数据库≠无 → models；有后端 → constraints），第二层由 `--interactive` 的 7 个问题补齐（protocol/config/flow/process/rules/permissions/errors）。
2. 非交互 `init` 使用保守默认：只生成 project +（有 DB 的）models +（有后端的）constraints，其余标 `deferred`。
3. 生成结论写入 `.cometflow/init-manifest.yaml`（机器投影），记录每个 kind 的 `present/deferred/absent` 与原因。
4. `spec validate` / `doctor` 读 manifest：`present:false` 缺席不报错，`present:true` 缺失报错。
5. 新增 `cometflow spec scaffold` 增量补 kind，幂等、存在即跳过、不覆盖人类修改。
6. `capability` kind 不由 init 生成，由 `plan generate` 的 spec-authoring 任务或 `spec scaffold` 产生。

## 理由

- 把「要不要写某个 spec」的判断从人类转移到机器可复现的规则，降低起步负担与遗漏。
- 「不需要」也留痕，避免 `spec validate` 把有意缺席误判为遗漏。
- 与 009 的事实所有权模型一致：init 只生成骨架，语义仍由人类（或批准后的 [DRAFT]）填充。

## 后果

正面：

- 起步最小化，spec 集合随项目类型伸缩。
- spec validate 的「缺席」语义从二值（有/无）变为三值（present/deferred/absent）。

负面：

- 新增 manifest 投影与交互问卷，实现面扩大。
- 非交互默认偏保守，可能让部分项目起步后再补（由 scaffold 承担）。
