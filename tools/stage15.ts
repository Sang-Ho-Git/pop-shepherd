/**
 * 마지막 스테이지만 빠르게: 시험 진입로 빌드(web/dev-builds.json, 봇 런의 실제 스테이지 15 시작 상태)로 스테이지 15를 여러 번 돌린다.
 *   node tools/stage15.ts [variant] [판 수] [스테이지 번호]
 * 체력은 넘어온 값 그대로 (가득 채우지 않음). 클리어율, 죽은 시각, 보스 남은 체력, 받은 피해(특수 적 비율)를 본다.
 */
import { readFileSync } from "node:fs";
import { step } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import { CAMPAIGN } from "../src/data/index.ts";
import { botInput } from "../src/sim/bot.ts";
import { startStage } from "../src/sim/campaign.ts";
import type { Carry } from "../src/sim/campaign.ts";
import { VARIANTS } from "./variants.ts";

const pos = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--pool");
const variant = pos[0] ?? "base";
const n = Number(pos[1] ?? "20");
const stageNo = Number(pos[2] ?? "15");
VARIANTS[variant]!();
const builds = JSON.parse(readFileSync(new URL("../web/dev-builds.json", import.meta.url), "utf8")) as Record<string, Record<string, Carry>>;
const id = CAMPAIGN[stageNo - 1]!;
// --pool <파일>: 캐릭터마다 여러 빌드를 번갈아 쓴다 (빌드 하나에 결과가 쏠리지 않게, 스테이지 15만)
const poolPath = process.argv.includes("--pool") ? process.argv[process.argv.indexOf("--pool") + 1] : null;
const pool = poolPath ? (JSON.parse(readFileSync(poolPath, "utf8")) as Record<string, Carry[]>) : null;
const parts: string[] = [];
let total = 0;
for (const ch of ["shepherd", "cue", "olly", "pale"]) {
  const one = builds[ch]![String(stageNo)]!;
  let won = 0, deathT = 0, deaths = 0, bossLeft = 0, special = 0, dmg = 0, bp = 0, cp = 0;
  for (let s = 0; s < n; s++) {
    const list = pool?.[ch];
    const carry = list && list.length ? list[s % list.length]! : one;
    const g = startStage(1000 + s, ch, id, structuredClone(carry), null, false, true);
    const limit = (g.stage!.clear ?? "survive") === "survive" ? g.stage!.duration + RULES.stage.wrapUpSeconds : RULES.boss.hardLimit;
    for (let t = 0; t < limit * RULES.tickHz && (g.phase === "play" || g.phase === "wrapup"); t++) step(g, botInput(g));
    if (g.phase === "cleared") won++;
    else if (g.player.dead || g.player.hp <= 0) {
      deaths++;
      deathT += g.time;
      const b = g.enemies.find((e) => e.rank === "boss" && !e.dead);
      bossLeft += b ? b.hp / b.maxHp : 0;
    }
    bp += g.stats.ballPops;
    cp += g.stats.cushionPops;
    special += g.stats.damageFromSpecial;
    dmg += g.stats.damageTaken;
  }
  total += won;
  parts.push(`${ch} ${won}/${n}${deaths ? ` (죽음 ${(deathT / deaths).toFixed(0)}초, 보스 ${((100 * bossLeft) / deaths).toFixed(0)}% 남김)` : ""} 특수피해 ${((100 * special) / Math.max(1, dmg)).toFixed(0)}% 쿠션팝 ${((100 * cp) / Math.max(1, bp)).toFixed(0)}%`);
}
console.log(`${variant} 스테이지${stageNo}: ${total}/${n * 4} | ${parts.join(" · ")}`);
