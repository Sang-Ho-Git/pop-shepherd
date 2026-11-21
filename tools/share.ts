/**
 * 팝을 누가 일으켰는지 비교: 검증장에서 무기 하나(W)만 바꿔 끼우고, 나머지는 충격파·토템 Lv3.
 *   node tools/share.ts --weapons kick:3,paint_gun:3 [--ball] [--variant noPush] [--seeds 4]
 * 출력: W가 일으킨 팝 몫, 공 몫, 분당 팝, 사망
 */
import { runSim } from "../src/sim/run.ts";
import { VARIANTS } from "./variants.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}
const ballMode = process.argv.includes("--ball");
const seeds = Number(arg("seeds", "4"));
VARIANTS[arg("variant", "base")]!();
for (const spec of arg("weapons", "kick:3").split(",")) {
  const [id, lvs = "3"] = spec.split(":");
  const m = /^(\d+|evo)([AB]?)$/.exec(lvs)!;
  const lv = m[1] === "evo" ? ("evo" as const) : Number(m[1]);
  const branch = m[2] || null;
  let total = 0;
  let mine = 0;
  let ball = 0;
  let dead = 0;
  let secs = 0;
  for (let s = 1; s <= seeds; s++) {
    const r = runSim({ seed: s, stageId: "m1_proving", characterId: "shepherd", ballMode, weapons: [{ id: id!, lv, branch }, { id: "shockwave", lv: 3 }, { id: "magnet_totem", lv: 3 }] });
    const by = r.popsBy;
    total += Object.values(by).reduce((a, b) => a + b, 0);
    mine += by[id!] ?? 0;
    ball += by.ball ?? 0;
    if (r.died) dead++;
    secs += r.survived;
  }
  const pct = (x: number): string => `${Math.round((x / Math.max(1, total)) * 100)}%`.padStart(4);
  console.log(`${spec.padEnd(16)} ${id} 몫 ${pct(mine)}  공 몫 ${pct(ball)}  분당 팝 ${((total / secs) * 60).toFixed(0).padStart(3)}  사망 ${dead}/${seeds}`);
}
