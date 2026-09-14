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
$CF metrics . --json > /dev/null
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

# 有界修复循环：把实现改坏 → 连续同一失败结论 → 停机 → 解封
cp src/auth/index.ts "$TMP/auth-index.bak"
printf 'export function login(): boolean {\n  return false;\n}\n' > src/auth/index.ts
$CF change new stall-demo --goal G2 --task T1 --path .
$CF change transition stall-demo confirm-acceptance .
for _ in 1 2 3; do
  $CF change transition stall-demo submit-candidate .
  if $CF change verify stall-demo .; then
    echo "stall-demo verify unexpectedly passed"; exit 1
  fi
done
grep -q 'status: blocked' changes/stall-demo/comet-state.yaml || {
  echo "stall-demo was not blocked after repeated identical failures"; exit 1;
}
if $CF change run stall-demo . --agent mock; then
  echo "blocked change should not run"; exit 1
fi
$CF change unblock stall-demo . --note 'regression: reset the loop'
grep -q 'status: active' changes/stall-demo/comet-state.yaml || {
  echo "unblock did not restore active status"; exit 1;
}
cp "$TMP/auth-index.bak" src/auth/index.ts

# git 来源绑定：分叉到无关历史后必须阻断，显式放行才继续
git init -q .
git -c user.email=cf@example.com -c user.name=cf add -A
git -c user.email=cf@example.com -c user.name=cf commit -qm 'regression baseline'
$CF change new git-demo --goal G2 --task T1 --path .
git -c user.email=cf@example.com -c user.name=cf checkout -q --orphan unrelated
git -c user.email=cf@example.com -c user.name=cf commit -q --allow-empty -m 'unrelated history'
if $CF change run git-demo . --agent mock; then
  echo "change run should be blocked after git drift"; exit 1
fi
$CF change run git-demo . --agent mock --allow-drift

$CF classic status classic-open .
$CF classic transition classic-open open-complete .
$CF classic transition classic-open design-complete .
$CF classic transition classic-open build-complete .
$CF classic transition classic-open verify-pass .
$CF classic transition classic-open archive-complete .

$CF daemon start . --mode manual --budget 1 --safety-bundle


# hook guard：有指针时按指针路由，没有指针时必须 fail closed
$CF change select stall-demo .
if ! $CF hook check src/auth/index.ts . --event write; then
  echo "pointer routing should allow a write inside the selected change module"
  exit 1
fi
$CF change select stall-demo . --clear
if $CF hook check src/auth/index.ts . --event write; then
  echo "hook guard expected denial without a current-change pointer"
  exit 1
fi
echo "regression: PASS"
