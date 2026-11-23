/** 빠른 비교: 스테이지 1~7만 돌려 도달·레벨·팝을 본다. node tools/quick.ts <variant> <character> */
import { runCampaign } from "../src/sim/campaign.ts";
import { CAMPAIGN } from "../src/data/index.ts";
import { VARIANTS } from "./variants.ts";
const v = process.argv[2] ?? "base";
const ch = process.argv[3] ?? "olly";
VARIANTS[v]?.();
let reached = 0, lv = 0, pops = 0, hpMin = 0;
const n = 12;
for (let s = 0; s < n; s++) {
  const r = runCampaign(47 + s, ch, CAMPAIGN.slice(0, 7), { ballMode: true });
  reached += r.stages.filter((x) => x.cleared).length;
  const last = r.stages.at(-1)!;
  lv += last.levelEnd;
  pops += r.stages.reduce((a, x) => a + x.pops, 0);
  hpMin += Math.min(...r.stages.map((x) => x.hpMin));
}
console.log(`${v} ${ch}: 1~7 클리어 평균 ${(reached / n).toFixed(2)} · 끝 레벨 ${(lv / n).toFixed(1)} · 팝 ${(pops / n).toFixed(0)} · 최저 체력 ${((100 * hpMin) / n).toFixed(0)}%`);
