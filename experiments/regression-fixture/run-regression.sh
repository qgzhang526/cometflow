#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
CF="$ROOT/node_modules/.bin/tsx $ROOT/app/cli/index.ts"

echo "== read-only checks =="
$CF doctor .
$CF context sync .
$CF spec validate .
$CF spec verify .
$CF spec scaffold --list .
$CF spec drift .
$CF change list --all .
$CF change gc . --json > /dev/null
$CF evolve review-list .
$CF status .
$CF doctor . --clean-temp
$ROOT/node_modules/.bin/tsx $ROOT/scripts/dashboard-smoke.ts .

echo "== mutating checks in temp copy =="
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -R . "$TMP/fixture"
cd "$TMP/fixture"

# spec kind scaffolding: remove a present kind, then re-scaffold (idempotent)
rm specs/constraints.md
$CF spec scaffold .
test -f specs/constraints.md || { echo "spec scaffold failed to recreate specs/constraints.md"; exit 1; }
test ! -f specs/models.md || { echo "spec scaffold unexpectedly created specs/models.md"; exit 1; }

$CF spec index .
test -f .cometflow/spec-index/apis.yaml || { echo "spec index missing apis.yaml"; exit 1; }

$CF plan generate G3 .
$CF plan validate G3 .
$CF plan freeze G3 .

$CF eval .
$CF skill add skills/safe-skill --project .
$CF skill list --project .
$CF skill import skills/risky-skill risky-skill --project .

$CF bundle compile .
$CF bundle distribute . --platform opencode
$CF bundle distribute . --platform claude-code
$CF bundle distribute . --platform codex

$CF change run build-change . --agent mock
$CF change verify verify-change .
$CF change archive archive-change .

# 两阶段迁移：正常提交后不应残留 pending 记录，spec verify 必须仍然干净
test -f .cometflow/runtime/changes/shape-change/transition-pending.json && {
  echo "pending transition left behind"; exit 1;
}
$CF change transition shape-change confirm-acceptance .
test ! -f .cometflow/runtime/changes/shape-change/transition-pending.json || {
  echo "pending transition not cleared"; exit 1;
}
$CF spec verify .

# 证据回收：只能在临时副本里跑 apply（它确实会删除 runtime 下的可推导内容）
$CF change gc . --json > /dev/null
$CF change gc . --apply
$CF doctor . --clean-temp
test -f .cometflow/runtime/changes/archive-change/journal.jsonl || {
  echo "evidence gc removed the journal"; exit 1;
}
$CF spec verify .

$CF classic status classic-open .
$CF classic transition classic-open open-complete .
$CF classic transition classic-open design-complete .
$CF classic transition classic-open build-complete .
$CF classic transition classic-open verify-pass .
$CF classic transition classic-open archive-complete .

$CF daemon start . --mode manual --budget 1 --safety-bundle


# hook guard: multiple active changes must fail closed
if $CF hook check src/core/index.ts . --event write; then
  echo "hook guard expected denial"
  exit 1
fi
echo "regression: PASS"
