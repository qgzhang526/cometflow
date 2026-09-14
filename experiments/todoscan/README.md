# 演示种子：todoscan

这是给「用 CometFlow 实现一个小工具」演示准备的**种子项目**：只包含人类该写的东西
（`COMETFLOW.md` + `specs/` + 测试夹具），**不含任何实现代码**。实现代码应当在演示时由
CometFlow 驱动 Agent 产出。

完整操作步骤见：[`docs/demo/todoscan-demo.md`](../../docs/demo/todoscan-demo.md)。

目录说明：

```text
todoscan/
├─ COMETFLOW.md          # 使命 + 技术栈 + 目标 G1
├─ specs/
│  ├─ scan/spec.md       # capability：扫描与过滤（anchor: scan <dir> / 过滤）
│  ├─ report/spec.md     # capability：输出渲染（anchor: report text / report json）
│  ├─ settings/spec.md   # capability：配置加载（anchor: load-config）
│  ├─ errors.md          # 错误码目录（E_NO_PATH / E_BAD_CONFIG）
│  ├─ config.md          # 运行时配置契约（exclude / tags）
│  └─ constraints.md     # 非功能约束（零依赖 / 性能 / 部署）
└─ tests/fixtures/       # 确定性夹具：共 6 条待办注释
```

## spec 判据（module + check）

每个 capability spec 的 front-matter 声明了实现应落在哪个模块，Acceptance 项带上了可执行判据：

| capability | module | 判据 |
|---|---|---|
| scan | `src/scan` | `node tests/acceptance.mjs A1|A2|A3` |
| report | `src/report` | `node tests/acceptance.mjs A4|A5` |
| settings | `src/settings` | `node tests/acceptance.mjs A6|A7` |

`tests/acceptance.mjs` 是判据实现，只依赖 Node 内置模块；它按 A1–A7 驱动 `bin/todoscan.mjs` 并断言退出码、stderr 错误码与输出格式。

> 实现完成前这些 check 会失败，这是设计意图：spec 先定义「怎么算通过」，实现再去满足它。
> 用 `cometflow change verify <name> .` 可以看到逐条判定来源：
> `check` 失败的项不会被任何 Verifier 或文档判成通过。

```bash
node tests/acceptance.mjs A1     # 单独跑一条判据
cometflow spec checks .          # 列出全部判据与未覆盖项
```

`bin/todoscan.mjs` 是 CLI 入口，属于跨 capability 的共享文件；
共享路径声明在 `COMETFLOW.md` 的 `## 模块归属` 里（`bin`、`tests`、`package.json`），
随仓库分发，换机器依然生效；`cometflow change scope` 与 hook guard 都按它放行。

本地临时例外（不想写进 COMETFLOW.md 时）可以放在 `.cometflow/config.yaml` 的 `scope.allow`，
但该目录被 gitignore，不会随仓库分发。

演示时的用法是「把种子复制进一个新项目」，而不是直接在这里跑：

```bash
cometflow init /tmp/todoscan-demo --interactive
cp -r experiments/todoscan/COMETFLOW.md experiments/todoscan/specs experiments/todoscan/tests /tmp/todoscan-demo/
```
