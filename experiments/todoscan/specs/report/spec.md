---
capability: report
module: src/report
---

# report capability

负责把扫描结果渲染成人可读或机器可读的输出。

## report text

默认输出格式：每行一条命中，最后一行是总计。

- 每行格式：`<path>:<line>:<TAG> <text>`
- 无命中时只输出 `total: 0`
- 退出码 0

### Acceptance

- A4：对 `tests/fixtures` 运行，stdout 每行符合 `<path>:<line>:<TAG> <text>`，最后一行是 `total: 6`
  - check: node tests/acceptance.mjs A4

## report json

`--json` 时的机器可读输出。

- 输出单个 JSON 对象：`{"total":N,"items":[{"path","line","tag","text"}]}`
- 退出码 0

### Acceptance

- A5：`--json` 的输出可被 `JSON.parse` 解析，且 `items` 长度等于 `total`
  - check: node tests/acceptance.mjs A5
