import { describe, expect, it } from "vitest";
import { createGame, step } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { StageDef } from "../src/core/types.ts";
import { character, ENEMIES, stage, weapon } from "../src/data/index.ts";
import { openChest } from "../src/progression/chest.ts";
import { resolveChoice, xpTotalFor } from "../src/progression/levelup.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";
import { put, run } from "./helpers.ts";
import { NO_INPUT } from "../src/core/types.ts";

/** 11/25 실플레이 피드백: 클리어 뒤 레벨업 창이 다음 스테이지에서 뜨고, 상자 창이 연달아 떴다 */
function shortStage(duration: number): StageDef {
  return { ...stage("stage01"), duration, spawn: [{ from: 0, to: duration, interval: 9999 }] };
}

function game(manual: boolean) {
  const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: shortStage(1), leveling: true, manualChoices: manual, weapons: [makeWeapon(weapon("kick"), 1)] });
  g.spawnTimer = 9999;
  return g;
}

describe("클리어 뒤 레벨업 (11/25)", () => {
  it("시뮬: 클리어 경험치로 오른 레벨업은 클리어하는 틱에 처리된다 (다음 스테이지로 넘기지 않음)", () => {
    const g = game(false);
    // 남은 적 경험치가 클리어 때 들어와 두 레벨을 넘게
    for (let k = 0; k < 60; k++) put(g, "red", 100 + (k % 10) * 40, 100 + Math.floor(k / 10) * 40);
    g.stats.xp = xpTotalFor(g.player.level + 1) - 1;
    run(g, RULES.tickHz + 2);
    expect(g.phase).toBe("cleared");
    expect(g.stats.xp).toBeLessThan(xpTotalFor(g.player.level + 1));
    expect(g.player.level).toBeGreaterThan(1);
  });

  it("화면 모드: 클리어 뒤 쌓인 레벨업을 한 장씩 모두 고른 다음에야 선택지가 빈다", () => {
    const g = game(true);
    for (let k = 0; k < 60; k++) put(g, "red", 100 + (k % 10) * 40, 100 + Math.floor(k / 10) * 40).xp = 10;
    // 클리어 전에는 레벨업이 없고, 클리어 경험치(남은 적 60마리)로 두 레벨 이상 오르게
    g.stats.xp = xpTotalFor(g.player.level + 1) - 1;
    run(g, RULES.tickHz + 2);
    expect(g.phase).toBe("cleared");
    expect(g.choices.length).toBe(1);
    let picks = 0;
    for (let guard = 0; guard < 50; guard++) {
      step(g, NO_INPUT);
      if (g.choices.length === 0) break;
      resolveChoice(g, 0);
      picks++;
    }
    expect(picks).toBeGreaterThanOrEqual(2);
    expect(g.choices).toHaveLength(0);
    expect(g.stats.xp).toBeLessThan(xpTotalFor(g.player.level + 1));
  });
});

describe("보물 상자 (11/25)", () => {
  it("화면 모드에서도 상자는 선택 창 없이 바로 열리고, 고른 보상을 이벤트로 알린다", () => {
    const g = game(true);
    const before = g.weapons[0]!.level.lv;
    const out = openChest(g, { x: 0, y: 0, kind: "boss" });
    expect(g.choices).toHaveLength(0);
    expect(out.picked).toHaveLength(RULES.drops.chestPicksBoss);
    expect(g.weapons[0]!.level.lv).not.toBe(before);
    expect(g.events.some((e) => e.type === "chest-open")).toBe(true);
  });
});
