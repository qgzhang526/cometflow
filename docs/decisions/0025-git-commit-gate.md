# ADR 0025：把门禁装进提交，并让判定只有一份实现

状态：已批准
日期：2026-09-15
来源：[platform-next-plan-2.md](../plan/platform-next-plan-2.md) 的 P2

## 背景

CI 门禁（[ADR 0012](0012-spec-version-as-artifact.md) 之后建立的 `spec-gates`）只覆盖「推到远端之后」。
本地 `git commit` 完全不受约束，坏 spec 照样进历史——而本项目的整个重建语义建立在
「spec 与代码同批进历史」之上，历史里一旦出现对不上的提交，回滚与重建都要人工判断哪一版 spec 才是对的。

准备这一批时还发现两个**更根本**的问题：

1. **判定有两套**。`scripts/spec-gates.mjs` 自成一个实现，与 CLI 命令的关系只是「都调用同一个 domain」——
   一旦有人改了一边，门禁的结论就和本地命令不一致。H3 那次 bash 回归与真实逻辑分叉已经把这条坑踩过一遍
   （一条「应该被阻断」的断言其实从没验证到漂移）。
2. **两步门禁没有判定力**。`spec validate` 与 `plan validate` 只打印 `OK/FAILED`，**从不设置非零退出码**——
   也就是说 CI 里这两步永远是绿的，装样子而已（与 `doctor --json` 恒返回 0 是同一类缺陷：
   结论没有传到退出码）。

## 决策

1. **判定逻辑只有一份**：收进 `domains/gates/spec-gates.ts`，由 `cometflow gate check` 暴露；
   `scripts/spec-gates.mjs` 退化成薄壳（一次 CLI 调用），CI 与本地共用同一实现。
2. **退出码即结论**：`gate check` 与 `--json` 模式都按结论设置退出码；同时修掉
   `spec validate` / `plan validate` 只打印不设码的缺陷。
3. **装进提交**：`cometflow gate install --git-hooks` 写 `pre-commit`，跑 `cometflow gate check .`。
   - 目标必须显式（`--git-hooks`）——将来还会有别的安装点，猜用户想装哪儿是这类工具最招人烦的地方；
   - **链式**：用户原有的 `pre-commit` 先跑，它失败就不再往下跑（不替它做决定），卸载时逐字还原；
   - 用 `git rev-parse --git-path hooks` 解析目录，**尊重 `core.hooksPath`**（husky / lefthook 会改它）；
   - 脚本用 **LF**：Windows 上 CRLF 会让 `#!/bin/sh` 带上 `\r`，hook 静默不生效；
   - 逃生门用 git 原生的 `--no-verify`，不自造 `--force`。

## 理由

- 提交是「spec 与代码同批进历史」的最后一道可控关口；CI 只能事后发现。
- 「两套判定」比「漏判」更危险：漏判会被发现，不一致会长期看起来是对的。
- 门禁要装进每次提交都会跑的地方，所以它必须**快且只有一次进程**：薄壳版把 9 次 tsx 启动压成 1 次，
  夹具上从 ~30s 降到 ~3.5s。

## 后果

- 本地 `git commit` 与 CI 用同一套判定，红了就是红了，不再有「本地绿、CI 红」的解释空间。
- `gate status` 报告装没装、链没链、有没有漂移（升级后没重装），避免「以为在跑，其实早关了」。
- 非 git 仓库 / 无 `.git` 时明确拒绝，不写别处；`core.hooksPath` 被设置时会显式提示。
- 提交门禁会拖慢 commit（当前实现约 1–3s），必要时可 `git commit --no-verify` 临时绕过——
  这是**有意留的出口**：门禁的价值在于默认生效，而不是无法绕过。

## 风险

- husky / lefthook 会在自己的目录里生成 hook；我们的包装脚本写进解析出来的 hooks 目录并链式调用，
  但仍可能出现「工具重写了自己的 hook、把我们的包装覆盖掉」的情况——`gate status` 能看出来。
- 门禁在提交时跑 `doctor` 与 `spec verify`，涉及 git 状态读取；在超大仓库上需要实测耗时。

## 补充（platform-next-plan-2 的 P4）：装到工具承认的位置

上面「风险」第一条不是风险，是**必然发生**：husky v9 用 `core.hooksPath=.husky/_`（自动生成），
lefthook 的 `.git/hooks/pre-commit` 由它自己生成——写这两个位置等于装了个会被覆盖的东西，而且**不报错**。

于是安装点按宿主分派（`domains/gates/hook-host.ts`）：

| 宿主 | 位置 | 可逆性 |
|---|---|---|
| 裸仓库 | `hooks/pre-commit`（链式包装） | 原有 hook 备份为 `pre-commit.cometflow-orig` |
| husky | `.husky/pre-commit` 里追加带标记的托管块 | 未被改动则逐字还原；改过则只摘托管块 |
| lefthook | `lefthook.yml` 的 `pre-commit.commands` 插一条 | 同上 |

两个刻意的取舍：

- **lefthook 用文本插入而不是 YAML 重新序列化**：后者会把用户注释全部丢掉，而 lefthook.yml 通常写满注释。
  结构超出支持范围（`extends`、流式写法）时**明确拒绝并给手工步骤**，宁可不装也不写坏用户的配置文件。
- **husky 只动 `.husky/pre-commit`**：`_` 目录是 husky 生成的，碰它等于给自己挖坑。

教训记一笔：实现时「重复安装会覆盖第一次的备份」这个 bug 是**测试先抓到的**——
第二次 install 把 record 的 `content` 覆盖成含托管块的版本，卸载就把块也还原回去了。
幂等不只是「不重复插入」，还包括**不破坏第一次安装时留下的还原依据**。
