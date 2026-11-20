/**
 * 무기 레벨별 실측 타격 수와 발사력(LP)을 시트·목표와 비교한다 (검증장, 180초, 시드 2개).
 *   npm run calib -- kick,shockwave
 */
import { runSim } from "../src/sim/run.ts";
import { WEAPONS, targetLp } from "../src/data/index.ts";
const ids = process.argv[2]!.split(",");
for (const id of ids) {
  const def = WEAPONS[id]!;
  for (const row of def.levels) {
    const reps = [1, 2].map((seed) => runSim({ seed, stageId: "m1_proving", characterId: "shepherd", seconds: 180, weapons: [{ id, lv: row.lv, branch: row.branch }] }));
    const ws = reps.map((r) => r.weapons[0]!);
    const fires = ws.reduce((a, x) => a + x.fires, 0);
    const hits = ws.reduce((a, x) => a + x.avgHits * x.fires, 0) / Math.max(1, fires);
    const lpM = ws.reduce((a, x) => a + x.lpMeasured * x.fires, 0) / Math.max(1, fires);
    const tgt = targetLp(row);
    console.log([id, `${row.lv}${row.branch ?? ""}`, `fires ${fires}`, `hits ${hits.toFixed(2)} / ${row.targets}`, `LP ${lpM.toFixed(0)} sheet ${ws[0]!.lpSheet.toFixed(0)} target ${tgt}`, `${((lpM / tgt - 1) * 100).toFixed(0)}%`].join("  "));
  }
}
