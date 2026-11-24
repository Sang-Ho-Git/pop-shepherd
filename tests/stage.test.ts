import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { StageDef } from "../src/core/types.ts";
import { character, ENEMIES, stage } from "../src/data/index.ts";
import { launch } from "../src/world/physics.ts";
import { pops, put, run } from "./helpers.ts";

/** 소환이 거의 없는 짧은 생존형 스테이지 (규칙만 보기 위해) */
function shortStage(duration: number): StageDef {
  return { ...stage("stage01"), duration, spawn: [{ from: 0, to: duration, interval: 9999 }] };
}

function gameOn(st: StageDef) {
  const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: st });
  g.spawnTimer = 9999;
  return g;
}

describe("스테이지 클리어 (생존형, 11/24부터 마무리 시간 없음)", () => {
  it("시간이 끝나면 바로 클리어한다 (마무리 시간 없음, 마무리 배너도 없음)", () => {
    expect(RULES.stage.wrapUpSeconds).toBe(0);
    const st = { ...stage("stage01"), duration: 2 };
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: st });
    const events = run(g, 2 * RULES.tickHz + 1);
    expect(g.phase).toBe("cleared");
    expect(events.some((e) => e.type === "wrapup-start")).toBe(false);
    expect(g.time).toBeCloseTo(2, 1);
  });

  it("클리어 때 남은 일반 적 경험치의 clearXpRatio를 받는다 (마무리 경험치 대신)", () => {
    const g = gameOn(shortStage(1));
    const a = put(g, "red", 200, 200);
    const b = put(g, "blue", 300, 300);
    const want = (a.xp + b.xp) * RULES.stage.clearXpRatio;
    const before = g.stats.xp;
    const events = run(g, RULES.tickHz + 2);
    expect(g.phase).toBe("cleared");
    expect(g.stats.xp - before).toBeCloseTo(want);
    expect(events.find((e) => e.type === "stage-clear")).toMatchObject({ vanished: 2, xp: want });
  });

  it("클리어하면 남은 적이 사라진다. 이후 진행은 멈춘다", () => {
    const g = gameOn(shortStage(1));
    put(g, "red", 200, 200);
    put(g, "blue", 300, 300);
    const events = run(g, (1 + RULES.stage.wrapUpSeconds) * RULES.tickHz + 2);
    expect(g.phase).toBe("cleared");
    expect(g.enemies).toHaveLength(0);
    expect(g.stats.vanished).toBe(2);
    expect(events.find((e) => e.type === "stage-clear")).toMatchObject({ vanished: 2 });
    const tick = g.tick;
    run(g, 10);
    expect(g.tick).toBe(tick);
  });

  it("사망하면 실패", () => {
    const g = gameOn(shortStage(60));
    g.player.hp = 1;
    put(g, "red", g.player.x + 25, g.player.y, { moving: true });
    run(g, 5);
    expect(g.player.dead).toBe(true);
    expect(g.phase).toBe("failed");
  });

  it("처치형인데 목표(보스·엘리트)가 없는 스테이지는 만들 수 없다", () => {
    expect(() => createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: { ...stage("stage01"), clear: "boss" } })).toThrow(/보스가 없음/);
    expect(() => createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: { ...stage("stage01"), clear: "elites" } })).toThrow(/엘리트가 없음/);
  });
});
