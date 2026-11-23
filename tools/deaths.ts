/** 캐릭터마다 어느 스테이지에서 죽는지 (색 공). node tools/deaths.ts [variant] [시드 수] [시작 시드] [캐릭터,..] */
import { CAMPAIGN } from "../src/data/index.ts";
import { runCampaign } from "../src/sim/campaign.ts";
import { VARIANTS } from "./variants.ts";
const v = process.argv[2] ?? "base";
const n = Number(process.argv[3] ?? "24");
const start = Number(process.argv[4] ?? "11");
VARIANTS[v]!();
const dead: Record<number, number> = {};
let won = 0;
const chars = (process.argv[5] ?? "shepherd,cue,olly,pale").split(",");
for (const ch of chars) {
  for (let s = start; s < start + n; s++) {
    const r = runCampaign(s, ch, CAMPAIGN, { ballMode: true });
    if (r.won) won++;
    else dead[r.stages.length] = (dead[r.stages.length] ?? 0) + 1;
  }
}
console.log(`${v}: ${chars.join(",")} 완주 ${won}/${n * chars.length} | 죽은 스테이지 ${Object.entries(dead).map(([k, c]) => `${k}:${c}`).join(" ")}`);
