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

演示时的用法是「把种子复制进一个新项目」，而不是直接在这里跑：

```bash
cometflow init /tmp/todoscan-demo --interactive
cp -r experiments/todoscan/COMETFLOW.md experiments/todoscan/specs experiments/todoscan/tests /tmp/todoscan-demo/
```
