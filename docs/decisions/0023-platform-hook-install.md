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
- `hook status` 报告已装/未装/守卫脚本缺失（drift）；`doctor` 后续可复用同一接口。
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

残留风险（已知、暂不处理）：Windows 走 `cmd.exe` 时 `%` 仍会被当作变量引用展开，
所以路径里含 `%` 的项目理论上仍可能把路径传歪；`&` / `^` 等符号已被引号保护。
真要为它兜底得把目标路径改成用环境变量传递（需要 CLI 侧配合），收益不抵成本。
