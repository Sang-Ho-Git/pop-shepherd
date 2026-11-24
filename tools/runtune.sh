#!/bin/bash
# 런 조정 측정을 캐릭터·시드 벌마다 병렬로: tools/runtune.sh <variant> <출력 폴더> [시드 수]
# RAMP 같은 환경 변수는 그대로 넘어간다
v=$1; out=$2; n=${3:-36}
mkdir -p "$out"
for s in 11 47; do for c in shepherd cue olly pale; do node tools/runtune.ts "$v" "$n" $s $c --json "$out/${v}_${s}_$c.json" & done; done; wait
for s in 11 47; do echo "== $v 시드 $s~$((s + n - 1))"; node tools/runtune.ts --merge "$out"/${v}_${s}_*.json; done
echo "== $v 합"; node tools/runtune.ts --merge "$out"/${v}_*.json
