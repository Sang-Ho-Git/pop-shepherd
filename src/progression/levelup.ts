import { RULES } from "../core/rules.ts";
import type { Card, Game, WeaponInstance } from "../core/types.ts";
import { lp, PASSIVES, SHOP, WEAPONS } from "../data/index.ts";
import { BRANCH_LEVEL, MAX_LEVEL, makeWeapon, weaponLevel } from "../weapons/weapons.ts";
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
/** 진화 카드 조건: Lv7, 진화 짝 패시브를 가지고 있고, 그 패시브의 동작이 있다 */
export function canEvolve(g: Game, id: string): boolean {
  const w = g.weapons.find((x) => x.def.id === id);
  const need = w?.def.evolvesWith;
  if (!w || w.level.lv !== MAX_LEVEL || !need || !PASSIVES[need]?.implemented) return false;
  return (g.player.passives[need] ?? 0) > 0;
}

/** Lv5 이상인 가진 무기의 진화 짝인데 아직 없는 패시브인지 */
export function needsPartner(g: Game, passiveId: string): boolean {
  if ((g.player.passives[passiveId] ?? 0) > 0) return false;
  return g.weapons.some((w) => w.def.evolvesWith === passiveId && (w.level.lv === "evo" || w.level.lv >= 5));
}

export function candidates(g: Game): Record<"weaponUp" | "newWeapon" | "passiveUp" | "newPassive", Card[]> {
  const owned = new Set(g.weapons.map((w) => w.def.id));
  const p = g.player;
  const ups: Card[] = [];
  for (const w of g.weapons) {
    const lv = w.level.lv;
    if (lv === "evo") continue;
    if (lv < MAX_LEVEL) {
      // Lv3 → Lv4 카드는 한 장이고, 고르는 순간 갈래 선택 창이 뜬다 (기획: 두 장이면 3칸 중 2칸을 차지한다)
      ups.push({ kind: "weaponUp", id: w.def.id });
    }
    // 진화는 레벨업 카드가 아니라 정비 상점의 진화 상자로 받는다 (기획서)
  }
  return {
    weaponUp: ups,
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
            .filter((d) => d.implemented && (!d.ballOnly || g.ballMode) && p.passives[d.id] === undefined)
            .map((d) => ({ kind: "newPassive", id: d.id }) as Card)
        : [],
  };
}

/** 카드 3장 뽑기: 종류를 가중치로 고르고 그 안에서 하나, 중복 없이. 후보가 모자라면 채움 카드(회복, 골드)로 채운다. */
export function drawCards(g: Game): Card[] {
  const pool = candidates(g);
  const kinds = Object.keys(pool) as (keyof typeof pool)[];
  const out: Card[] = [];
  while (out.length < RULES.cards.count) {
    const live = kinds.filter((k) => pool[k].length > 0);
    if (live.length === 0) {
      out.push(out.some((c) => c.kind === "heal") ? { kind: "gold" } : { kind: "heal" });
      continue;
    }
    const k = g.rng.weighted(live, live.map((x) => RULES.cards.weights[x]));
    const list = pool[k];
    // Lv5 이상 무기의 진화 짝 패시브가 없으면 그 패시브 카드 가중치 2배 (진화 직전에 막히지 않게)
    const i = g.rng.weighted(
      list.map((_, j) => j),
      list.map((c) => (c.kind === "newPassive" && needsPartner(g, c.id) ? RULES.cards.partnerMul : 1)),
    );
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
      const next = w.level.lv + 1;
      const branch = next === BRANCH_LEVEL ? (c.branch ?? (g.chooseBranch ?? botChooseBranch)(w, g)) : next > BRANCH_LEVEL ? w.level.branch : null;
      if (next >= BRANCH_LEVEL && !branch) throw new Error(`${c.id}: Lv${next}은 갈래가 필요함`);
      w.level = weaponLevel(w.def, next, branch);
      break;
    }
    case "evolve": {
      const w = g.weapons.find((x) => x.def.id === c.id);
      if (!w || !canEvolve(g, c.id)) throw new Error(`${c.id}: 진화 조건이 안 됨`);
      w.level = weaponLevel(w.def, "evo", w.level.branch);
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
    case "gold":
      g.player.gold += SHOP.fillerGold;
      break;
  }
}

/** 봇의 갈래 선택: 시트 Lv7 발사력(LP)이 높은 쪽, 같으면 A */
export function botChooseBranch(w: WeaponInstance, _g: Game): "A" | "B" {
  return lp(weaponLevel(w.def, MAX_LEVEL, "B")) > lp(weaponLevel(w.def, MAX_LEVEL, "A")) ? "B" : "A";
}

/** 봇이 적극적으로 모으는 무기 수 */
export const BOT_WEAPON_TARGET = 4;

/**
 * 기본(봇) 카드 선택: 진화 > 보유 무기 강화(레벨 낮은 것부터)·새 무기(4개까지)·진화 짝 패시브와 털옷 > 그 밖의 패시브 > 회복.
 * 체력이 절반 아래면 회복이 먼저.
 * 난수를 쓰지 않는다.
 */
export function botChooseCard(cards: Card[], g: Game): number {
  let best = 0;
  for (let i = 1; i < cards.length; i++) if (botCardScore(cards[i] as Card, g) > botCardScore(cards[best] as Card, g)) best = i;
  return best;
}

/** 봇이 카드(또는 상점 품목) 하나에 매기는 점수. 0 이하는 원하지 않음. */
export function botCardScore(c: Card, g: Game): number {
    switch (c.kind) {
      case "weaponUp": {
        const w = g.weapons.find((x) => x.def.id === c.id);
        const lv = typeof w?.level.lv === "number" ? w.level.lv : 0;
        return 100 - lv;
      }
      case "evolve":
        return 150;
      case "newWeapon":
        // 무기는 4개까지 적극적으로, 그 뒤로는 패시브보다 뒤. 충격파(둘레를 밀어내는 방어)는 먼저.
        // 시뮬: 무기가 7종이 되자 봇이 충격파를 놓쳐 완주가 9/12 → 4/12로 떨어졌다.
        return (g.weapons.length < BOT_WEAPON_TARGET ? 90 : 40) + (c.id === "shockwave" ? 15 : 0);
      case "passiveUp":
      case "newPassive": {
        const lv = g.player.passives[c.id] ?? 0;
        // 가진 무기의 진화 짝, 그리고 털옷(체력·방어)은 무기 강화만큼 중요하게
        const partner = g.weapons.some((w) => w.def.evolvesWith === c.id);
        // 털옷은 무기 강화보다 먼저 (생존의 바탕)
        if (c.id === "thick_fleece") return 105 - lv;
        // 가벼운 발굽(이동 속도): 적이 빨라지는 뒤 스테이지(8~)에서는 진화 짝만큼, 앞에서는 낮게
        if (c.id === "swift_hooves") return (stageNo(g) >= RULES.cards.botSpeedFrom ? 88 : 45) - lv;
        if (partner) return (c.kind === "newPassive" ? 95 : 85) - lv;
        return (c.kind === "newPassive" ? 50 : 60) - lv;
      }
      case "heal":
        return g.player.hp < g.player.maxHp * 0.5 ? 200 : 0;
      case "gold":
        return 1;
    }
}

/** 지금 스테이지 번호 (stage08 → 8, 모르면 0) */
function stageNo(g: Game): number {
  return Number(/(\d+)$/.exec(g.stage?.id ?? "")?.[1] ?? 0);
}

export function cardLabel(c: Card): string {
  if (c.kind === "heal" || c.kind === "gold") return c.kind;
  return c.kind === "weaponUp" && c.branch ? `${c.kind}:${c.id}:${c.branch}` : `${c.kind}:${c.id}`;
}

/**
 * 사람이 고른 카드를 적용하고 선택지에서 뺀다 (화면 모드).
 * Lv3 무기 강화는 branch를 함께 넘긴다 (갈래 선택 창).
 */
export function resolveChoice(g: Game, index: number, branch?: "A" | "B"): void {
  const ch = g.choices.shift();
  if (!ch) throw new Error("고를 선택지가 없음");
  const card = ch.cards[index];
  if (!card) throw new Error(`카드 ${index} 없음`);
  const c = card.kind === "weaponUp" && branch ? { ...card, branch } : card;
  applyCard(g, c);
  if (ch.kind === "levelup") g.events.push({ type: "level-up", level: ch.level ?? g.player.level, picked: cardLabel(c) });
}

/**
 * 화면 모드: 맨 앞 선택지를 보여 주기 전에 카드가 아직 유효한지 확인한다.
 * 보스 상자는 3장짜리 선택을 한꺼번에 쌓아 두므로, 앞에서 같은 무기를 올리면 뒤 카드가 Lv7을 넘는 등 무효가 된다
 * (11/23 밤 점검: magnet_totem Lv8 오류). 무효인 카드가 있으면 그 선택지를 지금 상태로 다시 뽑는다.
 * 다시 뽑을 것이 없는 상자 선택지는 체력 회복으로 바꾸고 넘긴다.
 */
export function validateFrontChoice(g: Game): void {
  for (;;) {
    const ch = g.choices[0];
    if (!ch) return;
    const pool = candidates(g);
    const valid = (c: Card): boolean => {
      if (c.kind === "heal" || c.kind === "gold") return true;
      if (c.kind === "evolve") return true;
      return pool[c.kind].some((x) => "id" in x && x.id === c.id);
    };
    if (ch.cards.every(valid)) return;
    if (ch.kind === "chest") {
      const owned: Card[] = [...pool.weaponUp, ...pool.passiveUp];
      const cards: Card[] = [];
      while (cards.length < RULES.cards.count && owned.length > 0) {
        const i = Math.floor(g.rng.next() * owned.length);
        cards.push(owned[i] as Card);
        owned.splice(i, 1);
      }
      if (cards.length === 0) {
        g.player.hp = Math.min(g.player.maxHp, g.player.hp + g.player.maxHp * RULES.drops.chestHealFrac);
        g.choices.shift();
        continue;
      }
      ch.cards = cards;
    } else ch.cards = drawCards(g);
    return;
  }
}

/** 이 카드를 고르면 갈래 선택 창이 떠야 하는지 (Lv3 → Lv4) */
export function needsBranch(g: Game, c: Card): boolean {
  if (c.kind !== "weaponUp" || c.branch) return false;
  const w = g.weapons.find((x) => x.def.id === c.id);
  return w?.level.lv === BRANCH_LEVEL - 1;
}

/** 누적 경험치가 다음 레벨 문턱을 넘을 때마다 카드를 뽑아 하나 고른다. */
export function checkLevelUp(g: Game): void {
  const p = g.player;
  while (g.stats.xp >= xpTotalFor(p.level + 1)) {
    // 화면 모드: 한 번에 한 장씩 사람에게 묻는다. 고르기 전에는 다음 레벨업을 쌓지 않는다.
    if (g.manualChoices) {
      if (g.choices.length > 0) return;
      p.level++;
      g.choices.push({ kind: "levelup", cards: drawCards(g), level: p.level });
      return;
    }
    p.level++;
    const cards = drawCards(g);
    const pick = (g.chooseCard ?? botChooseCard)(cards, g);
    const card = cards[pick] ?? cards[0];
    if (!card) break;
    applyCard(g, card);
    g.events.push({ type: "level-up", level: p.level, picked: cardLabel(card) });
  }
}
