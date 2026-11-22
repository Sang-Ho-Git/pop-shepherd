/**
 * 런 시뮬: 스테이지 1부터 10까지 성장을 이어 가며 봇으로 돌린다.
 *   npm run campaign -- --seeds 10 --character shepherd [--detail] [--meta-coins 1000] [--no-shop]
 *   --meta-coins N  영구 강화 코인 N개를 싼 노드부터 쓴 프로필로 시작 (기본 0)
 */
import { runCampaign } from "../src/sim/campaign.ts";
import type { CampaignReport } from "../src/sim/campaign.ts";
import { CAMPAIGN } from "../src/data/index.ts";
import { profileForCoins } from "../src/progression/meta.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}
const seeds = Number(arg("seeds", "10"));
const seedStart = Number(arg("seed-start", "1"));
const chars = arg("character", "shepherd,cue,olly,pale").split(",");
const detail = process.argv.includes("--detail");
const metaCoins = Number(arg("meta-coins", "0"));
const meta = metaCoins > 0 ? profileForCoins(metaCoins) : undefined;
const shop = !process.argv.includes("--no-shop");
const ballMode = process.argv.includes("--ball");
if (meta) console.log(`영구 강화 (코인 ${metaCoins}): ${Object.entries(meta).map(([k, v]) => `${k}${v}`).join(" ")}`);
const pct = (n: number): string => `${Math.round(n * 100)}%`.padStart(4);

for (const ch of chars) {
  const reps: CampaignReport[] = [];
  for (let i = 0; i < seeds; i++) reps.push(runCampaign(seedStart + i, ch, CAMPAIGN, { meta, shop, ballMode }));
  const buys = reps.reduce((a, r) => a + r.stages.reduce((x, st) => x + st.bought.length, 0), 0) / seeds;
  const evos = reps.reduce((a, r) => a + r.stages.reduce((x, st) => x + st.evolutions, 0), 0) / seeds;
  const coins = reps.reduce((a, r) => a + r.coins, 0) / seeds;
  const wins = reps.filter((r) => r.won);
  const runMin = wins.length ? wins.reduce((a, r) => a + r.stages.reduce((x, st) => x + st.survived, 0), 0) / wins.length / 60 : 0;
  console.log(`\n캐릭터 ${ch} · ${seeds}판 · 완주 ${wins.length}/${seeds} · 상점 구매 ${buys.toFixed(1)}회 · 진화 ${evos.toFixed(1)}개 · 코인 ${coins.toFixed(0)}${wins.length ? ` · 완주 런 길이 ${runMin.toFixed(1)}분` : ""}`);
  console.log("스테이지   도달  클리어  시작HP  최저HP  끝HP  레벨(끝)  연쇄  최대생존적  번골드  엘리트  보스(초)  골드줍기  시간초과");
  for (const [i, id] of CAMPAIGN.entries()) {
    const rs = reps.map((r) => r.stages[i]).filter((x) => x !== undefined);
    if (rs.length === 0) break;
    const m = (f: (x: (typeof rs)[number]) => number): number => rs.reduce((a, x) => a + f(x), 0) / rs.length;
    const cl = rs.filter((x) => x.cleared);
    const mc = (f: (x: (typeof rs)[number]) => number): number => (cl.length ? cl.reduce((a, x) => a + f(x), 0) / cl.length : 0);
    console.log(
      [id.padEnd(9), String(rs.length).padStart(4), `${cl.length}`.padStart(6), pct(m((x) => x.hpStart)).padStart(7), pct(m((x) => x.hpMin)).padStart(7),
        pct(mc((x) => x.hpEnd)).padStart(5), m((x) => x.levelEnd).toFixed(1).padStart(8), m((x) => x.avgChain).toFixed(2).padStart(6), m((x) => x.alivePeak).toFixed(0).padStart(9), m((x) => x.goldEarned).toFixed(0).padStart(7),
        `${rs.reduce((a, x) => a + x.elitesKilled, 0)}/${rs.reduce((a, x) => a + x.elitesSpawned, 0)}`.padStart(7),
        (() => {
          const ts = rs.map((x) => x.bossTime).filter((t): t is number => t !== null);
          return (ts.length ? (ts.reduce((a, t) => a + t, 0) / ts.length).toFixed(0) : "-").padStart(8);
        })(),
        pct(m((x) => x.goldPickRate)).padStart(8),
        String(rs.filter((x) => x.timedOut).length).padStart(7)].join(" "),
    );
  }
  if (detail) for (const r of reps) for (const st of r.stages) if (st.bossHpLeft !== null) console.log(`  시드 ${r.seed} ${st.stage}: 보스 남은 체력 ${pct(st.bossHpLeft)} · 팝 피해 ${st.specialDamage.toFixed(0)} (${st.specialHits}회) · ${st.survived.toFixed(0)}초`);
  if (detail) for (const r of reps) { const last = r.stages.at(-1)!; console.log(`  시드 ${r.seed}: ${r.reached}단계 · Lv${last.levelEnd} · ${last.weapons} | ${last.passives}`); }
}
