import { RULES } from "../core/rules.ts";
import type { Card, Game } from "../core/types.ts";
import { SHOP } from "../data/index.ts";
import type { ShopKind } from "../data/index.ts";
import { applyCard, botCardScore, candidates } from "./levelup.ts";

/**
 * 2.2 정비 상점 (스테이지 사이).
 * - 진화는 상점이 아니라 엘리트·보스의 보물 상자로 받는다 (progression/chest.ts).
 * - 품목 slots개: 무기 강화·새 무기·패시브 강화·새 패시브·회복. 레벨업 카드와 같은 가중치로 뽑는다.
 * - 가격은 한 번 살 때마다 inflation만큼 복리로 오른다 (런 전체에서 센다).
 * - 새로고침: rerollCost 골드, 영구 강화 흥정으로 무료 횟수.
 */
export interface ShopItem {
  card: Card;
  kind: ShopKind;
  price: number;
  sold: boolean;
}

export interface ShopState {
  items: ShopItem[];
  /** 이 상점에서 남은 무료 새로고침 */
  freeRerolls: number;
  /** 열 때 받은 진화 상자 */
  evolved: string[];
}

export interface ShopOptions {
  /** 영구 강화 단골: 품목 +1 */
  extraSlots?: number;
  /** 영구 강화 흥정: 무료 새로고침 */
  freeRerolls?: number;
}

export function priceOf(g: Game, kind: ShopKind): number {
  return Math.round(SHOP.prices[kind] * Math.pow(1 + SHOP.inflation, g.player.purchases));
}

function kindOf(c: Card): ShopKind {
  if (c.kind === "weaponUp" || c.kind === "newWeapon" || c.kind === "passiveUp" || c.kind === "newPassive" || c.kind === "heal") return c.kind;
  throw new Error(`상점에 없는 품목: ${c.kind}`);
}

/** 품목 뽑기: 레벨업 카드와 같은 가중치, 중복 없이, 모자라면 회복 */
export function rollItems(g: Game, slots: number): ShopItem[] {
  const pool = candidates(g);
  const kinds = Object.keys(pool) as (keyof typeof pool)[];
  const cards: Card[] = [];
  while (cards.length < slots) {
    const live = kinds.filter((k) => pool[k].length > 0);
    if (live.length === 0) {
      if (cards.some((c) => c.kind === "heal")) break;
      cards.push({ kind: "heal" });
      continue;
    }
    const k = g.rng.weighted(live, live.map((x) => RULES.cards.weights[x]));
    const list = pool[k];
    const i = Math.floor(g.rng.next() * list.length);
    cards.push(list[i] as Card);
    list.splice(i, 1);
  }
  // 회복은 늘 살 수 있게 한 칸 더 둔다
  if (!cards.some((c) => c.kind === "heal")) cards.push({ kind: "heal" });
  return cards.map((card) => ({ card, kind: kindOf(card), price: priceOf(g, kindOf(card)), sold: false }));
}

/** 상점을 연다: 진화 상자를 먼저 열고 품목을 뽑는다 */
export function openShop(g: Game, opts: ShopOptions = {}): ShopState {
  return { items: rollItems(g, SHOP.slots + (opts.extraSlots ?? 0)), freeRerolls: opts.freeRerolls ?? 0, evolved: [] };
}

export function buy(g: Game, shop: ShopState, index: number): void {
  const item = shop.items[index];
  if (!item || item.sold) throw new Error("살 수 없는 품목");
  if (g.player.gold < item.price) throw new Error("골드가 모자람");
  g.player.gold -= item.price;
  g.player.purchases++;
  item.sold = true;
  if (item.card.kind === "heal") {
    g.player.hp = Math.min(g.player.maxHp, g.player.hp + g.player.maxHp * SHOP.healFrac);
  } else {
    applyCard(g, item.card);
  }
  // 산 뒤 다른 품목 가격도 오른다
  for (const it of shop.items) if (!it.sold) it.price = priceOf(g, it.kind);
}

export function reroll(g: Game, shop: ShopState, slots: number): void {
  if (shop.freeRerolls > 0) shop.freeRerolls--;
  else {
    if (g.player.gold < SHOP.rerollCost) throw new Error("골드가 모자람");
    g.player.gold -= SHOP.rerollCost;
  }
  shop.items = rollItems(g, slots);
}

/** 봇이 상점에서 사는 규칙: 원하는 품목을 점수 순으로 살 수 있는 만큼, 원하는 게 없으면 새로고침 한 번 */
export function botShop(g: Game, opts: ShopOptions = {}): { bought: string[]; evolved: string[] } {
  const slots = SHOP.slots + (opts.extraSlots ?? 0);
  const shop = openShop(g, opts);
  const bought: string[] = [];
  let rerolled = 0;
  const score = (it: ShopItem): number => {
    if (it.card.kind === "heal") return g.player.hp < g.player.maxHp * 0.6 ? 200 : g.player.hp < g.player.maxHp * 0.85 ? 30 : 0;
    return botCardScore(it.card, g);
  };
  for (;;) {
    const want = shop.items
      .map((it, i) => ({ it, i, s: score(it) }))
      .filter((x) => !x.it.sold && x.s > 0 && x.it.price <= g.player.gold)
      .sort((a, b) => b.s - a.s);
    const top = want[0];
    if (top) {
      buy(g, shop, top.i);
      bought.push(top.it.card.kind === "heal" ? "heal" : `${top.it.card.kind}:${"id" in top.it.card ? top.it.card.id : ""}`);
      continue;
    }
    const cheapest = Math.min(...Object.values(SHOP.prices).map((p) => Math.round(p * Math.pow(1 + SHOP.inflation, g.player.purchases))));
    const canReroll = shop.freeRerolls > 0 || g.player.gold >= SHOP.rerollCost + cheapest;
    if (rerolled < 1 + (opts.freeRerolls ?? 0) && canReroll) {
      reroll(g, shop, slots);
      rerolled++;
      continue;
    }
    break;
  }
  return { bought, evolved: shop.evolved };
}
