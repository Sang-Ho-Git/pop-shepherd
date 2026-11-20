/**
 * 무기 레벨별 실측 타격 수와 발사력(LP)을 시트·목표와 비교한다 (검증장 300초(CALIB_SECONDS로 변경), 시드 2개, M1 기준 구성).
 *   npm run calib -- kick,shockwave
 */
import { runSim } from "../src/sim/run.ts";
import { WEAPONS, targetLp } from "../src/data/index.ts";
const ids = process.argv[2]!.split(",");
/**
 * 측정 조건: M1 기준 구성(킥·충격파·토템 Lv3)에서 측정할 무기만 바꿔 끼운다.
 * 무기 하나만 들면 적이 쌓여 범위 무기의 타격 수가 부풀려진다. 올가미·페인트 총은 킥 자리에 넣는다.
 */
function loadout(id: string, lv: number | "evo", branch: string | null) {
  const base = ["kick", "shockwave", "magnet_totem"];
  const slot = base.includes(id) ? id : "kick";
  return base.map((b) => (b === slot ? { id, lv, branch } : { id: b, lv: 3, branch: null }));
}
for (const id of ids) {
  const def = WEAPONS[id]!;
  for (const row of def.levels) {
    const reps = [1, 2].map((seed) => runSim({ seed, stageId: "m1_proving", characterId: "shepherd", seconds: Number(process.env.CALIB_SECONDS ?? 300), weapons: loadout(id, row.lv, row.branch) }));
    const ws = reps.map((r) => r.weapons.find((x) => x.id === id)!);
    const fires = ws.reduce((a, x) => a + x.fires, 0);
    const hits = ws.reduce((a, x) => a + x.avgHits * x.fires, 0) / Math.max(1, fires);
    const lpM = ws.reduce((a, x) => a + x.lpMeasured * x.fires, 0) / Math.max(1, fires);
    const tgt = targetLp(row);
    console.log([id, `${row.lv}${row.branch ?? ""}`, `fires ${fires}`, `hits ${hits.toFixed(2)} / ${row.targets}`, `LP ${lpM.toFixed(0)} sheet ${ws[0]!.lpSheet.toFixed(0)} target ${tgt}`, `${((lpM / tgt - 1) * 100).toFixed(0)}%`].join("  "));
  }
}
