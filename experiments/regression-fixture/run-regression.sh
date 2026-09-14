#!/usr/bin/env bash
# 回归入口。真正的实现是 scripts/regression.mjs——Node 版在 Windows 与 Linux 上都能跑，
# 两边共用同一份逻辑，避免「本地跑不了、只能等 CI」。
# 保留这个 shim 是为了让既有文档与习惯用法继续可用。
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

exec node "$ROOT/scripts/regression.mjs" "$SCRIPT_DIR"
