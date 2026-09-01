# 001 CometFlow 项目概览

## 状态

- 状态：已批准
- 版本：0.1-draft
- 日期：2026-09-01

## 定位

CometFlow 是一个 **全时运行的自主 Agent 开发平台**。

它把空闲或持续可用的算力，转化为规范、可恢复、可评估、可持续进化的 Agent 开发工作流。

## 来源

CometFlow 由两个项目融合而来：

| 来源 | 贡献 |
|---|---|
| Nightshift | 持续调度、无人值守、利用空闲算力、任务状态推导、门禁式自进化 |
| Comet | 可恢复工作流、Skill 生态、Bundle 分发、科学评估、Hook Guard、Dashboard |

## 融合原则

1. **全时优先，但保留闲时能力**  
   调度策略支持 `always`、`idle`、`schedule`、`manual`，未来可扩展 `event`。

2. **人类负责规范与批准，Agent 负责执行**  
   人类只写项目级 spec 和任务目标；Agent 负责拆解、实现、验证、归档。

3. **Spec 是契约，不是文档**  
   spec 必须能派生 acceptance，并且与任务、代码、测试、验证建立可追踪关系。

4. **状态可恢复、可审计、单一权威**  
   Scheduler 管任务队列和调度；Workflow 管单任务验收状态。

5. **生成与评价分离**  
   保留 Comet 的 Builder / Verifier 分离，不信任 Agent 自报完成。

6. **进化必须过门禁**  
   Nightshift 四道门禁保留，Comet Eval 作为可选科学门禁。

7. **跨平台可分发**  
   核心使用 Node ≥ 22 + TypeScript；AgentRunner 可插拔；Skill/Bundle 可分发。

## 目标架构

```text
┌──────────────────────────────────────────────┐
│                  cometflow CLI                │
└──────────────────────────────────────────────┘
                     │
┌──────────────────────────────────────────────┐
│              Application Layer                │
└──────────────────────────────────────────────┘
                     │
┌──────────────────────────────────────────────┐
│                Domain Layer                   │
│ scheduler / workflow / engine / skills        │
│ evolution / eval / dashboard / spec-kernel    │
└──────────────────────────────────────────────┘
                     │
┌──────────────────────────────────────────────┐
│               Platform Layer                  │
│ agents / fs / git / process / paths / state   │
└──────────────────────────────────────────────┘
                     │
┌──────────────────────────────────────────────┐
│            External Agent Runtimes            │
│ opencode / claude-code / codex / ...          │
└──────────────────────────────────────────────┘
```

## 组件映射

| Nightshift / Comet 组件 | CometFlow 组件 |
|---|---|
| nightly.sh / nightshift-daemon | domains/scheduler |
| nightshift CLI / comet CLI | app/cli |
| agents/*.sh | platform/agents |
| prompts/main-session.md | assets/prompts/flow-session.md |
| NIGHTSHIFT.md | COMETFLOW.md |
| .nightshift/config + .comet/config.yaml | .cometflow/config.yaml |
| EVOLUTION.md + evolve.sh | domains/evolution |
| comet eval | eval/ + domains/eval |
| comet dashboard | domains/dashboard |

## 状态模型摘要

| 层 | 文件 | 拥有者 |
|---|---|---|
| 项目使命与目标 | COMETFLOW.md | 人类 |
| 项目级 spec | specs/ | 人类 |
| 项目配置 | .cometflow/config.yaml | 人类/CLI |
| Goal 投影 | .cometflow/goals/*.yaml | 机器生成 |
| Task Plan | .cometflow/plans/*.task-plan.yaml | 拆解产物，审核后冻结 |
| 调度状态 | .cometflow/runtime/daemon-state.json | Scheduler |
| 工作流状态 | changes/<name>/comet-state.yaml | Workflow Runtime |
| 本机执行状态 | .cometflow/runtime/changes/<name>/state.json | Workflow Runtime |
| 报告 | reports/*.md | 生成物 |

## 相关文档

- Spec 内核：002-spec-driven-kernel.md
- 任务规划：003-task-planning.md
- spec 变更影响：004-spec-change-impact.md
- CLI 与流程：005-cli-and-workflow.md
- 路线图：006-roadmap.md
