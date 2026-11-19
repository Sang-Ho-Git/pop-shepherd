/**
 * 헤드리스 시뮬레이터 (구조 트리 6.3).
 *   npm run sim -- --seeds 5 --stage m1_proving --character shepherd --weapons shockwave:3,kick:3,magnet_totem:3
 *   --seconds 120  판 길이 (기본: 스테이지 길이)
 *   --json         보고서를 JSON으로 출력
 */
import { aggregate, M1_CRITERIA, runSim } from "../src/sim/run.ts";
import type { SimReport } from "../src/sim/run.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const seeds = Number(arg("seeds", "5"));
const seedStart = Number(arg("seed-start", "1"));
const stageId = arg("stage", "m1_proving");
const characterId = arg("character", "shepherd");
const secondsArg = arg("seconds", "");
const weapons = arg("weapons", "shockwave:3,kick:3,magnet_totem:3")
  .split(",")
  .map((s) => {
    const [id, lv] = s.split(":");
    return { id: id as string, lv: Number(lv ?? 1) };
  });

const reports: SimReport[] = [];
for (let i = 0; i < seeds; i++) {
  reports.push(
    runSim({
      seed: seedStart + i,
      stageId,
      characterId,
      weapons,
      ...(secondsArg ? { seconds: Number(secondsArg) } : {}),
    }),
  );
}
const agg = aggregate(reports);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ reports, aggregate: agg }, null, 2));
} else {
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  console.log(`스테이지 ${stageId} · 캐릭터 ${characterId} · 무기 ${weapons.map((w) => `${w.id} Lv${w.lv}`).join(", ")}`);
  console.log("");
  console.log("시드  생존(s)  소환  팝   팝처치  직접처치  매치비율  평균연쇄  최대연쇄  막힘/분");
  for (const r of reports) {
    console.log(
      [
        String(r.seed).padStart(4),
        `${r.survived.toFixed(0)}${r.died ? "✝" : ""}`.padStart(7),
        String(r.spawned).padStart(5),
        String(r.pops).padStart(4),
        String(r.poppedEnemies).padStart(7),
        String(r.killedEnemies).padStart(8),
        pct(r.matchKillRatio).padStart(8),
        r.avgChain.toFixed(2).padStart(8),
        String(r.maxChain).padStart(8),
        r.stallsPerMinute.toFixed(2).padStart(7),
      ].join("  "),
    );
  }
  console.log("");
  console.log("무기별 실측 타격 수 (시트 가정값과 비교)");
  const ids = reports[0]?.weapons.map((w) => w.id) ?? [];
  for (const id of ids) {
    const rows = reports.map((r) => r.weapons.find((w) => w.id === id)).filter((w) => w !== undefined);
    const fires = rows.reduce((a, w) => a + w.fires, 0);
    const hits = rows.reduce((a, w) => a + w.avgHits * w.fires, 0);
    const avg = fires > 0 ? hits / fires : 0;
    const first = rows[0];
    if (!first) continue;
    const lpMeasured = first.assumedTargets > 0 ? (first.lpSheet * avg) / first.assumedTargets : 0;
    console.log(
      `  ${id.padEnd(13)} Lv${first.lv}  발사 ${String(fires).padStart(5)}회  실측 ${avg.toFixed(2)} / 가정 ${first.assumedTargets}  →  LP 시트 ${first.lpSheet.toFixed(1)} · 실측 ${lpMeasured.toFixed(1)}`,
    );
  }
  console.log("");
  const mark = (ok: boolean): string => (ok ? "통과" : "미달");
  console.log(`M1 기준 (${agg.runs}판 평균, 사망 ${agg.deaths}판)`);
  console.log(`  매치 처치 비율 ${pct(agg.matchKillRatio)}  (기준 ≥ ${pct(M1_CRITERIA.matchKillRatio)})  ${mark(agg.pass.matchKillRatio)}`);
  console.log(`  평균 연쇄      ${agg.avgChain.toFixed(2)}    (기준 ≥ ${M1_CRITERIA.avgChain})      ${mark(agg.pass.avgChain)}`);
  console.log(`  (참고) 폭탄 팝을 뺀 연쇄 ${(reports.reduce((a, r) => a + r.matchChain, 0) / reports.length).toFixed(2)}  · 폭탄 팝 판당 ${(reports.reduce((a, r) => a + r.bombPops, 0) / reports.length).toFixed(1)}`);
  console.log(`  막힘 / 분      ${agg.stallsPerMinute.toFixed(2)}    (기준 < ${M1_CRITERIA.stallsPerMinute})        ${mark(agg.pass.stallsPerMinute)}`);
}
