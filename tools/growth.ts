/**
 * 성장 속도 (11/25): 스테이지마다 레벨업 수·평균 간격, 상자 보상, 상점 구매, 번 골드.
 *   node tools/growth.ts [variant] [시드 수] [캐릭터,..]
 * 완주한 런만이 아니라 그 스테이지에 도달한 모든 런의 평균 (죽은 스테이지는 뺀다).
 */
import { CAMPAIGN } from "../src/data/index.ts";
import { runCampaign } from "../src/sim/campaign.ts";
import { VARIANTS } from "./variants.ts";
const v = process.argv[2] ?? "base";
const n = Number(process.argv[3] ?? "12");
const chars = (process.argv[4] ?? "olly,cue").split(",");
VARIANTS[v]!();
const acc = CAMPAIGN.map(() => ({ runs: 0, lv: 0, sec: 0, gold: 0, bought: 0, chest: 0, lvEnd: 0 }));
for (const ch of chars)
  for (let s = 11; s < 11 + n; s++) {
    const r = runCampaign(s, ch, CAMPAIGN, { ballMode: true });
    r.stages.forEach((st, i) => {
      if (!st.cleared) return;
      const a = acc[i]!;
      a.runs++;
      a.lv += st.levelEnd - st.levelStart;
      a.sec += st.survived;
      a.gold += st.goldEarned;
      a.bought += st.bought.length;
      a.chest += st.chests ?? 0;
      a.lvEnd += st.levelEnd;
    });
  }
console.log(`${v} (${chars.join(",")} × ${n}) 스테이지 | 런 | 레벨업 | 간격(초) | 끝 레벨 | 상자 | 번 골드 | 상점 구매`);
let tl = 0, ts = 0;
acc.forEach((a, i) => {
  if (!a.runs) return;
  const lv = a.lv / a.runs;
  tl += lv;
  ts += a.sec / a.runs;
  console.log(`${String(i + 1).padStart(2)} | ${String(a.runs).padStart(3)} | ${lv.toFixed(1)} | ${(a.sec / a.runs / Math.max(0.1, lv)).toFixed(0)} | ${(a.lvEnd / a.runs).toFixed(0)} | ${(a.chest / a.runs).toFixed(1)} | ${(a.gold / a.runs).toFixed(0)} | ${(a.bought / a.runs).toFixed(1)}`);
});
console.log(`합 레벨업 ${tl.toFixed(0)} · 평균 간격 ${(ts / tl).toFixed(0)}초`);
