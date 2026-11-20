/**
 * 런 시뮬: 스테이지 1부터 10까지 성장을 이어 가며 봇으로 돌린다.
 *   npm run campaign -- --seeds 10 --character shepherd [--detail]
 */
import { runCampaign } from "../src/sim/campaign.ts";
import type { CampaignReport } from "../src/sim/campaign.ts";
import { CAMPAIGN } from "../src/data/index.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}
const seeds = Number(arg("seeds", "10"));
const seedStart = Number(arg("seed-start", "1"));
const chars = arg("character", "shepherd,cue,olly,pale").split(",");
const detail = process.argv.includes("--detail");
const pct = (n: number): string => `${Math.round(n * 100)}%`.padStart(4);

for (const ch of chars) {
  const reps: CampaignReport[] = [];
  for (let i = 0; i < seeds; i++) reps.push(runCampaign(seedStart + i, ch));
  console.log(`\n캐릭터 ${ch} · ${seeds}판 · 완주 ${reps.filter((r) => r.won).length}/${seeds}`);
  console.log("스테이지   도달  클리어  시작HP  최저HP  끝HP  레벨(끝)  연쇄  최대생존적");
  for (const [i, id] of CAMPAIGN.entries()) {
    const rs = reps.map((r) => r.stages[i]).filter((x) => x !== undefined);
    if (rs.length === 0) break;
    const m = (f: (x: (typeof rs)[number]) => number): number => rs.reduce((a, x) => a + f(x), 0) / rs.length;
    const cl = rs.filter((x) => x.cleared);
    const mc = (f: (x: (typeof rs)[number]) => number): number => (cl.length ? cl.reduce((a, x) => a + f(x), 0) / cl.length : 0);
    console.log(
      [id.padEnd(9), String(rs.length).padStart(4), `${cl.length}`.padStart(6), pct(m((x) => x.hpStart)).padStart(7), pct(m((x) => x.hpMin)).padStart(7),
        pct(mc((x) => x.hpEnd)).padStart(5), m((x) => x.levelEnd).toFixed(1).padStart(8), m((x) => x.avgChain).toFixed(2).padStart(6), m((x) => x.alivePeak).toFixed(0).padStart(9)].join(" "),
    );
  }
  if (detail) for (const r of reps) { const last = r.stages.at(-1)!; console.log(`  시드 ${r.seed}: ${r.reached}단계 · Lv${last.levelEnd} · ${last.weapons} | ${last.passives}`); }
}
