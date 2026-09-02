# 005 CLI 与执行流程

## CLI 命令

### 项目与目标

```bash
cometflow init [path]
cometflow project migrate [path]
cometflow project derive [path] --app <name> --from <base>
cometflow goal sync
cometflow goal update <goal>
```

### Spec

```bash
cometflow spec validate
cometflow spec diff [--impact]
cometflow spec freeze <change>
cometflow spec apply <change>
cometflow spec trace <change>
cometflow spec generate --draft
cometflow spec drift
```

### 任务规划

```bash
cometflow plan generate <goal>
cometflow plan validate <goal>
cometflow plan review <goal>
cometflow plan approve <goal>
cometflow plan freeze <goal>
cometflow plan edit <goal>
cometflow plan regenerate <goal> [--preserve-approved]
cometflow plan trace <task-id>
```

### 调度

```bash
cometflow run [path] [--budget 8h] [--agent opencode]
cometflow daemon start [path] [--mode always|idle|schedule]
cometflow daemon pause|resume|stop [path]
cometflow status [path] [--json] [--watch]
cometflow adjust [path] "优先级说明"
cometflow decisions [path] --last 10
```

### 工作流

```bash
cometflow change new <name> --goal <goal> --task <task> --path <path>
cometflow change list [path] [--all] [--json]
cometflow change status <name> [path]
cometflow change resume <name> [path] [--json]   # 下一步动作指引（断点恢复）
cometflow change transition <name> <event> [path]
cometflow workflow resolve [path]
cometflow native [args...]
cometflow classic [args...]
cometflow change revise <change>
```

### Skill / 进化 / 评估

```bash
cometflow skill add|show|run|continue|check|import
cometflow evolve propose|verify|submit|status|rollback <name> [path]
cometflow evolve verify --eval                     # 叠加本地科学评估门禁
cometflow evolve approve <name> [path] --note <text> [--commits <csv>]   # 终态
cometflow evolve reject <name> [path] --reason <text>                    # 终态
cometflow evolve review-list [path] [--json]
cometflow eval [target] [--suite local|langsmith|langfuse]
```

### 可观测与维护

```bash
cometflow dashboard [path]
cometflow doctor [path]
cometflow update
cometflow uninstall
```

## 主执行流程

```text
人类写 COMETFLOW.md + specs/
        │
        ▼
cometflow goal sync
        │
        ▼
cometflow plan generate G1
        │
        ▼
cometflow plan validate
        │
        ▼
cometflow plan review / approve
        │
        ▼
cometflow plan freeze G1
        │
        ▼
Scheduler 取冻结任务
        │
        ▼
创建/恢复 Change
        │
        ▼
Shape / Build / Verify / Archive
        │
        ▼
报告 + spec 归档
```

## 安全模式

- `unattended`：原 Nightshift 信任模型，跳过交互确认，靠锁、prompt 约束、快照兜底。
- `guarded`：启用 Comet Hook Router 与阶段 Guard。

## 调度策略

- always：全时持续运行。
- idle：空闲算力时运行。
- schedule：时间窗口。
- manual：单次运行。
- event：未来扩展。