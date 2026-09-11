# CometFlow

> 全时运行的自主 Agent 开发平台。

CometFlow 融合 Nightshift 的持续调度/无人值守能力与 Comet 的可恢复工作流、Skill 生态、科学评估能力。

当前阶段：**MVP 已覆盖 Phase 1–6 核心能力，进入持续完善**。

## 已实现能力

```text
cometflow init [path] [--interactive]
cometflow context sync [path]
cometflow goal sync [path]
cometflow spec validate|anchors|lock|diff|drift|scaffold|index [path]
cometflow plan generate|validate|review|approve|freeze|regenerate|trace <goal> [path] [--preserve-approved]
cometflow change new|list|status|resume|transition|run|verify|archive <...>
cometflow classic new|status|transition <...> [--profile full|hotfix|tweak]
cometflow run [path] --agent opencode|claude-code|mock
cometflow daemon start [path] --mode always|idle|schedule|manual [--start HH:MM --end HH:MM] [--safety-bundle]
cometflow evolve propose|verify(--eval)|submit|status|approve|reject|review-list|rollback <name> [path]
cometflow eval [path]   # .cometflow/eval.yaml（sampling/断言/rubric，Pass@k/Pass^k）
cometflow skill add|show|list|import <...>
cometflow bundle create|compile|distribute <...>
cometflow hook check <target> [path] --event write|edit
cometflow status [path]
cometflow dashboard [path] --port <port>
cometflow serve [--workspace <dir>] [--port <port>] [--token <token>] [--web-dir <dir>]
cometflow doctor [path] [--json]
cometflow project migrate [path]
cometflow update
cometflow uninstall [path] --force
cometflow agent list|check <agent>
```

## 使用说明

- [CometFlow 使用说明（整体逻辑 + 命令参考）](./docs/USAGE.md)
- [演示脚本：用 CometFlow 实现 todoscan](./docs/demo/todoscan-demo.md)
- [命令对照说明：每条 CLI 在做什么](./docs/demo/todoscan-demo-cli-notes.md)

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm package-e2e
```

## 设计文档

- [设计文档索引](./docs/design/README.md)
- [决策记录](./docs/decisions)
