# CometFlow 使用说明

CometFlow 是一个全时运行的自主 Agent 开发平台，融合了 Nightshift 的持续调度/无人值守能力和 Comet 的可恢复工作流、Skill 生态、科学评估能力。

本文档面向使用 CometFlow 开发业务项目的用户。

---

## 1. 安装

### 1.1 环境要求

- Node.js >= 22
- npm
- 可选：opencode 或 claude-code，用于真实 Agent 执行

### 1.2 内网安装

假设内网 npm 仓库地址为 `http://npm.internal.local`，CometFlow 包名为 `@zqg/cometflow`。

```bash
npm config set registry http://npm.internal.local

npm install -g @zqg/cometflow@0.1.0
```

安装后验证：

```bash
cometflow --version
```

### 1.3 离线安装

准备以下三个 tarball：

```text
zqg-cometflow-0.1.0.tgz
commander-14.0.3.tgz
yaml-2.9.0.tgz
```

然后在目标机器执行：

```bash
mkdir cometflow-install
cd cometflow-install
npm init -y

npm install --offline \
  ./zqg-cometflow-0.1.0.tgz \
  ./commander-14.0.3.tgz \
  ./yaml-2.9.0.tgz

./node_modules/.bin/cometflow --version
```

---

## 2. 快速开始

### 2.1 初始化项目

```bash
cometflow init my-project
cd my-project
```

初始化后会生成：

```text
my-project/
├─ COMETFLOW.md
├─ specs/
└─ .cometflow/
   ├─ config.yaml
   ├─ goals/
   └─ plans/
```

### 2.2 编写项目使命、技术栈、任务目标

编辑 `COMETFLOW.md`。

核心章节：

```markdown
# 项目使命

构建一个内部数据查询平台。

## 技术栈

| 维度 | 值 |
|------|-----|
| 前端 | 无 |
| 后端 | Golang |
| 数据库 | SQLite |
| 缓存 | 无 |
| 测试框架 | Go 内置 testing + testify |
| 构建工具 | go build |

## 运行环境

| 维度 | 值 |
|------|-----|
| 操作系统 | Linux |
| 部署方式 | 内网服务器 |
| 语言版本 | Go 1.22+ |

## 任务目标

### G1：用户邮箱登录
- 目标：支持用户使用邮箱验证码登录
- 范围：auth
- 成功标准：
  - 未注册邮箱可以获取验证码
  - 验证码错误返回 401
- 非目标：
  - 不做第三方 OAuth
```

### 2.3 同步项目上下文和目标

```bash
cometflow context sync .
cometflow goal sync .
```

### 2.4 编写项目 spec

在 `specs/` 下为每个 capability 创建 `spec.md`。

```markdown
---
capability: auth
---

# auth capability

## POST /login

登录接口。

## Acceptance

- A1：合法请求返回 200
- A2：错误密码返回 401
```

### 2.5 生成并冻结任务计划

```bash
cometflow plan generate G1 .
cometflow plan validate G1 .
cometflow plan review G1 .
cometflow plan approve G1 .
cometflow plan freeze G1 .
```

### 2.6 创建 Change 并执行

```bash
cometflow change new auth-login --goal G1 --task T1 --path .
cometflow change transition auth-login confirm-acceptance .
cometflow change run auth-login . --agent opencode
cometflow change verify auth-login .
cometflow change archive auth-login .
```

---

## 3. 项目状态文件

| 文件 | 说明 |
|---|---|
| `COMETFLOW.md` | 项目使命、技术栈、运行环境、任务目标，人类编辑 |
| `specs/` | 项目级 capability spec，人类编辑 |
| `.cometflow/config.yaml` | 项目配置 |
| `.cometflow/project-context.yaml` | 技术栈/运行环境机器投影 |
| `.cometflow/goals/*.yaml` | goal 机器投影 |
| `.cometflow/plans/*.task-plan.yaml` | 任务计划 |
| `.cometflow/eval.yaml` | 评估任务与 rubric |
| `.cometflow/evolve.yaml` | 进化门禁 |
| `.cometflow/bundle.yaml` | Skill Bundle 定义 |
| `.cometflow/spec-lock.json` | spec hash 锁 |
| `changes/<name>/comet-state.yaml` | Native change 状态 |
| `changes/<name>/classic-state.yaml` | Classic change 状态 |
| `changes/<name>/verification.yaml` | 独立 Verifier 验收结果 |

---

## 4. 命令参考

### 4.1 项目初始化与上下文

```bash
cometflow init [path]
cometflow context sync [path]
cometflow goal sync [path]
cometflow project migrate [path]
```

### 4.2 Spec

```bash
cometflow spec validate [path]
cometflow spec anchors [path]
cometflow spec lock [path]
cometflow spec diff [path]
cometflow spec drift [path]
```

### 4.3 任务计划

```bash
cometflow plan generate <goal> [path]
cometflow plan regenerate <goal> [path] [--preserve-approved]
cometflow plan validate <goal> [path]
cometflow plan review <goal> [path]
cometflow plan approve <goal> [path]
cometflow plan freeze <goal> [path]
cometflow plan trace <goal> [path]
```

### 4.4 Native 工作流

```bash
cometflow change new <name> --goal <goal> --task <task> [--path <path>]
cometflow change list [path] [--all] [--json]
cometflow change resume <name> [path]
cometflow change status <name> [path]
cometflow change transition <name> <event> [path]
cometflow change run <name> [path] [--agent opencode|claude-code|mock]
cometflow change verify <name> [path]
cometflow change archive <name> [path]
```

Native 阶段：

```text
shape → build → verify → archive
```

Transition 事件：

```text
confirm-acceptance
submit-candidate
verify-pass
verify-fail
archive-complete
```

### 4.5 Classic 工作流

```bash
cometflow classic new <name> --goal <goal> --task <task> [--profile full|hotfix|tweak]
cometflow classic status <name> [path]
cometflow classic transition <name> <event> [path]
```

Classic 阶段：

```text
full:   open → design → build → verify → archive
hotfix: open → build → verify → archive
tweak:  open → build → verify → archive
```

事件：

```text
open-complete
design-complete
build-complete
verify-pass
verify-fail
archive-complete
```

### 4.6 Agent 与调度

```bash
cometflow agent list
cometflow agent check <agent>
cometflow run [path] [--agent opencode|claude-code|mock] [--model <model>] [--timeout <ms>]
cometflow daemon start [path] \
  --mode always|idle|schedule|manual \
  [--budget <ms>] \
  [--interval <ms>] \
  [--agent opencode|claude-code|mock] \
  [--cpu-threshold <value>] \
  [--start HH:MM] \
  [--end HH:MM] \
  [--safety-bundle]
```

### 4.7 评估

```bash
cometflow eval [path]
```

`.cometflow/eval.yaml` 示例：

```yaml
schema: cometflow.eval.v1
sampling: 2
pass_at_k: 1
pass_all_k: 2
tasks:
  - name: typecheck
    command: node
    args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--noEmit"]
  - name: tests
    command: node
    args: ["node_modules/vitest/vitest.mjs", "run"]
rubric:
  - id: correctness
    description: 核心正确性
    task: tests
judge:
  provider: mock
```

### 4.8 进化

```bash
cometflow evolve propose <name> --summary <text> [--risk <text>]
cometflow evolve verify <name> [path] [--eval]
cometflow evolve submit <name> [path]
cometflow evolve approve <name> [path] [--note <text>] [--commits <csv>]
cometflow evolve reject <name> [path] --reason <text>
cometflow evolve review-list [path] [--json]
cometflow evolve status <name> [path]
cometflow evolve rollback <name> [path]
```

### 4.9 Skill 与 Bundle

```bash
cometflow skill add <source> [--project <dir>] [--overwrite]
cometflow skill show <skill> [--project <dir>]
cometflow skill list [--project <dir>]
cometflow skill import <source> <name> [--project <dir>]
cometflow bundle create <name> [path]
cometflow bundle compile [path]
cometflow bundle distribute [path] --platform <platform>
```

支持平台：

```text
opencode
claude-code
codex
qoder
codebuddy
zcode
cursor
windsurf
```

### 4.10 写保护

```bash
cometflow hook check <target> [path] --event write|edit
```

### 4.11 诊断与可观测

```bash
cometflow status [path]
cometflow doctor [path] [--json]
cometflow dashboard [path] [--port <port>]
cometflow update
cometflow uninstall [path] --force
```

---

## 5. 完整工作流示例

```bash
# 1. 初始化
cometflow init my-project
cd my-project

# 2. 填写 COMETFLOW.md 与 specs/

# 3. 同步
cometflow context sync .
cometflow goal sync .

# 4. spec 校验
cometflow spec validate .

# 5. 任务计划
cometflow plan generate G1 .
cometflow plan validate G1 .
cometflow plan review G1 .
cometflow plan approve G1 .
cometflow plan freeze G1 .

# 6. Native change
cometflow change new auth-login --goal G1 --task T1 --path .
cometflow change transition auth-login confirm-acceptance .
cometflow change run auth-login . --agent opencode
cometflow change verify auth-login .
cometflow change archive auth-login .

# 7. 评估与进化
cometflow eval .
cometflow evolve propose improve-auth --summary "改进登录错误提示"
cometflow evolve verify improve-auth . --eval
cometflow evolve submit improve-auth .
cometflow evolve review-list .
cometflow evolve approve improve-auth . --note "review ok"
```

---

## 6. 回归验证

仓库内提供长期回归夹具：

```bash
cd experiments/regression-fixture
bash run-regression.sh
```

平台单元测试：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm package-e2e
```

---

## 7. 常见问题

### 7.1 `cometflow` 找不到命令

确认全局安装成功：

```bash
npm list -g @zqg/cometflow
```

确认 npm 全局 bin 目录在 PATH 中。

### 7.2 `spec validate` 报 missing-project-context

执行：

```bash
cometflow context sync .
```

### 7.3 `change run` 提示 agent 不存在

查看可用 agent：

```bash
cometflow agent list
```

真实执行需要安装对应 agent CLI；测试可用：

```bash
cometflow change run <name> . --agent mock
```

### 7.4 内网环境无法安装依赖

使用离线安装，或确认内网 npm 仓库已发布 `commander` 和 `yaml`。
