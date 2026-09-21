#!/usr/bin/env bash
# 演示项目的接口冒烟测试（Linux / macOS / WSL）：编译 → 起服务 → 打三条 API → 断言 → 停服务。
#
#   ./scripts/demo/smoke-api.sh [项目目录] [端口]
#
# 退出码 0 表示全过。
set -euo pipefail

PROJECT="${1:-/mnt/d/zqg/demos/cbb-emergency-access-done}"
PORT="${2:-8080}"
PROJECT="$(cd "$PROJECT" && pwd)"
DEMO_DIR="$PROJECT/demo"
mkdir -p "$DEMO_DIR"

FAILS=0
check() { # check <名称> <条件表达式结果>
  if [ "$2" = "0" ]; then echo "  ok   $1"; else echo "  FAIL $1"; FAILS=$((FAILS + 1)); fi
}

echo "build  : go build -o demo/server ./cmd/server"
( cd "$PROJECT" && go build -o "$DEMO_DIR/server" ./cmd/server )

# 每次从干净的库开始；响应文件也清掉——留着会让断言读到上一次的结果
rm -f "$DEMO_DIR/state.db" "$DEMO_DIR"/resp-*.json "$DEMO_DIR"/body-*.json

# 配置：auth.mode=header 是演练与验收用的身份来源（specs/config.md）
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

( cd "$PROJECT" && "$DEMO_DIR/server" --config demo/config.json --port "$PORT" ) \
  > "$DEMO_DIR/server.out.log" 2> "$DEMO_DIR/server.err.log" &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 100); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then exec 3>&- ; break; fi
  sleep 0.3
done
if ! (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "  FAIL 服务没起来"; cat "$DEMO_DIR/server.out.log" "$DEMO_DIR/server.err.log"; exit 1
fi
exec 3>&-
echo "  ok   服务就绪：http://127.0.0.1:$PORT"

post() { # post <路径> <id> <角色> <body文件> <标签>
  curl -s -o "$DEMO_DIR/resp-$5.json" -w '%{http_code}' -X POST \
    "http://127.0.0.1:$PORT$1" \
    -H 'content-type: application/json' \
    -H "x-actor-id: $2" -H "x-actor-roles: $3" -H 'x-forwarded-for: 10.0.0.8' \
    --data-binary "@$4"
}
json() { tr -d '\n' < "$1"; }

echo "== A1 发起申请"
printf '%s' '{"server_id":"srv-prod-01","reason":"磁盘告警","duration_minutes":15}' > "$DEMO_DIR/body-request.json"
ST=$(post /api/emergency/access/request ops-on-call requester "$DEMO_DIR/body-request.json" request)
RID=$(json "$DEMO_DIR/resp-request.json" | grep -o '"request_id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "HTTP 200（实际 $ST）" "$([ "$ST" = "200" ] && echo 0 || echo 1)"
check "code=0" "$(json "$DEMO_DIR/resp-request.json" | grep -q '"code":"0"' && echo 0 || echo 1)"
check "返回 request_id" "$([ -n "$RID" ] && echo 0 || echo 1)"
check "状态 pending" "$(json "$DEMO_DIR/resp-request.json" | grep -q '"status":"pending"' && echo 0 || echo 1)"

echo "== A5 自己批自己"
printf '{"request_id":"%s","decision":"approve","comment":"自己批自己"}' "$RID" > "$DEMO_DIR/body-self.json"
ST=$(post /api/emergency/access/approve ops-on-call approver "$DEMO_DIR/body-self.json" self)
check "HTTP 403（实际 $ST）" "$([ "$ST" = "403" ] && echo 0 || echo 1)"
check "code=E_SELF_APPROVAL" "$(json "$DEMO_DIR/resp-self.json" | grep -q 'E_SELF_APPROVAL' && echo 0 || echo 1)"

echo "== A4 换人审批"
printf '{"request_id":"%s","decision":"approve","comment":"同意"}' "$RID" > "$DEMO_DIR/body-approve.json"
ST=$(post /api/emergency/access/approve ops-lead approver "$DEMO_DIR/body-approve.json" approve)
check "HTTP 200（实际 $ST）" "$([ "$ST" = "200" ] && echo 0 || echo 1)"
check "code=0" "$(json "$DEMO_DIR/resp-approve.json" | grep -q '"code":"0"' && echo 0 || echo 1)"
check "状态 approved" "$(json "$DEMO_DIR/resp-approve.json" | grep -q '"status":"approved"' && echo 0 || echo 1)"
check "发放一次性令牌" "$(json "$DEMO_DIR/resp-approve.json" | grep -q '"token":"' && echo 0 || echo 1)"

if [ "$FAILS" -gt 0 ]; then
  echo "smoke-api: FAIL（$FAILS 项）"; exit 1
fi
echo "smoke-api: OK —— 编译、起服务、三条接口全部符合契约"
