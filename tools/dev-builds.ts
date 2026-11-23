/**
 * 시험 진입로(#stageN) 빌드 만들기: 캐릭터마다 봇 런(색 공)을 돌려, 스테이지 N 시작 때 실제로 넘어온 상태를 저장한다.
 * 끝까지 깬 런 3개 중, 그 스테이지 15 빌드로 스테이지 15를 6번 돌려 가장 잘 깬 런을 고른다 (시험 판이 한 빌드의 운에 치우치지 않게).
 * 결과: web/dev-builds.json
 *   node tools/dev-builds.ts
 *   node tools/dev-builds.ts --pool 5 --out <파일>   스테이지 15 시작 빌드를 캐릭터마다 5개씩 (tools/stage15.ts --pool 용)
 */
import { writeFileSync } from "node:fs";
import { CAMPAIGN } from "../src/data/index.ts";
import { step } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import { botInput } from "../src/sim/bot.ts";
import { runCampaign, startStage } from "../src/sim/campaign.ts";
import type { Carry } from "../src/sim/campaign.ts";

const argv = process.argv;
const poolN = argv.includes("--pool") ? Number(argv[argv.indexOf("--pool") + 1]) : 0;
if (poolN > 0) {
  const pool: Record<string, Carry[]> = {};
  for (const ch of ["shepherd", "cue", "olly", "pale"]) {
    pool[ch] = [];
    for (let seed = 100; seed < 200 && pool[ch].length < poolN; seed++) {
      let c15: Carry | null = null;
      const r = runCampaign(seed, ch, CAMPAIGN, { ballMode: true, onCarry: (i, c) => { if (i + 1 === CAMPAIGN.length) c15 = structuredClone(c); } });
      if (r.stages.length === CAMPAIGN.length && c15) pool[ch].push(c15);
    }
    console.log(`${ch}: ${pool[ch].length}개`);
  }
  writeFileSync(argv[argv.indexOf("--out") + 1]!, JSON.stringify(pool));
  process.exit(0);
}
const out: Record<string, Record<number, Carry>> = {};
/** 스테이지 15를 이 빌드로 n번 (체력은 가득) 돌려 깬 횟수 */
function score15(ch: string, carry: Carry, n = 6): number {
  let won = 0;
  for (let s = 0; s < n; s++) {
    const c = structuredClone(carry);
    const g = startStage(5000 + s, ch, CAMPAIGN[CAMPAIGN.length - 1]!, c, null, false, true);
    g.player.hp = g.player.maxHp;
    for (let t = 0; t < RULES.boss.hardLimit * RULES.tickHz && (g.phase === "play" || g.phase === "wrapup"); t++) step(g, botInput(g));
    if (g.phase === "cleared") won++;
  }
  return won;
}
for (const ch of ["shepherd", "cue", "olly", "pale"]) {
  let best: { got: Record<number, Carry>; score: number; seed: number } | null = null;
  let found = 0;
  for (let seed = 11; seed < 80 && found < 3; seed++) {
    const got: Record<number, Carry> = {};
    const r = runCampaign(seed, ch, CAMPAIGN, { ballMode: true, onCarry: (i, c) => (got[i + 1] = structuredClone(c)) });
    // 끝까지 깬 런만 후보 (마지막 스테이지까지 왔어도 약한 빌드가 고르면 시험 판이 늘 지는 쪽으로 치우친다)
    if (!r.won) continue;
    found++;
    const sc = score15(ch, got[CAMPAIGN.length]!);
    if (!best || sc > best.score) best = { got, score: sc, seed };
  }
  if (!best) continue;
  out[ch] = best.got;
  const b = best.got[CAMPAIGN.length]!;
  console.log(`${ch}: 시드 ${best.seed} (스테이지 15 ${best.score}/6), 시작 Lv${b.level} · ${b.weapons.map((w) => `${w.id}${w.lv}`).join(" ")}`);
}
writeFileSync(new URL("../web/dev-builds.json", import.meta.url), JSON.stringify(out) + "\n");
