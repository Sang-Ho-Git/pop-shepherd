import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { character, ENEMIES, META, SHOP, weapon } from "../src/data/index.ts";
import { addPassive } from "../src/progression/passives.ts";
import { applyMeta, buyNode, canBuyNode, coinsForRun, isUnlocked, profileForCoins, totalTreeCost, validateProfile } from "../src/progression/meta.ts";
import { botShop, buy, openShop, priceOf, reroll } from "../src/progression/shop.ts";
import { runCampaign, startStage } from "../src/sim/campaign.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";
import { pops, put, run } from "./helpers.ts";
import { launch } from "../src/world/physics.ts";

function game(gold = 0) {
  const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, weapons: [makeWeapon(weapon("kick"), 1)], leveling: true });
  g.player.gold = gold;
  return g;
}

describe("2.2 정비 상점", () => {
  it("팝은 그 자리에 골드 주머니(터진 적 수 × goldPerPop)를 떨어뜨리고, 가까이 가면 줍는다", () => {
    const g = game();
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    put(g, "red", 528, 400);
    launch(a, 1, 0, 600);
    expect(pops(run(g, 10))[0]?.size).toBe(3);
    expect(g.player.gold).toBe(0);
    expect(g.golds).toHaveLength(1);
    expect(g.golds[0]!.amount).toBeCloseTo(3 * SHOP.goldPerPop);
    g.player.x = g.golds[0]!.x;
    g.player.y = g.golds[0]!.y;
    run(g, 1);
    expect(g.player.gold).toBeCloseTo(3 * SHOP.goldPerPop);
    expect(g.golds).toHaveLength(0);
  });

  it("품목은 slots개 + 회복이고, 사면 골드가 줄고 다음 가격이 오른다", () => {
    const g = game(1000);
    const shop = openShop(g);
    expect(shop.items.length).toBeGreaterThanOrEqual(SHOP.slots);
    expect(shop.items.some((it) => it.kind === "heal")).toBe(true);
    const i = shop.items.findIndex((it) => it.kind !== "heal");
    const price = shop.items[i]!.price;
    buy(g, shop, i);
    expect(g.player.gold).toBe(1000 - price);
    expect(g.player.purchases).toBe(1);
    expect(priceOf(g, "heal")).toBe(Math.round(SHOP.prices.heal * (1 + SHOP.inflation)));
    expect(() => buy(g, shop, i)).toThrow();
  });

  it("골드가 모자라면 살 수 없다. 새로고침은 골드가 들고, 무료 횟수가 있으면 먼저 쓴다", () => {
    const g = game(10);
    const shop = openShop(g, { freeRerolls: 1 });
    expect(() => buy(g, shop, 0)).toThrow(/골드/);
    reroll(g, shop, SHOP.slots);
    expect(g.player.gold).toBe(10);
    expect(() => reroll(g, shop, SHOP.slots)).toThrow(/골드/);
  });

  it("상점은 진화시키지 않는다 (진화는 엘리트·보스의 보물 상자)", () => {
    const g = game(0);
    g.weapons = [makeWeapon(weapon("shockwave"), 7, "B")];
    addPassive(g, "chain_amp");
    const shop = openShop(g);
    expect(shop.evolved).toEqual([]);
    expect(g.weapons[0]!.level.lv).toBe(7);
  });

  it("봇은 살 수 있는 만큼 사고, 골드가 음수가 되지 않는다", () => {
    const g = game(400);
    const res = botShop(g);
    expect(res.bought.length).toBeGreaterThan(0);
    expect(g.player.gold).toBeGreaterThanOrEqual(0);
  });
});

describe("2.3 영구 강화 트리", () => {
  it("2단계는 1단계 3레벨, 가지 끝은 2단계를 다 채워야 열린다", () => {
    let p = {};
    expect(isUnlocked(p, "fleece")).toBe(false);
    for (let i = 0; i < 3; i++) p = buyNode(p, "sturdy");
    expect(isUnlocked(p, "fleece")).toBe(true);
    expect(isUnlocked(p, "second_chance")).toBe(false);
    expect(() => buyNode({}, "second_chance")).toThrow(/잠김/);
    expect(() => validateProfile({ fleece: 1 })).toThrow(/선행/);
    expect(canBuyNode({}, "sturdy", 19)).toBe(false);
  });

  it("능력치 노드는 캐릭터 사본에 더해지고, 원본은 그대로다", () => {
    const base = character("shepherd");
    const { character: ch, specials } = applyMeta(base, { sturdy: 5, fleece: 2, second_chance: 1, strength: 3, thrift: 2 });
    expect(ch.stats.max_hp).toBe(125);
    expect(ch.stats.armor).toBe(2);
    expect(ch.stats.knock_power).toBeCloseTo(1.09);
    expect(ch.stats.gold_find).toBeCloseTo(0.1);
    expect(specials.revives).toBe(1);
    expect(base.stats.max_hp).toBe(100);
  });

  it("전부 채우는 비용은 기획(15~20런)에 맞는 범위이고, 코인이 충분하면 트리가 전부 찬다", () => {
    const total = totalTreeCost();
    expect(total).toBeGreaterThan(1500);
    const full = profileForCoins(total);
    for (const n of META.nodes) expect(full[n.id]).toBe(n.maxLevel);
    expect(coinsForRun(10, 0)).toBe(10 * META.coins.perStage);
  });

  it("첫 수: 시작 무기 Lv2, 두 번째 기회: 한 번 쓰러져도 일어난다", () => {
    const meta = applyMeta(character("shepherd"), profileForCoins(totalTreeCost()));
    const g = startStage(1, "shepherd", "stage01", null, meta);
    expect(g.weapons[0]!.level.lv).toBe(2);
    expect(g.player.revives).toBe(1);
    g.player.hp = 1;
    g.player.iframes = 0;
    // 킥은 앞(+x)을 차므로 뒤에 둔다
    put(g, "red", g.player.x - 25, g.player.y, { moving: true });
    g.spawnTimer = 9999;
    const events = run(g, 5);
    expect(events.some((e) => e.type === "player-revive")).toBe(true);
    expect(g.player.dead).toBe(false);
    expect(g.player.revives).toBe(0);
  });

  it("런이 끝나면 코인을 받는다", { timeout: 120_000 }, () => {
    const r = runCampaign(3, "shepherd", ["stage01"]);
    expect(r.coins).toBeGreaterThan(0);
  });
});
