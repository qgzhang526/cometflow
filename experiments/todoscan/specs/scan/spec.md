---
capability: scan
module: src/scan
---

# scan capability

负责在文件系统中找出待办注释。

## scan <dir>

递归扫描 `<dir>`，找出所有待办注释。

- 跳过的目录：`.git`、`node_modules`
- 识别标签：`TODO`、`FIXME`、`HACK`（忽略大小写）
- 只识别注释行：行内首个非空白内容为 `//`、`#`、`/*`、`*`、`<!--` 之一
- 输出顺序：路径字典序，其次行号升序
- 错误码：E_NO_PATH

### Acceptance

- A1：运行 `node bin/todoscan.mjs tests/fixtures`，命中 6 条，路径顺序为 app.js → lib/util.js → notes.md → vendor/legacy.js
  - check: node tests/acceptance.mjs A1
- A2：运行 `node bin/todoscan.mjs no-such-dir`，stderr 含 `E_NO_PATH` 且退出码为 2
  - check: node tests/acceptance.mjs A2

## 过滤

在扫描结果上做标签与路径过滤。

- `--tag <TAG>`：可重复传入，只保留标签匹配的项
- `--exclude <PATH>`：可重复传入，路径包含该片段的项一律排除
- 配置键：exclude、tags

### Acceptance

- A3：`--tag FIXME` 只输出 1 条；`--exclude vendor` 输出 5 条
  - check: node tests/acceptance.mjs A3
