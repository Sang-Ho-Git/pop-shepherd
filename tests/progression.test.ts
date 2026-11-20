import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { Card } from "../src/core/types.ts";
import { character, ENEMIES, PASSIVES, weapon, WEAPONS } from "../src/data/index.ts";
import { applyCard, botChooseCard, checkLevelUp, drawCards, xpToNext, xpTotalFor } from "../src/progression/levelup.ts";
import { addPassive } from "../src/progression/passives.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";

function game(seed = 1) {
  return createGame({
    seed,
    character: character("shepherd"),
    enemyDefs: ENEMIES,
    stage: null,
    weapons: [makeWeapon(weapon("kick"), 1)],
    leveling: true,
  });
}

describe("2.1 경험치 곡선", () => {
  it("레벨 L → L+1 필요 경험치 = base + growth × (L - 1), 누적은 그 합", () => {
    expect(xpToNext(1)).toBe(RULES.xp.base);
    expect(xpToNext(3)).toBe(RULES.xp.base + 2 * RULES.xp.growth);
    expect(xpTotalFor(1)).toBe(0);
    expect(xpTotalFor(3)).toBe(xpToNext(1) + xpToNext(2));
  });

  it("경험치가 문턱을 넘을 때마다 레벨이 오르고 카드 하나가 적용된다", () => {
    const g = game();
    g.stats.xp = xpTotalFor(4);
    checkLevelUp(g);
    expect(g.player.level).toBe(4);
    const picks = g.events.filter((e) => e.type === "level-up");
    expect(picks).toHaveLength(3);
  });
});

describe("2.1 레벨업 카드", () => {
  it("카드는 3장이고 서로 다르다", () => {
    for (let s = 1; s <= 30; s++) {
      const cards = drawCards(game(s));
      expect(cards).toHaveLength(3);
      expect(new Set(cards.map((c) => JSON.stringify(c))).size).toBe(3);
    }
  });

  it("고를 것이 없으면 회복 카드로 채운다", () => {
    const g = game();
    g.weapons = Object.values(WEAPONS).filter((d) => d.implemented).map((d) => makeWeapon(d, 3));
    for (const p of Object.values(PASSIVES).filter((x) => x.implemented)) for (let i = 0; i < p.maxLevel; i++) addPassive(g, p.id);
    expect(drawCards(g)).toEqual([{ kind: "heal" }, { kind: "heal" }, { kind: "heal" }]);
  });

  it("무기 강화는 레벨을 올리고, 새 무기는 Lv1로 더한다", () => {
    const g = game();
    applyCard(g, { kind: "weaponUp", id: "kick" });
    expect(g.weapons[0]?.level.lv).toBe(2);
    applyCard(g, { kind: "newWeapon", id: "shockwave" });
    expect(g.weapons.map((w) => `${w.def.id}:${w.level.lv}`)).toEqual(["kick:2", "shockwave:1"]);
  });

  it("패시브는 능력치를 더한다. 털옷은 최대 체력과 현재 체력을 함께 올린다", () => {
    const g = game();
    g.player.hp = 60;
    applyCard(g, { kind: "newPassive", id: "thick_fleece" });
    applyCard(g, { kind: "passiveUp", id: "thick_fleece" });
    expect(g.player.maxHp).toBe(130);
    expect(g.player.hp).toBe(90);
    expect(g.player.stats.armor).toBe(2);
    applyCard(g, { kind: "newPassive", id: "mirror_shard" });
    expect(g.player.stats.cooldown).toBeCloseTo(0.06);
  });

  it("쿨다운 감소는 50%에서 멈춘다", () => {
    const g = game();
    g.player.baseStats = { ...g.player.baseStats, cooldown: 0.3 };
    for (let i = 0; i < 5; i++) addPassive(g, "mirror_shard");
    expect(g.player.stats.cooldown).toBe(0.5);
  });

  it("동작이 없는 패시브는 카드로 나오지 않는다", () => {
    for (let s = 1; s <= 50; s++) {
      for (const c of drawCards(game(s))) {
        if (c.kind === "newPassive") expect(PASSIVES[c.id]?.implemented).toBe(true);
      }
    }
  });

  it("봇은 무기 강화를 먼저, 체력이 절반 아래면 회복을 고른다", () => {
    const g = game();
    const cards: Card[] = [{ kind: "newPassive", id: "centrifuge" }, { kind: "weaponUp", id: "kick" }, { kind: "heal" }];
    expect(botChooseCard(cards, g)).toBe(1);
    g.player.hp = 30;
    expect(botChooseCard(cards, g)).toBe(2);
  });

  it("레벨업은 켜야만 일어난다 (고정 구성 측정용 기본값은 꺼짐)", () => {
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null });
    expect(g.leveling).toBe(false);
  });
});
