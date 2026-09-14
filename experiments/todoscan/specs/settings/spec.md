---
capability: settings
module: src/settings
---

# settings capability

负责读取项目级配置。

## load-config

读取当前工作目录下的 `.todoscanrc.json`。

- 键：exclude（string[]）、tags（string[]）
- 配置文件不存在时使用内置默认值（`TODO`、`FIXME`、`HACK`）
- 命令行显式传入 `--tag` 或 `--exclude` 时，覆盖配置文件中的同名项
- 错误码：E_BAD_CONFIG

### Acceptance

- A6：`.todoscanrc.json` 不是合法 JSON 时，stderr 含 `E_BAD_CONFIG` 且退出码为 2
  - check: node tests/acceptance.mjs A6
- A7：配置 `{"exclude":["vendor"]}` 时不传 `--exclude` 命中 5 条；改传 `--exclude lib` 命中 4 条
  - check: node tests/acceptance.mjs A7
