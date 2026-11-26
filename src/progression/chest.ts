import { RULES } from "../core/rules.ts";
import type { Card, Chest, Game } from "../core/types.ts";
import { applyCard, botChooseCard, canEvolve, candidates, cardLabel, needsBranch } from "./levelup.ts";

/**
 * 보물 상자 (엘리트·보스 드롭).
 * - 엘리트 상자: 진화할 무기가 있으면 하나 진화, 없으면 가진 무기·패시브 강화 1개.
 * - 보스 상자: 진화할 무기를 전부 진화하고, 강화 3개.
 * 강화는 가진 것 중에서 3장을 뽑아 1장을 고른다 (레벨업과 같은 선택 규칙). 고를 게 없으면 회복.
 */
export function openChest(g: Game, chest: Chest): { evolved: string[]; picked: string[] } {
  const evolved: string[] = [];
  for (const w of g.weapons) {
    if (!canEvolve(g, w.def.id)) continue;
    applyCard(g, { kind: "evolve", id: w.def.id });
    evolved.push(w.def.id);
    g.stats.evolutions++;
    g.events.push({ type: "evolve", weapon: w.def.id });
    if (chest.kind === "elite") break;
  }
  const picks = chest.kind === "boss" ? RULES.drops.chestPicksBoss : evolved.length > 0 ? 0 : RULES.drops.chestPicksElite;
  const picked: string[] = [];
  for (let k = 0; k < picks; k++) {
    const pool = candidates(g);
    const owned: Card[] = [...pool.weaponUp, ...pool.passiveUp];
    if (owned.length === 0) {
      g.player.hp = Math.min(g.player.maxHp, g.player.hp + g.player.maxHp * RULES.drops.chestHealFrac);
      picked.push("heal");
      continue;
    }
    const cards: Card[] = [];
    while (cards.length < RULES.cards.count && owned.length > 0) {
      const i = Math.floor(g.rng.next() * owned.length);
      cards.push(owned[i] as Card);
      owned.splice(i, 1);
    }
    // 11/25: 화면 모드에서도 상자는 창을 띄우지 않고 바로 연다 (3장 중 봇 점수가 가장 높은 것).
    // 보스 상자 3픽 + 보스 경험치 레벨업이 한꺼번에 창을 연달아 띄웠다 (실플레이 피드백). 보상은 화면에 목록으로 보여 준다.
    const card = cards[(g.chooseCard ?? botChooseCard)(cards, g)] ?? (cards[0] as Card);
    // 화면 모드에서 Lv3→Lv4 무기 강화가 뽑혔으면 갈래를 자동으로 정하지 않고, 갈래 선택 창을 띄운다
    if (g.manualChoices && needsBranch(g, card)) g.choices.push({ kind: "chest", cards: [card] });
    else applyCard(g, card);
    picked.push(cardLabel(card));
  }
  g.stats.chestsOpened++;
  g.events.push({ type: "chest-open", kind: chest.kind, evolved, picked });
  return { evolved, picked };
}
