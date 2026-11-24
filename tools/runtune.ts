/**
 * 11/24 런 조정 측정: 완주·죽은 스테이지에 더해 무기별(마지막 빌드에 있었는지) 완주, 이동 속도 패시브, 회오리 삭제 수, 런 길이를 본다.
 * node tools/runtune.ts <variant> <시드 수> <시작 시드> <캐릭터,..> [--json 파일]
 * 캐릭터마다 프로세스를 따로 띄워 병렬로 돌리고 --json으로 모은 뒤 --merge 파일.. 로 합친다.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { CAMPAIGN } from "../src/data/index.ts";
import { runCampaign } from "../src/sim/campaign.ts";
import { VARIANTS } from "./variants.ts";

interface Row { ch: string; seed: number; won: boolean; reached: number; minutes: number; weapons: string; hooves: number; bladeVanished: number; clearPops: number }

function summarize(rows: Row[]): void {
  const n = rows.length;
  const won = rows.filter((r) => r.won).length;
  const chars = [...new Set(rows.map((r) => r.ch))];
  console.log(`완주 ${won}/${n} (${((100 * won) / n).toFixed(0)}%) | ${chars.map((c) => `${c} ${rows.filter((r) => r.ch === c && r.won).length}`).join(" · ")}`);
  const dead: Record<number, number> = {};
  for (const r of rows) if (!r.won) dead[r.reached + 1] = (dead[r.reached + 1] ?? 0) + 1;
  const nd = n - won;
  console.log(`죽은 스테이지 (${nd}): ${Object.entries(dead).map(([k, c]) => `${k}:${c}(${((100 * c) / nd).toFixed(0)}%)`).join(" ")}`);
  const wins = rows.filter((r) => r.won);
  if (wins.length) console.log(`완주 런 길이 평균 ${(wins.reduce((a, r) => a + r.minutes, 0) / wins.length).toFixed(1)}분`);
  for (const id of ["whirlwind", "shockwave", "kick", "lasso", "paint_gun", "magnet_totem", "reflect_wall"]) {
    const has = rows.filter((r) => r.weapons.includes(id));
    const late = has.filter((r) => r.reached >= 7);
    const all7 = rows.filter((r) => r.reached >= 7);
    const lateNo = all7.filter((r) => !r.weapons.includes(id));
    const rate = (xs: Row[]) => (xs.length ? `${((100 * xs.filter((r) => r.won).length) / xs.length).toFixed(0)}%` : "-");
    console.log(`  ${id.padEnd(13)} 가진 런 ${String(has.length).padStart(3)} · 스테이지 8 이상 간 런 중 완주: 가짐 ${rate(late)} (${late.length}) / 없음 ${rate(lateNo)} (${lateNo.length})`);
  }
  const hv = rows.filter((r) => r.hooves > 0);
  console.log(`가벼운 발굽 가진 런 ${hv.length}/${n}, 평균 레벨 ${(hv.reduce((a, r) => a + r.hooves, 0) / Math.max(1, hv.length)).toFixed(1)}`);
  const wv = rows.filter((r) => r.weapons.includes("whirlwind"));
  console.log(`회오리 런 판당 삭제 ${(wv.reduce((a, r) => a + r.bladeVanished, 0) / Math.max(1, wv.length)).toFixed(0)}마리`);
}

const args = process.argv.slice(2);
if (args[0] === "--merge") {
  summarize(args.slice(1).flatMap((f) => JSON.parse(readFileSync(f, "utf8")) as Row[]));
} else {
  const v = args[0] ?? "base";
  const n = Number(args[1] ?? "36");
  const start = Number(args[2] ?? "11");
  const chars = (args[3] ?? "shepherd,cue,olly,pale").split(",");
  const ji = args.indexOf("--json");
  VARIANTS[v]!();
  const rows: Row[] = [];
  for (const ch of chars)
    for (let s = start; s < start + n; s++) {
      const r = runCampaign(s, ch, CAMPAIGN, { ballMode: true });
      const last = r.stages.at(-1)!;
      rows.push({
        ch, seed: s, won: r.won, reached: r.stages.filter((x) => x.cleared).length,
        minutes: r.stages.reduce((a, x) => a + x.survived, 0) / 60,
        weapons: r.stages.map((x) => x.weapons).join(" "),
        hooves: Number(/swift_hooves(\d)/.exec(last.passives)?.[1] ?? 0),
        bladeVanished: r.stages.reduce((a, x) => a + x.bladeVanished, 0),
        clearPops: 0,
      });
    }
  if (ji >= 0) writeFileSync(args[ji + 1]!, JSON.stringify(rows));
  else summarize(rows);
}
