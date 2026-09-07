#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
CF="$ROOT/node_modules/.bin/tsx $ROOT/app/cli/index.ts"

echo "== read-only checks =="
$CF doctor .
$CF context sync .
$CF spec validate .
$CF spec drift .
$CF change list --all .
$CF evolve review-list .
$CF status .
$ROOT/node_modules/.bin/tsx $ROOT/scripts/dashboard-smoke.ts .

echo "== mutating checks in temp copy =="
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -R . "$TMP/fixture"
cd "$TMP/fixture"

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
