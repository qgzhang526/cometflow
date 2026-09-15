# 平台侧第二批：把门禁延伸到运行期与本地提交

状态：P1 / P2 / P3 全部完成
来源：[platform-next-plan.md](./platform-next-plan.md) 的 A/B/D 完成后的剩余方向
前置依赖：[ADR 0023](../decisions/0023-platform-hook-install.md)、[ci-plan.md](./ci-plan.md)、[metrics-plan.md](./metrics-plan.md)

## 本批解决什么

第一批解决的是「约束由谁执行、在什么条件下执行」（独立 Verifier / 平台 hook / 调度器）。
这一批解决三件仍然悬空的事：**装好的约束还在不在生效**、**门禁能不能在提交那一刻挡住**、**门禁阈值能不能按项目配**。

| 顺序 | 方向 | 解决的问题 | 现状 |
|---|---|---|---|
| P1 | `doctor` 汇总 hook 安装状态 | 装了写保护，却没人告诉你它是否还在生效 | platform-next-plan B 节只有一条验收项，未实现 |
| P2 | git 提交门禁 | 门禁只在 CI，本地提交照样能把坏 spec 写进历史 | 全仓库无方案（仅 USAGE 一处顺带提及 pre-commit） |
| P3 | metrics 阈值可配 | 「只许持平或变好」写死在脚本里，别的项目用不了 | 只有 fixture 一份基线，方向与键名硬编码 |

执行顺序：**P1 → P2 → P3**（P1 最小且补的是已承诺的欠账；P2 价值最高但面大；P3 是收尾）。

---

## P1. `doctor` 汇总 hook 安装状态

### 现状与证据

`domains/guard/hook-install.ts` 的 `hookStatus()` 已经能报 `installed` / `guardExists` / `drift`，
但 `domains/dashboard/doctor.ts` **从不调用它**——`cometflow doctor` 对写保护只字不提。
三个真实缺口：

1. **守卫脚本被删或没写成功**：`.claude/settings.json` 里的条目还在，平台每次 `Write` 都会因为 hook 命令
   找不到文件而报错，用户看到的是 Claude 的报错，而不是 CometFlow 的诊断。
2. **守卫脚本是旧版**：`cometflow` 升级后生成器变了，但已经装进项目的 `.claude/hooks/cometflow-guard.mjs` 不会自动更新，
   今天这种情况完全不可见（本轮「Windows 参数被空格切碎」就是生成器缺陷，装了旧版脚本的项目仍在静默放行）。
3. **`COMETFLOW_CLI` 指向失效路径**：按 ADR 0023 决策 5，CLI 不可用时守卫**放行**——
   于是写保护静默失效，而没有任何地方会提示。

### 目标

`cometflow doctor` 能一句话回答「这个项目的写保护还在不在生效」，并且**没装 hook 的项目不受影响**。

### 落点

1. `domains/guard/hook-install.ts`：`hookStatus()` 增加两个字段
   - `guardOutdated`：把已安装的守卫脚本内容与 `hookGuardSource()` 的当前输出做哈希比对（用生成器而不是固定常量，
     否则升级后必然误报）；
   - `cli`：`{ command, resolved, detail }`，即守卫实际会调用的命令与它能否解析。
2. 新增 `platform/process/resolve-command.ts`：把 `COMETFLOW_CLI`（或缺省 `cometflow`）解析成可执行文件。
   - 支持两种形态：**裸路径/命令名**，以及 `node "x.js"` 这类**带参数的命令行前缀**（首 token 才是命令）；
   - Windows 认 `PATHEXT`，POSIX 认可执行位；只读、不抛错，解析不到就返回 `resolved: false` + 原因。
3. `domains/dashboard/doctor.ts`：**只在已安装时**产生 hook findings，分级如下（未安装给 info，不改变 `healthy`）：

   | 情况 | severity | code |
   |---|---|---|
   | hook 条目在、守卫脚本缺失 | error | `hook-guard-missing` |
   | 守卫脚本内容与当前生成器不一致 | warning | `hook-guard-outdated` |
   | 守卫要调用的 CLI 解析不到 | error | `hook-cli-missing` |
   | 一切正常 | info | `hook-installed` |
   | 未安装 | info | `hook-not-installed`（附安装命令） |

### 验收标准

- [x] 未安装 hook 的项目：多一条 info，`healthy` 与退出码都不变
- [x] 删除 `.claude/hooks/cometflow-guard.mjs` → `doctor` 报 `hook-guard-missing`（error，退出码 1）
- [x] 把守卫脚本替换成旧版内容 → 报 `hook-guard-outdated`
- [x] `COMETFLOW_CLI` 指向不存在的路径 → 报 `hook-cli-missing`
- [x] `hook status --json` 暴露同样的字段（CLI 与 Web 面板同源，不各造一套）
- [x] 单测覆盖上表情况 + `resolve-command` 的裸命令 / 带前缀 / 未加引号的带空格路径 / 不存在四种输入

### 实现记录

- 落点：`domains/guard/hook-install.ts`（`hookStatus` 增加 `guardOutdated` 与 `cli`）、
  新增 `platform/process/resolve-command.ts`、`domains/dashboard/doctor.ts`（六种 hook findings）。
- **顺带修掉一个既有缺陷**：`doctor --json` 在 `doctorCommand` 里提前 `return`，**不健康也退出 0**——
  机器可读模式的调用方（脚本、门禁）会拿到 `healthy: false` 却看到成功退出码。
  现在 `--json` 只改变输出格式，不改变结论。
- **`resolve-command` 的第一版被单测抓出一个同源缺陷**：按 token 拆分时，未加引号的带空格路径
  （`C:\Program Files\nodejs\node.exe`）会从空格处被切碎，判定成「命令不存在」——与守卫在 Windows 上的坑同一类。
  改为「整条能当文件用时优先按文件解释」，其余再按 `node "x.js"` 这种命令行前缀拆。
- 测试：`test/domains/doctor-hook-status.test.ts` 8 例、`test/platform/resolve-command.test.ts` 9 例；
  回归脚本新增 4 步（97 步），覆盖「装了 → info」「守卫被删 → error」「CLI 失效 → error」。
- 文档：USAGE §13.1 新增「用 `doctor` 确认写保护还在生效」（含分类表），ADR 0023 追加「补充」节。

### 风险与取舍

- **误报成 error 会让人干脆不看 doctor**：所以「没装 hook」必须是 info——写保护是可选增强，不是健康前提。
- `COMETFLOW_CLI` 是**命令行前缀**而不是文件路径（`node "D:/x/cli.js"` 很常见），按文件判断会误报；
  解析器必须先把首 token 当命令。
- CLI 检查只在 `installed === true` 时进行：否则用 `node dist/...` 跑 doctor 的人会被假警报淹没。

---

## P2. git 提交门禁

### 现状与证据

门禁只活在 CI：`.github/workflows/ci.yml` 的 `spec-gates` job 调 `scripts/spec-gates.mjs`。
本地 `git commit` 完全不受约束——`docs/USAGE.md` 里唯一相关的一句是 `--impact` 的退出码「适合放进 CI 或 pre-commit」。
这与 ADR 0012 的前提冲突：**spec 与代码必须同批进历史**，否则历史里就会留下「代码对不上 spec」的提交，
而回滚/重建都要人工判断哪一版 spec 才是对的（重建语义正是这个项目的地基）。

### 目标

本地提交与 CI 用**同一套判定**，安装可逆，且不破坏用户已有的 pre-commit。

### 落点

1. `cometflow gate check [path] [--json]`：跑与 CI **完全相同**的只读判定
   （`spec validate` / `spec verify` / `doctor` / `plan validate` / metrics 基线），退出码即结论。
2. `scripts/spec-gates.mjs` 退化成薄壳，判定逻辑收进 `domains/gates/`（CI 与本地共用一份实现）。
   H3 那次 `git-demo` 断言失效，根因就是「bash 版回归」和实际逻辑分叉——同样的坑不要踩第二遍。
3. `cometflow gate install --git-hooks` / `gate status` / `gate uninstall`：
   - 写 `.git/hooks/pre-commit`（尊重 `core.hooksPath`）；
   - **已有 pre-commit**：备份 + 链式调用（先跑原 hook，再跑 gate），卸载时逐字还原；
   - 逃生门用 git 原生的 `--no-verify`，不自己发明 `--force`；
   - 非 git 仓库 / 无 `.git`（worktree 的子目录）/ `core.hooksPath` 指向别处 → 明确拒绝或明确提示，不静默写错地方。

### 验收标准

- [x] 未安装时 `git commit` 行为与今天完全一致
- [x] 安装后：门禁不通过时 commit 被拒（`scripts/regression.mjs` 用 stub 固定结论验证接线）
- [x] 已有 pre-commit 的项目：安装后两条 hook 都执行；卸载后原文件逐字还原
- [x] `gate check` 与 CI 的 `spec-gates` **共用实现**（CI 脚本退化成薄壳，只调 `gate check --json` 一次）
- [x] 幂等：重复 install 不产生重复 hook；`gate status` 能报出「已安装但内容漂移」

### 实现记录

- 落点：新增 `domains/gates/spec-gates.ts`（判定唯一实现：spec validate / spec verify / doctor /
  change gc dry-run / plan validate / metrics 基线）、`domains/gates/git-hook.ts`（安装、链式、还原、漂移）、
  `app/commands/gate.ts` + `gate check|install|status|uninstall` 四个子命令。
- `scripts/spec-gates.mjs` 退化成薄壳：一次 `gate check --json` 调用。夹具上从 ~30s（9 次 tsx 启动）
  降到 ~3.5s——门禁要装进每次提交都跑的地方，慢就是不用。
- **顺带修掉两个同源缺陷**：`spec validate` 与 `plan validate` 只打印 `OK/FAILED`、**从不设置非零退出码**，
  也就是 CI 里这两步一直是绿的（与 `doctor --json` 恒返回 0 同一类：结论没传到退出码）。
  现在失败即退出码 1，并在夹具上实测：删掉 `specs/errors.md` → `spec-gates` 报
  `FAIL spec validate — missing-kind-file, unresolved-error-reference` 且退出 1（修复前那是恒 PASS 的一行）。
- 安装语义：`--git-hooks` 显式指定目标；已有 pre-commit 备份为 `pre-commit.cometflow-orig` 并**先**执行；
  卸载未改动则逐字还原、改动过则拒绝覆盖；用 `git rev-parse --git-path hooks` 尊重 `core.hooksPath`；
  脚本用 LF（Windows 上 CRLF 会让 `#!/bin/sh` 静默失效）；非 git 仓库明确拒绝。
- 测试：`test/domains/spec-gates.test.ts` 7 例（含「spec validate 真的会失败」「基线退化方向」）、
  `test/domains/gate-git-hook.test.ts` 7 例（含真实 `git commit` 被拦与被放行、链式、逐字还原、漂移）；
  回归脚本新增 6 步。
- 文档：[ADR 0025](../decisions/0025-git-commit-gate.md)、USAGE §13.3。

### 风险与取舍

- 提交门禁会**拖慢 commit**（`doctor` + `spec verify` 在多数项目上不到一秒，但大项目要实测）；
  必要时支持按配置裁剪判定项，但默认必须是完整集合，否则「本地绿、CI 红」的老问题会回来。
- husky / lefthook 等工具会改 `core.hooksPath`，此时写 `.git/hooks` 是**无效操作**——必须检测并明确说明。
- Windows 上 `.git/hooks/pre-commit` 必须用 LF 换行且带可执行位（git-for-windows 用 sh 执行），否则 hook 静默不生效。

---

## P3. metrics 门禁阈值可配

### 现状与证据

`scripts/spec-gates.mjs` 的 `compareToBaseline` 把 6 个指标与方向硬编码在 `DIRECTIONS`
（`acceptance_checkable_rate` / `anchor_coverage_rate` / `specs` / `capabilities` / `versions_total` / `drift_count`），
基线文件 `experiments/regression-fixture/metrics-baseline.json` 也只有 fixture 一份。
别的项目想用同一套门禁，只能复制脚本并猜方向；而且语义只有「只许持平或变好」，
既没有绝对阈值（`anchor_coverage_rate ≥ 0.8`），也没有容差（噪声指标允许 ±x）。

### 目标

阈值与方向可配；**不配置就不新增约束**；配置非法要报错而不是静默忽略。

### 落点

1. `.cometflow/config.yaml` 新增 `gates.metrics`：

   ```yaml
   gates:
     metrics:
       anchor_coverage_rate: { min: 0.8 }        # 绝对下限
       drift_count: { max: 0 }                    # 绝对上限
       changes: { direction: up, tolerance: 1 }   # 相对基线的比较 + 容差
   ```

   缺省时沿用今天的「只许持平或变好」（方向表仍内置），有配置时以配置为准。
2. `spec-gates` 读该配置；未知指标名、`min > max`、非法方向 → 明确报错并给可用指标名。
3. `cometflow metrics` 的输出回显**当前生效的门禁阈值**——否则又是一条「看不见的约束」，
   而看不见的约束等于没有约束。

### 验收标准

- [x] 无配置：与今天逐字一致（含 fixture 基线对比的通过/失败结论）
- [x] `anchor_coverage_rate: { min: 0.8 }` 且实际 0.75 → 门禁红，并说明是绝对阈值还是基线退化
- [x] `drift_count: { max: 0 }` 且实际大于 0 → 门禁红
- [x] 未知指标名 → 报错（不静默忽略），`PUT /config` 走同一份校验
- [x] `--update-baseline` 只更新基线，不覆盖配置里的阈值

### 实现记录

- 落点：新增 `domains/metrics/metric-gates.ts`（**叶子模块**：方向表、阈值解析与校验、判定、可读描述；
  不 import 任何东西，避免 `project/config` ↔ `gates` 的循环引用）、`domains/gates/metrics-gate.ts`（读项目配置）、
  `domains/project/config.ts`（`gates` 字段 + 复用同一份校验）、`domains/gates/spec-gates.ts`（新增
  `metrics thresholds` 判定项）、`app/commands/metrics.ts`（回显生效阈值）。
- 语义：`min`/`max` 判当前值；`direction`/`tolerance` 覆盖默认方向与容差；**不配就不新增约束**——
  升级版本不应该让任何项目突然变红。
- 配置错误（未知指标名、非数字、`min > max`、非法方向、负容差）一律让门禁变红并列出可用指标名，
  同一份校验也用在 `PUT /config` 上（否则界面能存下一份永远不生效的配置）。
- 测试：`test/domains/metric-gates.test.ts` 12 例 + `spec-gates` 新增 2 例；回归脚本新增 1 步
  （把 min 设成不可能达到的值，断言判定里真的出现它）。
- 文档：USAGE §13.3 / §14.1。

### 风险与取舍

- 阈值是**政策**不是事实：默认必须保持「不配即不新增约束」，否则升级版本 = 突然变红。
- 绝对值阈值会随项目规模失真（`specs` 数量天然增长），所以优先用「相对基线 + 容差」；
  绝对阈值留给真正有外部含义的指标（覆盖率、漂移数）。

---

## 里程碑

| 里程碑 | 内容 | 完成标志 |
|---|---|---|
| P1 | doctor 汇总 hook 状态 ✅ | 已安装/缺失/条目缺失/过期/CLI 失效都能报出来，未安装只给 info；`doctor --json` 退出码与结论一致 |
| P2 | git 提交门禁 ✅ | 本地 commit 与 CI 同源判定（CI 脚本退化为薄壳）；已有 pre-commit 链式安装与逐字还原；顺带修掉 `spec validate` / `plan validate` 恒返回 0 |
| P3 | metrics 阈值可配 ✅ | 无配置行为不变；配置非法报错（`PUT /config` 同源）；阈值在 `metrics` 输出里可见 |

## 完成定义（DoD）

与前三批一致：单元测试覆盖失败路径 → 回归脚本补场景 → USAGE 与 ADR 更新 → 回填本计划与 `docs/plan/README.md`。
