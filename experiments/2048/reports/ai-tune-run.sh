#!/bin/bash
# ai-heuristic-weight 落地对比：修改 src/ai/ai.ts 权重常数并跑 benchmark（n=100 seed=1 depth=1）
set -u
cd /d/zqg/github/cometflow/experiments/2048
OUT=reports/ai-weight-tune.jsonl
: > "$OUT"
RUN() {
  node ../../node_modules/tsx/dist/cli.mjs src/cli/bin.ts benchmark --n 100 --seed 1 --depth 1 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify({win_rate:j.win_rate,score_avg:j.score.avg,max_tile_avg:j.max_tile.avg,moves_avg:j.moves.avg}))})"
}
SET() { # $1 e $2 sm $3 mo $4 c
  sed -i "s/const EMPTY_WEIGHT = [0-9.]*/const EMPTY_WEIGHT = $1/" src/ai/ai.ts
  sed -i "s/const SMOOTH_WEIGHT = [0-9.]*/const SMOOTH_WEIGHT = $2/" src/ai/ai.ts
  sed -i "s/const MONO_WEIGHT = [0-9.]*/const MONO_WEIGHT = $3/" src/ai/ai.ts
  sed -i "s/const CORNER_WEIGHT = [0-9.]*/const CORNER_WEIGHT = $4/" src/ai/ai.ts
}
echo "baseline 270/0.1/100/500" >> "$OUT"
echo -n "baseline " >> "$OUT"; RUN >> "$OUT"
SET 320.0 0.1 100.0 500.0
echo -n "c1-empty320 " >> "$OUT"; RUN >> "$OUT"
SET 270.0 0.1 160.0 500.0
echo -n "c2-mono160 " >> "$OUT"; RUN >> "$OUT"
SET 270.0 0.05 100.0 800.0
echo -n "c3-corner800 " >> "$OUT"; RUN >> "$OUT"
SET 300.0 0.05 150.0 700.0
echo -n "c4-combo " >> "$OUT"; RUN >> "$OUT"
SET 270.0 0.1 100.0 500.0  # 还原基线
echo DONE >> "$OUT"
echo "tune complete"
