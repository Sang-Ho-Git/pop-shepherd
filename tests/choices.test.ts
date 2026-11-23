import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { character, ENEMIES, weapon } from "../src/data/index.ts";
import { resolveChoice, validateFrontChoice } from "../src/progression/levelup.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";

describe("화면 모드 선택지 (11/23 밤 점검에서 찾은 버그)", () => {
  it("보스 상자 선택이 쌓여 같은 무기를 두 번 올려도 Lv7을 넘지 않는다 (뒤 선택지를 다시 뽑는다)", () => {
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, manualChoices: true, weapons: [makeWeapon(weapon("magnet_totem"), 6, "B")] });
    g.choices.push({ kind: "chest", cards: [{ kind: "weaponUp", id: "magnet_totem" }] }, { kind: "chest", cards: [{ kind: "weaponUp", id: "magnet_totem" }] });
    validateFrontChoice(g);
    resolveChoice(g, 0);
    expect(g.weapons[0]!.level.lv).toBe(7);
    validateFrontChoice(g);
    // 올릴 것이 없으면 상자 선택은 회복으로 바뀌어 넘어가고, 있으면 다른 카드로 다시 뽑힌다
    for (const c of g.choices[0]?.cards ?? []) expect(c).not.toEqual({ kind: "weaponUp", id: "magnet_totem" });
    if (g.choices[0]) expect(() => resolveChoice(g, 0)).not.toThrow();
  });
});
