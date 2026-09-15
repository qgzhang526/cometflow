# ADR 0023：把写保护装进平台，而不是只提供判定函数

状态：已批准
日期：2026-09-14

## 背景

`cometflow hook check` 一直只是**判定函数**：`app/cli/index.ts` 的 `hook` 命令组下只有 `check`，仓库里没有任何机制把它装进 agent 平台的 hook 配置。也就是说「spec 声明的模块边界」实际是「agent 愿意遵守就遵守」，与 ADR 0018 的指针路由、`scope.allow` 的共享路径一样，都只是**可用的约束**而不是**生效的约束**。

## 决策

1. 新增 `cometflow hook install|status|uninstall --platform <id>`，把守卫装进平台配置。
2. **只实现有可依据格式的平台**：当前仅 `claude-code`（`settings.json` → `hooks.PreToolUse[]`，条目 `{ matcher, hooks: [{ type: 'command', command }] }`）。
3. **其余平台显式报「不支持」并返回非零退出码**，绝不写入猜测出来的配置——猜错会在用户机器上静默失效，比不装更糟。
4. 守卫脚本随项目安装到 `<platform>/hooks/cometflow-guard.mjs`，配置里用平台的**可移植变量**引用（Claude Code 用 `$CLAUDE_PROJECT_DIR`），避免写死绝对路径。
5. 守卫的语义：读 stdin 的工具调用 JSON → 取出文件路径 → 调用 `cometflow hook check <path> --event write` → 被拒时以**退出码 2** 阻止该次写入并把原因反馈给模型。CLI 不可用或 payload 解析失败时**放行**（守卫不负责猜，也不该把开发环境锁死）。
6. **可逆**：安装时备份原始 `settings.json` 与「安装后内容」的哈希；卸载时若文件未被用户改过就逐字还原，改过则只摘除 CometFlow 自己的条目。

## 理由

- 拦截必须在工具层发生，否则模型绕过提示词就绕过了约束。
- 猜测平台格式的代价是**静默失效**：配置写进去了、看起来装好了，实际从不触发。宁可现在只支持一个平台。
- 「卸载后逐字还原」是装 hook 这类工具的基本礼貌：用户不应该为了试一次写保护而永久改动自己的平台配置。

## 后果

- Claude Code 用户在 `cometflow hook install --platform claude-code` 之后，agent 写入模块外文件会被平台自身拦下。
- `hook status` 报告已装/未装/守卫脚本缺失（drift）；`doctor` 复用同一接口汇总写保护状态（见文末「补充」）。
- opencode / codex 用户暂时只能依赖 `hook check` 手工接入；等拿到各自可靠的 hook 契约再实现。
- 守卫依赖 `cometflow` 在 PATH 上（或用 `COMETFLOW_CLI` 指定），这一点在安装输出里明确提示。

## 修订（2026-09-15）：真实会话验证暴露的两个缺陷

把守卫装进本机 Claude Code 2.1.237 后做真实会话验证，暴露出两个**会导致静默放行**的问题，
都已修复并有回归覆盖（`test/domains/hook-guard-script.test.ts` 直接执行生成的守卫脚本，
而不是生成它的 TypeScript）：

1. **Windows 参数被空格切碎**。原实现是 `spawnSync(cli, args, { shell: true })`；shell 模式下
   Node 只把参数用空格拼接、不做任何转义。项目路径一旦含空格（`C:\My Projects\app`），
   CLI 实际收到的是被截断的路径（实测 `ARGV=["hook","check","C:\\...\\Temp\\cf","hook","space\\src\\auth\\login.ts",...]`），
   判定退化成 `outside-project` → **越界写入静默放行**。这与决策 5「CLI 不可用时放行」的失败方向叠加，
   等于用户以为装好了、实际从未生效。现改为 shell 模式下自己拼命令行并逐个加引号，
   顺带避开 Node 的 `DEP0190` 警告。
2. **`NotebookEdit` 不在 matcher 里**。matcher 原为 `Write|Edit|MultiEdit`；Claude Code 还有
   `NotebookEdit`（工具输入用 `notebook_path`，不是 `file_path`，两个字段名均实测存在于二进制中）。
   现 matcher 为 `Write|Edit|MultiEdit|NotebookEdit`，守卫同时读取 `notebook_path`。

同时明确一条**边界**（不是缺陷，但必须写清楚）：守卫只覆盖文件类内置工具，不覆盖 `Bash` 等间接写入。
它是流程约束——让 agent 在越界那一刻就被平台挡下——不是安全边界；强约束仍由
`change verify` / `change archive` 的越界检查兜底。

关于「CLI 不可用时放行」：shell 模式下命令不存在**不会**进 `result.error`，而是退出码 1 + 一句本地化提示，
因此守卫额外识别 `is not recognized as an internal or external command` / `不是内部或外部命令` / `command not found`，
让决策 5 的失败方向在 Windows 上真正成立。

## 修订（2026-09-15，第二轮）：把「CLI 不在」的判据收紧

3. **放行分支的判据过宽**。第一轮只匹配 stderr 措辞就放行，等于「stderr 里带这几个词」= 越界写入静默通过。
   现在要求三条同时成立：进程起来了（无 `result.error`）、`stdout` 为空、stderr 命中措辞。
   其中第二条是关键——CLI 只要真的判定过就一定在 stdout 留下结论
   （`hook check` 输出 `allowed` / `denied: <reason>`），真实判定因此永远落不进放行分支。
4. **`COMETFLOW_CLI` 自己没加引号**。它是命令行的第一个 token，带空格的裸路径同样被 cmd 切碎 →
   「命令不存在」→ 又是一个静默放行（和缺陷 1 同一类）。现在「含空格且不含引号」的 CLI 值会补引号，
   已自带引号的值（`node "C:/x/cli.mjs"`）原样使用。
   实测结论：`shell: true` 时 Node 已经给整行加了一层引号，守卫再套一层外层引号反而会被切成
   `"\"C:...` 这类碎参数（首次实现踩过，故不再套）。回归覆盖：
   `test/domains/hook-guard-script.test.ts` 新增「stderr 带 command not found 但 CLI 确实判定过 → 仍拦下」
   与「`COMETFLOW_CLI` 是带空格的裸路径 → 仍拦得下」两例；`scripts/regression.mjs` 增加一条同场景的端到端断言。

残留风险（已知、暂不处理）：Windows 走 `cmd.exe` 时 `%` 仍会被当作变量引用展开，
所以路径里含 `%` 的项目理论上仍可能把路径传歪；`&` / `^` 等符号已被引号保护。
真要为它兜底得把目标路径改成用环境变量传递（需要 CLI 侧配合），收益不抵成本。

## 验证记录（2026-09-15）：真实 Claude Code 会话

上面两条修复不只是在单测里成立 —— 用真实无头会话（`claude -p ... --dangerously-skip-permissions`，
CLI 2.1.237）跑过一次，两个用例都拿到预期结果，且在**路径含空格**的项目里复跑一致：

| 用例 | 会话输出（摘录） | 文件系统 |
|---|---|---|
| `Write rogue/outside.ts` | 「写入被项目自己的 CometFlow 守卫拦截了，文件**没有**创建」+ `CometFlow 阻止了这次写入：denied: outside-module-scope` | 未创建 |
| `Write src/auth/login.ts` | `DONE` | 已创建，内容精确匹配 |

模型还主动说明自己没有绕道（没改用 `Bash` 重定向、也没写到别处再移动）——这正是「约束放在工具层而不是提示词层」
想要的效果，也再次说明本节的「守卫不覆盖间接写入」是**必须写明的边界**而非可有可无的备注。

> 守卫在第二轮修订（收紧「CLI 不在」的判据、给带空格的 `COMETFLOW_CLI` 补引号）之后又重跑过同样的四个用例，
> 结果不变；本节的验证记录对应的是当前 HEAD 的守卫。

环境备注（供后来者复现）：本机 PATH 上的 `claude.exe` 是桌面应用而非 CLI；官方 OAuth 需要 Max/Pro 订阅
且 CLI 直连 `api.anthropic.com` 受区域限制（403，需代理）。实际跑通用的是桌面应用的**本地推理网关**
（`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 指向 `http://127.0.0.1:15721/claude-desktop`）。
完整步骤见 [platform-next-plan.md](../plan/platform-next-plan.md) 的「无头会话的环境结论」。

## 补充（platform-next-plan-2 的 P1）：`doctor` 汇总写保护状态

装 hook 是一次性动作，**生效**却是持续状态：守卫脚本可能被删（平台每次写入都会因 hook 命令失败而报错）、
可能是升级前的旧版（决策 3 里「猜错格式会静默失效」的同类风险，只是换成了「生成器修了但项目里那份没更新」）、
守卫要调的 CLI 也可能解析不到（决策 5 的放行分支，等于写保护消失）。这三种情况此前**都不可见**。

因此把 `hookStatus()` 的两个新事实接进 `doctor`：

- `guardOutdated`：把已安装的守卫脚本与 `hookGuardSource()` 的**当前输出**做哈希比对——
  用生成器而不是写死常量，升级后不会误报；
- `cli`：守卫实际会调用的命令能否解析（`platform/process/resolve-command.ts`，
  只读、不抛错，支持 `node "x.js"` 这类命令行前缀与未加引号的带空格路径）。

分级原则：**未安装只给 info**（写保护是可选增强，不是项目健康的前提，否则 doctor 会被无视）；
「条目在但脚本缺失」和「CLI 解析不到」都是 error，因为前者让平台每次写入报错、后者让写保护静默失效。
判定细节与 `--json` 退出码的一致性见 USAGE §13.1。
