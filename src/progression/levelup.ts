import { RULES } from "../core/rules.ts";
import type { Card, Game } from "../core/types.ts";
import { PASSIVES, WEAPONS } from "../data/index.ts";
import { MAX_IMPLEMENTED_LEVEL, makeWeapon, weaponLevel } from "../weapons/weapons.ts";
import { addPassive } from "./passives.ts";

/** 레벨 L에서 L+1로 가는 데 필요한 경험치 */
export function xpToNext(level: number): number {
  return RULES.xp.base + RULES.xp.growth * (level - 1);
}

/** 레벨 L에 도달하는 데 필요한 누적 경험치 */
export function xpTotalFor(level: number): number {
  let t = 0;
  for (let l = 1; l < level; l++) t += xpToNext(l);
  return t;
}

/** 지금 뽑을 수 있는 카드 후보 (종류별) */
export function candidates(g: Game): Record<"weaponUp" | "newWeapon" | "passiveUp" | "newPassive", Card[]> {
  const owned = new Set(g.weapons.map((w) => w.def.id));
  const p = g.player;
  return {
    weaponUp: g.weapons
      .filter((w) => typeof w.level.lv === "number" && w.level.lv < MAX_IMPLEMENTED_LEVEL)
      .map((w) => ({ kind: "weaponUp", id: w.def.id }) as Card),
    newWeapon:
      g.weapons.length < RULES.cards.weaponSlots
        ? Object.values(WEAPONS)
            .filter((d) => d.implemented && !owned.has(d.id))
            .map((d) => ({ kind: "newWeapon", id: d.id }) as Card)
        : [],
    passiveUp: Object.entries(p.passives)
      .filter(([id, lv]) => lv < (PASSIVES[id]?.maxLevel ?? 0))
      .map(([id]) => ({ kind: "passiveUp", id }) as Card),
    newPassive:
      Object.keys(p.passives).length < RULES.cards.passiveSlots
        ? Object.values(PASSIVES)
            .filter((d) => d.implemented && p.passives[d.id] === undefined)
            .map((d) => ({ kind: "newPassive", id: d.id }) as Card)
        : [],
  };
}

/** 카드 3장 뽑기: 종류를 가중치로 고르고 그 안에서 하나, 중복 없이. 후보가 모자라면 회복 카드로 채운다. */
export function drawCards(g: Game): Card[] {
  const pool = candidates(g);
  const kinds = Object.keys(pool) as (keyof typeof pool)[];
  const out: Card[] = [];
  while (out.length < RULES.cards.count) {
    const live = kinds.filter((k) => pool[k].length > 0);
    if (live.length === 0) {
      out.push({ kind: "heal" });
      continue;
    }
    const k = g.rng.weighted(live, live.map((x) => RULES.cards.weights[x]));
    const list = pool[k];
    const i = Math.floor(g.rng.next() * list.length);
    out.push(list[i] as Card);
    list.splice(i, 1);
  }
  return out;
}

export function applyCard(g: Game, c: Card): void {
  switch (c.kind) {
    case "weaponUp": {
      const w = g.weapons.find((x) => x.def.id === c.id);
      if (!w || typeof w.level.lv !== "number") throw new Error(`${c.id}: 보유하지 않은 무기`);
      w.level = weaponLevel(w.def, w.level.lv + 1);
      break;
    }
    case "newWeapon": {
      const def = WEAPONS[c.id];
      if (!def) throw new Error(`알 수 없는 무기: ${c.id}`);
      g.weapons.push(makeWeapon(def, 1));
      break;
    }
    case "passiveUp":
    case "newPassive":
      addPassive(g, c.id);
      break;
    case "heal":
      g.player.hp = Math.min(g.player.maxHp, g.player.hp + g.player.maxHp * RULES.cards.fillerHealFrac);
      break;
  }
}

/**
 * 기본(봇) 카드 선택: 보유 무기 강화(레벨 낮은 것부터) > 새 무기 > 보유 패시브 강화 > 새 패시브 > 회복.
 * 난수를 쓰지 않는다.
 */
export function botChooseCard(cards: Card[], g: Game): number {
  const score = (c: Card): number => {
    switch (c.kind) {
      case "weaponUp": {
        const w = g.weapons.find((x) => x.def.id === c.id);
        return 100 - (typeof w?.level.lv === "number" ? w.level.lv : 0);
      }
      case "newWeapon":
        return 90;
      case "passiveUp":
        return 60 - (g.player.passives[c.id] ?? 0);
      case "newPassive":
        return 50;
      case "heal":
        return g.player.hp < g.player.maxHp * 0.5 ? 200 : 0;
    }
  };
  let best = 0;
  for (let i = 1; i < cards.length; i++) if (score(cards[i] as Card) > score(cards[best] as Card)) best = i;
  return best;
}

export function cardLabel(c: Card): string {
  return c.kind === "heal" ? "heal" : `${c.kind}:${c.id}`;
}

/** 누적 경험치가 다음 레벨 문턱을 넘을 때마다 카드를 뽑아 하나 고른다. */
export function checkLevelUp(g: Game): void {
  const p = g.player;
  while (g.stats.xp >= xpTotalFor(p.level + 1)) {
    p.level++;
    const cards = drawCards(g);
    const pick = (g.chooseCard ?? botChooseCard)(cards, g);
    const card = cards[pick] ?? cards[0];
    if (!card) break;
    applyCard(g, card);
    g.events.push({ type: "level-up", level: p.level, picked: cardLabel(card) });
  }
}
