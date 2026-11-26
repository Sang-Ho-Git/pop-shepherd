import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { StageDef } from "../src/core/types.ts";
import { character, ENEMIES, stage, weapon } from "../src/data/index.ts";
import { openChest } from "../src/progression/chest.ts";
import { needsBranch, resolveChoice } from "../src/progression/levelup.ts";
import { launch } from "../src/world/physics.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";
import { emptyGame, put, run } from "./helpers.ts";

/** 11/26 실플레이 피드백: 갈래 자동 선택, 무기가 날린 적이 저절로 터짐, 클리어 때 전부 수거 */
describe("Lv4 갈래 선택 (상자·상점)", () => {
  it("화면 모드: 상자에서 Lv3 무기 강화가 뽑히면 갈래를 자동으로 정하지 않고 선택 창을 남긴다", () => {
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, manualChoices: true, weapons: [makeWeapon(weapon("kick"), 3)] });
    // 후보가 킥 하나뿐이어도 Lv4는 갈래 선택 뒤에 된다
    g.player.passives = {};
    openChest(g, { kind: "elite", x: 0, y: 0, t: 0 } as never);
    expect(g.weapons[0]!.level.lv).toBe(3);
    expect(g.choices.length).toBe(1);
    expect(needsBranch(g, g.choices[0]!.cards[0]!)).toBe(true);
    resolveChoice(g, 0, "B");
    expect(g.weapons[0]!.level.lv).toBe(4);
    expect(g.weapons[0]!.level.branch).toBe("B");
  });
});

describe("무기가 날린 적은 저절로 터지지 않는다", () => {
  it("공이 남긴 낡은 원인(ball)은 무기가 날린 적에게 물려지지 않는다", () => {
    const g = emptyGame({});
    g.ballMode = true;
    const a = put(g, "red", 1000, 720);
    const b = put(g, "blue", 1060, 720);
    b.cause = "ball";
    launch(a, 1, 0, 900, { chainDepth: 0, chainT: 0, by: "kick" });
    run(g, 10);
    expect(b.state === "launched" || b.state === "stunned").toBe(true);
    expect(b.cause).not.toBe("ball");
  });
});

describe("클리어 때 수거 범위 (줍는 거리 ×1.1)", () => {
  function cleared() {
    const st: StageDef = { ...stage("stage01"), duration: 1, spawn: [{ from: 0, to: 1, interval: 9999 }] };
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: st, weapons: [] });
    g.spawnTimer = 9999;
    return g;
  }
  it("가까운 골드·우유병만 챙기고 먼 것은 놓친다", () => {
    const g = cleared();
    const p = g.player;
    const r = RULES.drops.pickupRange * p.stats.pickup;
    const hp0 = (p.hp = p.maxHp * 0.5);
    g.golds.push({ x: p.x + r * 1.05, y: p.y, amount: 10, t: 99 }, { x: p.x + r * 1.5, y: p.y, amount: 1000, t: 99 });
    g.milks.push({ x: p.x, y: p.y + RULES.heal.pickupRange * p.stats.pickup * 1.5, t: 99 });
    const gold0 = p.gold;
    run(g, RULES.tickHz + 2);
    expect(g.phase).toBe("cleared");
    expect(p.gold - gold0).toBe(10);
    expect(p.hp).toBe(hp0);
    expect(g.golds.length).toBe(0);
  });
});

describe("테스트용 세이브 조작 (11/26)", () => {
  it("초기화 → 모두 열기 → 코인 → 트리 채우기 → 비우기, 그리고 일부 잠그기", async () => {
    const t = await import("../src/progression/testsave.ts");
    const { CHARACTERS } = await import("../src/data/index.ts");
    const { isCharacterUnlocked } = await import("../src/progression/unlocks.ts");
    const { treeProgress, parseSave, serializeSave } = await import("../src/progression/save.ts");
    let s = t.resetSave();
    expect(s.unlocked).toEqual(["olly"]);
    s = t.unlockAll(s);
    expect(Object.keys(CHARACTERS).every((id) => isCharacterUnlocked(s, id))).toBe(true);
    s = t.setCharacterUnlocked(s, "cue", false);
    expect(isCharacterUnlocked(s, "cue")).toBe(false);
    expect(isCharacterUnlocked(t.setCharacterUnlocked(s, "olly", false), "olly")).toBe(true);
    s = t.setCoins(t.addCoins(s, 500), 12345.9);
    expect(s.coins).toBe(12345);
    s = t.fillTree(s, "olly");
    expect(treeProgress(s, "olly")).toBe(1);
    // 저장했다 읽어도 그대로
    const back = parseSave(serializeSave(s));
    expect(back.ok && back.dropped.length === 0 && treeProgress(back.save, "olly") === 1).toBe(true);
    s = t.clearTree(s, "olly");
    expect(treeProgress(s, "olly")).toBe(0);
  });

  it("노드 레벨은 최대로 막히고, 선행 조건이 모자란 노드는 버려진다", async () => {
    const t = await import("../src/progression/testsave.ts");
    const { META } = await import("../src/data/index.ts");
    const { profileOf } = await import("../src/progression/save.ts");
    const base = META.nodes.find((n) => !n.chars && !n.requires)!;
    const dep = META.nodes.find((n) => !n.chars && n.requires)!;
    let s = t.setNodeLevel(t.resetSave(), "olly", base.id, 99);
    expect(profileOf(s, "olly")[base.id]).toBe(base.maxLevel);
    s = t.setNodeLevel(t.resetSave(), "olly", dep.id, 1);
    expect(profileOf(s, "olly")[dep.id] ?? 0).toBe(0);
  });
});

describe("갈래 선택이 건너뛰어지지 않는다 (11/26 재현)", () => {
  it("보스 상자(3픽)가 Lv3 무기만 있어도 갈래는 사람이 고른다 (자동 선택이 불리면 실패)", () => {
    const g = createGame({ seed: 3, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, manualChoices: true, weapons: [makeWeapon(weapon("kick"), 3)] });
    g.player.passives = {};
    g.chooseBranch = () => {
      throw new Error("갈래가 자동으로 정해짐");
    };
    openChest(g, { kind: "boss", x: 0, y: 0, t: 0 } as never);
    let asked = 0;
    for (let guard = 0; guard < 10 && g.choices.length > 0; guard++) {
      const c = g.choices[0]!.cards[0]!;
      if (needsBranch(g, c)) {
        asked++;
        resolveChoice(g, 0, "A");
      } else resolveChoice(g, 0);
    }
    expect(asked).toBe(1);
    expect(g.weapons[0]!.level.branch).toBe("A");
    expect(g.weapons[0]!.level.lv).toBeGreaterThanOrEqual(5);
  });

  it("두 번째 무기도 Lv3 → Lv4에서 갈래를 묻는다 (첫 무기는 이미 갈래를 골랐어도)", () => {
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, manualChoices: true, weapons: [makeWeapon(weapon("kick"), 4, "B"), makeWeapon(weapon("lasso"), 3)] });
    expect(needsBranch(g, { kind: "weaponUp", id: "lasso" })).toBe(true);
    expect(needsBranch(g, { kind: "weaponUp", id: "kick" })).toBe(false);
  });
});
