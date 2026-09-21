# CometFlow 安装与使用讲解

> 讲解用稿：覆盖「安装 → 新建项目 → 已有（非 CometFlow）项目接入」三条主线。
> 命令参考：[USAGE.md](./USAGE.md) · Web 客户端设计：[design/008-client-visualization.md](./design/008-client-visualization.md)

## 0. 一分钟开场

CometFlow 是一个**规格驱动开发（SDD）的自主 Agent 开发平台**。一句话讲清分工：

> **人写目标和 spec，机器拆解任务、调度 Agent 执行、独立验收、门禁进化。**

两个入口：

| 入口 | 命令 | 适合场景 |
|---|---|---|
| CLI | `cometflow ...` | 自动化、脚本、CI、精细控制 |
| Web 客户端 | `cometflow serve` | 可视化评审、日常操作、现场演示 |

三个必须先记住的心智模型：

1. **唯一事实源**：`COMETFLOW.md` 是人写目标的唯一来源；`.cometflow/goals/*.yaml` 只是机器投影（由 `goal sync` 生成，不要手改）。
2. **spec 是契约**：`specs/` 按 12 种 kind 组织（models / protocol / errors / config / capability / flow / process / rules / constraints / permissions / pages + project），验收标准写成 `A1..An`。
3. **状态机驱动**：计划 `draft → validated → approved → frozen`；变更 `shape → build → verify → archive`；进化 `draft → verified → ready-for-review → approved/rejected`。

讲解时强调一句：**人不需要手写任务清单**，任务由 `plan generate` 从目标和 spec 拆解出来。

## 1. 安装

### 1.1 环境要求

- Node.js >= 22
- npm
- 可选：`opencode` 或 `claude-code`（真实执行 Agent；没有也能用 `mock` 跑通流程）

### 1.2 方式一：内网 npm 安装

```bash
npm config set registry http://<内网 npm 地址>
npm install -g @zqg/cometflow@0.3.1
```

### 1.3 方式二：离线 tarball 安装

准备三个 tarball（联网机器上在仓库根目录生成）：

```bash
npm pack --pack-destination offline-npm                          # zqg-cometflow-0.3.1.tgz
npm pack commander@14.0.3 yaml@2.9.0 --pack-destination offline-npm
```

（vue / pinia / vue-router 是构建前端用的开发依赖，离线运行时不需要。）

```bash
mkdir cometflow-install && cd cometflow-install
npm init -y
npm install --offline ./zqg-cometflow-0.3.1.tgz ./commander-14.0.3.tgz ./yaml-2.9.0.tgz
./node_modules/.bin/cometflow --version
```

### 1.4 方式三：源码运行（Web 客户端推荐方式）

```bash
git clone <repo-url> cometflow && cd cometflow
npm install
node node_modules/typescript/bin/tsc -p tsconfig.json    # 构建 dist/
node dist/app/cli/index.js serve --port 4321 --web-dir web
```

> 注意：Web 客户端资源在仓库的 `web/` 目录，当前 npm 包只包含 `dist/`。所以**演示 Web 客户端用源码方式最省事**；全局安装的 CLI 也可用 `--web-dir <仓库路径>/web` 指向它。

### 1.5 安装验证

```bash
cometflow --version
cometflow agent list      # 查看可用 Agent
cometflow doctor .        # 项目体检（在项目目录内执行）
```

## 2. 场景 A：新建项目（Greenfield）

### 2.1 CLI 路径（8 步）

```bash
# 1) 初始化骨架（生成 COMETFLOW.md 模板 + specs/ + .cometflow/）
cometflow init my-project
cd my-project

# 2) 按项目类型裁剪 spec kind（12-kind 问答）
cometflow spec scaffold --interactive

# 3) 编辑 COMETFLOW.md：项目使命 / 技术栈 / 运行环境 / 任务目标

# 4) 同步投影
cometflow context sync .
cometflow goal sync .

# 5) 写 spec：每个 capability 一个 specs/<cap>/spec.md，含 Acceptance A1..An

# 6) 校验 + 生成结构投影
cometflow spec validate .
cometflow spec index .

# 7) 拆解任务计划：生成 → 校验 → 评审 → 批准 → 冻结
cometflow plan generate G1 .
cometflow plan validate G1 .
cometflow plan review G1 .
cometflow plan approve G1 .
cometflow plan freeze G1 .

# 8) 执行变更：新建 → 确认验收 → 运行 Builder → 验收 → 归档
cometflow change new auth-login --goal G1 --task T1 --path .
cometflow change transition auth-login confirm-acceptance .
cometflow change run auth-login . --agent opencode
cometflow change verify auth-login .
cometflow change archive auth-login .
```

讲解要点：

- 第 2 步的问答决定生成哪些 kind：有后端 → `constraints`；数据库非无 → `models`；有网络接口 → `protocol`；有运行时配置 → `config`……结论写入 `.cometflow/init-manifest.yaml`（present / deferred / absent 三态）。
- 第 7 步是核心：**拆解由机器做，人只做评审和批准**；`plan freeze` 会把每个任务的 acceptance（A1..An）和 spec hash 冻结下来。
- 第 8 步的 `change run` 才是真正让 Agent 写代码的时刻；`change verify` 是独立验收，不采信 Agent 自报完成。

### 2.2 Web 路径（推荐现场演示）

```bash
cometflow serve --port 4321 --web-dir web
# 控制台输出：
#   CometFlow: http://127.0.0.1:4321
#   token: xxxxxxxx
```

浏览器打开 `http://127.0.0.1:4321/?token=xxxxxxxx`（URL 里的 token 会被自动保存）。

界面操作顺序：

1. 首页 **＋ 新建项目** → 三步向导
   - ① 基本信息：项目名称、本地路径（点「浏览…」用目录选择器选盘符/目录）、技术栈
   - ② 项目类型：7 个问题（网络接口 / 运行时配置 / 跨接口流程 / 后台进程 / 领域 DSL / 鉴权方式 / 错误码数量）
   - ③ 预览 12-kind 清单 → **创建**（后端执行 init + scaffold）
2. **目标** 页：点 `COMETFLOW.md` 打开大编辑框 → 改完点「保存并同步」→ 页面切换为只读页签（项目使命 / 技术栈 / 运行环境 / 任务目标 / 目标投影）
3. **规格** 页：`12-kind 状态`、`脚手架`（补全 deferred）、`引用检查`（跨文件引用校验）、`Spec 文件`（点开大框编辑后保存）
4. **计划** 页：选目标 → 生成 / 校验 / 评审 / 批准 / 冻结
5. **变更** 页：新建 change → 确认验收 → 运行 Builder（实时日志）→ 验收 → 归档
6. **设置** 页：默认 Agent、默认模型、调度器参数

## 3. 场景 B：已有且非 CometFlow 模板项目（Brownfield 接入）

### 3.1 接入原则（先讲清，打消顾虑）

- CometFlow **不改动你的业务代码**，只在项目根新增：
  - `COMETFLOW.md`（人写目标）
  - `specs/`（项目契约）
  - `.cometflow/`（机器状态；`init` 会自动把它写进 `.gitignore`）
  - `changes/`（变更记录）
- Web 端的「打开已有项目」只是**登记路径**（写入工作区 `workspace.json`），不复制、不迁移你的仓库。
- 存量系统不需要一次性补全 spec：先挑一个目标跑通闭环，再逐步把核心 capability 补进 `specs/`。

### 3.2 CLI 接入步骤

```bash
cd /path/to/existing-project

# 1) 在已有仓库原地生成 CometFlow 元数据（不覆盖已有文件；
#    若目录里已有 COMETFLOW.md 会直接报错，避免误覆盖）
cometflow init .

# 2) 若是从 NightShift 迁移的老项目（存在 NIGHTSHIFT.md / .nightshift/config）
cometflow project migrate .

# 3) 如实填写 COMETFLOW.md
#    - 项目使命：这个系统是做什么的
#    - 技术栈 / 运行环境：照现状填（这两张表会被 context sync 解析）
#    - 任务目标：只写「要新增或改造」的目标，不必描述全部存量功能

# 4) 裁剪 kind 并补 spec
cometflow spec scaffold --interactive
cometflow spec scaffold --list        # 查看每个 kind 的 present/deferred/absent
#    在 specs/ 下补核心 capability 的 spec.md（含 Acceptance A1..An）

# 5) 同步 + 校验
cometflow context sync .
cometflow goal sync .
cometflow spec validate .

# 6) 之后与新建项目一致：plan → change → verify → archive
```

### 3.3 Web 接入步骤

1. `cometflow serve --port 4321 --web-dir web`
2. 首页 **打开已有项目** → 目录选择器选中已有项目根目录
   - 要求该目录下存在 `COMETFLOW.md`；若还没有，先在终端执行 `cometflow init .`（或走一次「新建项目」向导、把路径指向该目录）
3. 进入项目后：**目标** 页补使命/技术栈/任务目标 → 同步 → **规格** 页看 12-kind 状态与引用检查 → **计划** 页拆解 → **变更** 页执行

### 3.4 存量项目建议节奏（给听众一张路线图）

| 阶段 | 做什么 |
|---|---|
| 第 1 天 | `init` + 填 COMETFLOW.md + 写 1 个 capability spec + 跑通一个 change，验证闭环 |
| 第 1 周 | 把核心模块补成 spec（capability / models / errors / config） |
| 持续 | 用 `spec drift` 监控 spec 与冻结任务的漂移；改动走 reconciliation change，不改历史 |

## 4. 日常循环与纠错路径

| 想改什么 | 走哪条路 |
|---|---|
| 目标写错了 | 改 `COMETFLOW.md` → `goal sync` → `plan regenerate`（加 `--preserve-approved` 保留不受影响的已批准任务） |
| 拆解错了 | 直接改 `.cometflow/plans/<goal>.task-plan.yaml` → `plan validate` |
| 项目级 spec 错了 | 改 `specs/` → `spec diff` / `spec drift` → 生成 reconciliation change（已完成任务不重开） |
| 变更级 spec 错了 | 改 `changes/<name>/specs/` → 重新 freeze acceptance |
| 想知道下一步做什么 | `change resume <name>` 给出下一步动作；`change run` 可指定 `--agent` |

## 5. 常见问题

| 现象 | 处理 |
|---|---|
| `cometflow` 找不到命令 | `npm list -g @zqg/cometflow`；确认 npm 全局 bin 目录在 PATH |
| `spec validate` 报 missing-project-context | 先执行 `cometflow context sync .` |
| `change run` 提示 agent 不存在 | `cometflow agent list`；没有真实 Agent 时用 `--agent mock` 跑通流程 |
| Web 页面空白 | 确认 `--web-dir` 指向仓库的 `web/` 目录；浏览器硬刷新（Ctrl+F5） |
| Web 接口 401 | 打开时带 `?token=`，或在页面顶部粘贴 serve 启动时打印的 token |
| 内网装不上依赖 | 用离线 tarball 安装，或确认内网仓库已发布 `commander`、`yaml` |

## 6. 十分钟演示脚本（照着做即可）

```text
0:00  介绍定位：人写目标与 spec，机器拆解与执行
0:01  cometflow --version / agent list / doctor
0:02  CLI 新建：init → spec scaffold --interactive（展示 12-kind 问答）
0:04  serve 启动 → 浏览器打开 → 新建项目三步向导（展示目录选择器）
0:06  目标页：COMETFLOW.md 编辑 → 保存并同步 → 只读页签
0:07  规格页：12-kind 状态 / 脚手架 / 引用检查
0:08  计划页：生成 → 校验 → 评审 → 批准 → 冻结
0:09  变更页：新建 → 确认验收 → 运行（实时日志）→ 验收 → 归档
0:10  已有项目接入：init . → 打开已有项目（强调不动业务代码）
```

---

## 附：一句话总结

> CLI 负责自动化与精细控制，Web 负责可视化与人机评审；
> 新建项目走「初始化 + 12-kind 脚手架」，已有项目走「原地 init + 逐步补 spec」；
> 无论哪条路，流程都是：**目标 → spec → 拆解 → 冻结 → 变更 → 验收 → 归档**。
