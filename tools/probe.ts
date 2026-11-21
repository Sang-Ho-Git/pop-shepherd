/**
 * 실험용 비교 시뮬: 같은 시드로 조건(variant)만 바꿔 런 완주와 스테이지 도달을 비교한다.
 *   node tools/probe.ts --variant base,noPaint --ball --chars shepherd,olly,cue --seeds 6
 * variant는 tools/variants.ts에 정의한다 (데이터를 메모리에서만 바꾼다).
 */
import { runCampaign } from "../src/sim/campaign.ts";
import { CAMPAIGN } from "../src/data/index.ts";
import { VARIANTS } from "./variants.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}
const variant = arg("variant", "base");
const chars = arg("chars", "shepherd,cue,olly,pale").split(",");
const seeds = Number(arg("seeds", "6"));
const ballMode = process.argv.includes("--ball");
const apply = VARIANTS[variant];
if (!apply) throw new Error(`알 수 없는 variant: ${variant} (${Object.keys(VARIANTS).join(", ")})`);
apply();
let won = 0;
let reached = 0;
let n = 0;
const perChar: string[] = [];
let ballPops = 0;
let pops = 0;
for (const ch of chars) {
  let w = 0;
  for (let s = 11; s < 11 + seeds; s++) {
    const r = runCampaign(s, ch, CAMPAIGN, { ballMode });
    n++;
    if (r.won) {
      won++;
      w++;
    }
    reached += r.reached;
  }
  perChar.push(`${ch} ${w}/${seeds}`);
}
console.log(`${variant}${ballMode ? " (색 공)" : ""}  완주 ${won}/${n}  평균 도달 ${(reached / n).toFixed(1)}  | ${perChar.join(" · ")}`);
void ballPops;
void pops;
