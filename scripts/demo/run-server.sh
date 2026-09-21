#!/usr/bin/env bash
# 把演示项目编译并跑起来（Linux / macOS / WSL）。
#
#   ./scripts/demo/run-server.sh [项目目录] [端口]
#
# 默认跑兜底仓库（cbb-emergency-access-done，有完整实现）。
# 离线环境如果模块缓存是空的，见 docs/demo/go-demo-runbook.md 的
# 「编译、运行与手动验证」一节里关于 GOMODCACHE 的说明。
set -euo pipefail

PROJECT="${1:-/mnt/d/zqg/demos/cbb-emergency-access-done}"
PORT="${2:-8080}"

PROJECT="$(cd "$PROJECT" && pwd)"
[ -f "$PROJECT/go.mod" ] || { echo "不是 Go 项目：$PROJECT" >&2; exit 1; }

DEMO_DIR="$PROJECT/demo"
mkdir -p "$DEMO_DIR"

cat > "$DEMO_DIR/config.json" <<'JSON'
{
  "auth": { "mode": "header" },
  "store": { "file": "demo/state.db" },
  "targets": { "file": "tests/acceptance/testdata/server-targets.json" },
  "access": {
    "max_duration_minutes": 30,
    "idle_timeout_minutes": 5,
    "require_second_approver": false,
    "allowed_source_cidrs": ["127.0.0.0/8", "10.0.0.0/8"],
    "reject_limit_per_hour": 3,
    "circuit_break_minutes": 30
  },
  "tunnel": { "listen_port": 22022, "forward_to_port": 22, "forwarder": "memory" },
  "guard": { "tick_seconds": 10, "teardown_retries": 1, "now": "" },
  "audit": { "export_dir": "demo/export", "retention_days": 180 },
  "alert": { "webhook_url": "http://127.0.0.1:9/unused", "notify_on": ["request_created", "request_approved"] }
}
JSON
echo "config : $DEMO_DIR/config.json"

echo "build  : go build -o demo/server ./cmd/server"
( cd "$PROJECT" && go build -o "$DEMO_DIR/server" ./cmd/server )

echo
echo "服务起在 http://127.0.0.1:$PORT（Ctrl+C 停）"
cd "$PROJECT"
exec "$DEMO_DIR/server" --config demo/config.json --port "$PORT"
