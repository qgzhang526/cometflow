# CometFlow

> 全时运行的自主 Agent 开发平台。

CometFlow 融合 Nightshift 的持续调度/无人值守能力与 Comet 的可恢复工作流、Skill 生态、科学评估能力。

当前阶段：**MVP 开发中**。

## 已实现能力

```text
cometflow init [path]
cometflow goal sync [path]
cometflow spec validate|anchors|lock|diff [path]
cometflow plan generate|validate|review|approve|freeze|trace <goal> [path]
cometflow change new|status|transition <...>
cometflow run [path] --agent opencode|claude-code
cometflow daemon start [path] --mode always|idle|schedule|manual
cometflow evolve propose|verify|submit|status|rollback <name> [path]
cometflow status [path]
cometflow dashboard [path] --port <port>
cometflow agent list|check <agent>
```

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 设计文档

- [设计文档索引](./docs/design/README.md)
- [决策记录](./docs/decisions)
