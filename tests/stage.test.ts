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

describe("스테이지 클리어 (생존형, 마무리 시간)", () => {
  it("시간이 끝나면 마무리 시간이 시작되고, 소환이 멈춘다", () => {
    const st = { ...stage("stage01"), duration: 2 };
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: st });
    const events = run(g, 2 * RULES.tickHz + 1);
    expect(g.phase).toBe("wrapup");
    expect(events.some((e) => e.type === "wrapup-start")).toBe(true);
    const spawned = g.stats.spawned;
    run(g, 5 * RULES.tickHz);
    expect(g.stats.spawned).toBe(spawned);
  });

  it("마무리 시간의 팝은 경험치 +50%이고, 따로 센다", () => {
    const g = gameOn(shortStage(1));
    run(g, RULES.tickHz + 1);
    expect(g.phase).toBe("wrapup");
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    put(g, "red", 528, 400);
    launch(a, 1, 0, 600);
    const p = pops(run(g, 10));
    expect(p[0]?.xp).toBeCloseTo(3 * (1 + RULES.stage.wrapUpXpBonus));
    expect(g.stats.wrapUpPopped).toBe(3);
  });

  it("마무리 시간이 끝나면 남은 적이 사라지고 클리어. 이후 진행은 멈춘다", () => {
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

  it("엘리트·보스 클리어 조건은 아직 만들 수 없다", () => {
    expect(() => createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: { ...stage("stage01"), clear: "boss" } })).toThrow(/아직 구현되지 않음/);
  });
});
