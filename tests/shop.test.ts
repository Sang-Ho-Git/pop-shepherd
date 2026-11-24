import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { character, ENEMIES, META, SHOP, weapon } from "../src/data/index.ts";
import { addPassive } from "../src/progression/passives.ts";
import { applyMeta, buyNode, canBuyNode, coinsForRun, isUnlocked, runCoins, profileForCoins, totalTreeCost, validateProfile } from "../src/progression/meta.ts";
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
  it("선행 조건: 앞 노드를 정한 레벨까지 사야 열린다 (데이터의 requires)", () => {
    let p = {};
    expect(isUnlocked(p, "fleece")).toBe(false);
    for (let i = 0; i < META.nodes.find((n) => n.id === "fleece")!.requires!.sturdy!; i++) p = buyNode(p, "sturdy");
    expect(isUnlocked(p, "fleece")).toBe(true);
    expect(isUnlocked(p, "second_chance")).toBe(false);
    expect(() => buyNode({}, "second_chance")).toThrow(/잠김/);
    expect(() => validateProfile({ fleece: 1 })).toThrow(/선행/);
    expect(canBuyNode({}, "sturdy", META.nodes[0]!.costs[0]! - 1)).toBe(false);
    // 모든 선행 조건은 있는 노드의 가능한 레벨을 가리킨다
    for (const n of META.nodes) {
      expect(n.costs.length).toBe(n.maxLevel);
      for (const [r, lv] of Object.entries(n.requires ?? {})) expect(lv).toBeLessThanOrEqual(META.nodes.find((x) => x.id === r)!.maxLevel);
    }
  });

  it("능력치 노드는 캐릭터 사본에 더해지고, 원본은 그대로다", () => {
    const base = character("shepherd");
    const s0 = { ...base.stats };
    const { character: ch, specials } = applyMeta(base, { sturdy: 4, fleece: 2, second_chance: 2, strength: 3, thrift: 2, boots: 2, crook: 1, purse: 2, chalk: 2, quick_rack: 1, lick: 1 });
    expect(ch.stats.max_hp).toBe(Math.round(s0.max_hp * 1.32)); // 튼튼한 몸 4단계 = +32%
    expect(ch.stats.armor).toBe(s0.armor + 2);
    expect(ch.stats.knock_power).toBeCloseTo(s0.knock_power + 0.15);
    expect(ch.stats.gold_find).toBeCloseTo(0.2);
    expect(ch.stats.move_speed).toBeCloseTo(s0.move_speed + 0.1);
    expect(ch.stats.pickup).toBeCloseTo(s0.pickup + 0.25);
    expect(ch.stats.regen).toBeCloseTo(s0.regen + 0.25);
    expect(specials).toMatchObject({ revives: 2, startGold: 100, cushionBonusUp: 0.5 });
    expect(specials.ballCooldownCut).toBeCloseTo(0.08);
    expect(base.stats.max_hp).toBe(s0.max_hp);
    // 시작 골드와 당구 효과는 첫 스테이지에 들어간다
    const g = startStage(1, "shepherd", "stage01", null, applyMeta(base, { thrift: 1, purse: 2, chalk: 1, quick_rack: 2 }), false, true);
    expect(g.player.gold).toBe(100);
    expect(g.player.cushionBonusUp).toBeCloseTo(0.25);
    expect(g.player.ballCooldownCut).toBeCloseTo(0.16);
  });

  it("트리를 전부 채우는 비용과, 코인이 충분하면 트리가 전부 찬다", () => {
    for (const ch of ["shepherd", "cue", "olly", "pale"]) {
      const total = totalTreeCost(ch);
      expect(total).toBeGreaterThan(4000);
      const full = profileForCoins(total, ch);
      for (const n of META.nodes) expect(full[n.id] ?? 0).toBe(!n.chars || n.chars.includes(ch) ? n.maxLevel : 0);
    }
  });

  it("코인 = 클리어 스테이지 + 터뜨린 적 + 남은 골드 몫", () => {
    expect(coinsForRun(10, 0)).toBe(10 * META.coins.perStage);
    expect(runCoins(10, 0, 0).fromGold).toBe(0);
    const r = runCoins(5, 1000, 1999);
    expect(r.fromGold).toBe(Math.floor(1999 * META.coins.perGold!));
    expect(r.fromGold).toBeGreaterThan(0);
    expect(r.total).toBe(r.base + r.fromGold);
    expect(r.base).toBe(Math.round(5 * META.coins.perStage + 1000 * META.coins.perPoppedEnemy));
    expect(runCoins(0, 0, -50).fromGold).toBe(0);
  });

  it("첫 수: 시작 무기 Lv2, 두 번째 기회: 한 번 쓰러져도 일어난다", () => {
    const meta = applyMeta(character("shepherd"), profileForCoins(totalTreeCost("shepherd"), "shepherd"));
    const g = startStage(1, "shepherd", "stage01", null, meta);
    expect(g.weapons[0]!.level.lv).toBe(2);
    const revives = META.nodes.find((n) => n.id === "second_chance")!.maxLevel;
    expect(g.player.revives).toBe(revives);
    g.player.hp = 1;
    g.player.iframes = 0;
    // 다 찬 트리는 방어·회복이 높아 한 번 닿아서는 안 쓰러질 수 있다: 부활만 보려고 방어를 뺀다
    g.player.stats.armor = 0;
    // 킥은 앞(+x)을 차므로 뒤에 둔다
    put(g, "red", g.player.x - 25, g.player.y, { moving: true });
    g.spawnTimer = 9999;
    const events = run(g, 5);
    expect(events.some((e) => e.type === "player-revive")).toBe(true);
    expect(g.player.dead).toBe(false);
    expect(g.player.revives).toBe(revives - 1);
  });

  it("런이 끝나면 코인을 받고, 남은 골드도 코인이 된다 (실패한 런도)", { timeout: 120_000 }, () => {
    const r = runCampaign(3, "shepherd", ["stage01"]);
    expect(r.won).toBe(true);
    expect(r.goldLeft).toBe(r.stages[0]!.gold);
    expect(r.coinsFromGold).toBe(runCoins(r.reached, r.stages[0]!.popped, r.goldLeft).fromGold);
    expect(r.coins).toBe(runCoins(r.reached, r.stages[0]!.popped, r.goldLeft).total);
    expect(r.coinsFromGold).toBeGreaterThan(0);
    // 실패한 런 (Lv1로 마지막 스테이지): 쓰러진 순간의 골드가 코인이 된다
    const f = runCampaign(3, "shepherd", ["stage15"], { meta: { purse: 3, thrift: 1 } });
    expect(f.won).toBe(false);
    expect(f.goldLeft).toBe(f.stages[0]!.gold);
    expect(f.goldLeft).toBeGreaterThanOrEqual(150);
    expect(f.coinsFromGold).toBe(Math.floor(f.goldLeft * META.coins.perGold!));
  });
});
