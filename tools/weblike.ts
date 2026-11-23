/**
 * 웹 흐름 그대로 (화면 모드: 카드를 한 장씩 고름) 스테이지 1~7을 돌려, 시뮬(quick.ts)과 결과가 같은지 본다.
 *   node tools/weblike.ts <character> [manual 0|1]
 */
import { step } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import { CAMPAIGN } from "../src/data/index.ts";
import { botChooseBranch, botChooseCard, needsBranch, resolveChoice, validateFrontChoice } from "../src/progression/levelup.ts";
import { botShop } from "../src/progression/shop.ts";
import { botInput } from "../src/sim/bot.ts";
import { carryOf, startStage } from "../src/sim/campaign.ts";
import type { Carry } from "../src/sim/campaign.ts";

const ch = process.argv[2] ?? "shepherd";
const manual = (process.argv[3] ?? "1") === "1";
let cleared = 0, lv = 0;
const n = 12;
for (let s = 0; s < n; s++) {
  let carry: Carry | null = null;
  for (let i = 0; i < 7; i++) {
    const g = startStage((47 + s) * 100 + i, ch, CAMPAIGN[i]!, carry, null, manual, true);
    const survive = (g.stage!.clear ?? "survive") === "survive";
    const limit = survive ? g.stage!.duration + RULES.stage.wrapUpSeconds : RULES.boss.hardLimit;
    for (let t = 0; t < limit * RULES.tickHz + 2 && (g.phase === "play" || g.phase === "wrapup"); t++) {
      step(g, botInput(g));
      while (g.choices.length > 0) {
        validateFrontChoice(g);
        const c = g.choices[0];
        if (!c) break;
        const k = botChooseCard(c.cards, g);
        const card = c.cards[k]!;
        if (needsBranch(g, card) && card.kind === "weaponUp") {
          const w = g.weapons.find((x) => x.def.id === card.id)!;
          resolveChoice(g, k, botChooseBranch(w, g));
        } else resolveChoice(g, k);
      }
    }
    if (g.phase !== "cleared") {
      lv += g.player.level;
      break;
    }
    cleared++;
    botShop(g);
    carry = carryOf(g);
    if (i === 6) lv += g.player.level;
  }
}
console.log(`${ch} 화면 모드 ${manual}: 1~7 클리어 평균 ${(cleared / n).toFixed(2)} · 끝 레벨 ${(lv / n).toFixed(1)}`);
