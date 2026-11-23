import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { StageDef } from "../src/core/types.ts";
import { character, ENEMIES, stage, weapon } from "../src/data/index.ts";
import { addPassive } from "../src/progression/passives.ts";
import { spawnEnemy } from "../src/combat/spawner.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";
import { launch } from "../src/world/physics.ts";
import { emptyGame, pops, put, run } from "./helpers.ts";

function special(g: ReturnType<typeof emptyGame>, kind: string, color: "red" | "blue" | "gray", x: number, y: number) {
  const e = spawnEnemy(g, kind, color, x, y);
  e.speed = 0;
  return e;
}

/** 빨강 셋을 (x, y) 근처에서 부딪혀 터뜨린다 */
function popRedsAt(g: ReturnType<typeof emptyGame>, x: number, y: number) {
  const a = put(g, "red", x - 60, y);
  put(g, "red", x, y);
  put(g, "red", x + 28, y);
  launch(a, 1, 0, 600);
}

describe("엘리트·보스: 팝 피해", () => {
  it("같은 색이어도 매치 무리에 끼지 않는다", () => {
    const g = emptyGame();
    const elite = special(g, "chief_jelly", "red", 600, 400);
    const a = put(g, "red", 520, 400);
    put(g, "red", 600, 440);
    launch(a, 1, 0, 600);
    run(g, 20);
    expect(elite.dead).toBe(false);
    expect(pops(run(g, 1))).toHaveLength(0);
  });

  it("곁의 팝이 터진 수 × 12만큼 피해를 주고, 몸 색과 같은 팝은 2배", () => {
    const hit = (color: "red" | "blue") => {
      const g = emptyGame();
      const e = special(g, "chief_jelly", color, 600, 460);
      popRedsAt(g, 600, 400);
      run(g, 10);
      return e.maxHp - e.hp;
    };
    expect(hit("blue")).toBeCloseTo(3 * RULES.boss.popDamagePerEnemy);
    expect(hit("red")).toBeCloseTo(3 * RULES.boss.popDamagePerEnemy * RULES.boss.weakMul);
  });

  it("돌갑옷은 플레이어를 보는 쪽에서 터진 팝을 절반만 받는다", () => {
    const hit = (side: 1 | -1) => {
      const g = emptyGame();
      g.player.x = 600;
      g.player.y = 200;
      const e = special(g, "armored", "gray", 600, 500);
      popRedsAt(g, 600, 500 - side * 70);
      run(g, 10);
      return e.maxHp - e.hp;
    };
    expect(hit(1)).toBeCloseTo(hit(-1) * 0.5);
  });

  it("쓰러뜨리면 보물 상자를 떨어뜨리고, 주우면 진화할 무기를 진화시킨다", () => {
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, weapons: [makeWeapon(weapon("shockwave"), 7, "A")], leveling: true });
    addPassive(g, "chain_amp");
    const e = special(g, "chief_jelly", "blue", 900, 400);
    e.hp = 1;
    popRedsAt(g, 900, 340);
    run(g, 10);
    expect(e.dead).toBe(true);
    expect(g.chests).toHaveLength(1);
    g.player.x = g.chests[0]!.x;
    g.player.y = g.chests[0]!.y;
    const events = run(g, 1);
    expect(events.find((x) => x.type === "chest-open")).toMatchObject({ kind: "elite", evolved: ["shockwave"] });
    expect(g.weapons[0]!.level.lv).toBe("evo");
  });

  it("진화할 게 없으면 엘리트 상자는 가진 것 강화 1개", () => {
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, weapons: [makeWeapon(weapon("kick"), 1)], leveling: true });
    g.chests.push({ x: g.player.x, y: g.player.y, kind: "elite" });
    run(g, 1);
    expect(g.weapons[0]!.level.lv).toBe(2);
  });
});

describe("엘리트·보스: 행동", () => {
  it("대장 젤리는 8초마다 자기 색 젤리 2마리를 부른다", () => {
    const g = emptyGame();
    special(g, "chief_jelly", "blue", 1600, 400);
    run(g, 8 * RULES.tickHz + 1);
    expect(g.enemies.filter((e) => e.kind === "jelly" && e.color === "blue")).toHaveLength(2);
  });

  it("카멜레온은 10초마다 몸 색이 바뀐다", () => {
    const g = emptyGame();
    const e = special(g, "chameleon", "red", 1600, 400);
    run(g, 10 * RULES.tickHz + 1);
    expect(e.color).not.toBe("red");
  });

  it("양털 거인: 6초마다 졸개 6마리(두 색), 체력 절반 아래면 2단계에서 돌진한다", () => {
    const g = emptyGame();
    g.player.hp = g.player.maxHp = 1e9;
    const e = special(g, "wool_giant", "red", 1600, 700);
    run(g, 6 * RULES.tickHz + 1);
    const minions = g.enemies.filter((x) => x.kind === "jelly");
    expect(minions).toHaveLength(6);
    expect(new Set(minions.map((x) => x.color)).size).toBe(2);
    e.hp = e.maxHp * 0.4;
    e.speed = 45;
    for (const m of minions) m.dead = true;
    const events = run(g, 1);
    expect(events.some((x) => x.type === "boss-phase")).toBe(true);
    // 8초 쿨다운 + 1초 예고 뒤 돌진 속도
    let fastest = 0;
    for (let t = 0; t < 10 * RULES.tickHz; t++) {
      run(g, 1);
      fastest = Math.max(fastest, Math.hypot(e.vx, e.vy));
    }
    expect(fastest).toBeGreaterThan(e.speed * 2);
  });
});

describe("처치형 스테이지", () => {
  function bossStage(): StageDef {
    return { ...stage("stage05"), duration: 10, spawn: [{ from: 0, to: 10, interval: 9999 }], boss: { at: 1, kind: "wool_giant" } };
  }

  it("보스는 정해진 시각에 나오고, 쓰러뜨려야 마무리 시간이 시작된다 (시간이 지나도 계속)", () => {
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: bossStage() });
    g.spawnTimer = 9999;
    // 규칙만 본다: 졸개에게 맞아 죽지 않게
    g.player.hp = g.player.maxHp = 1e9;
    run(g, 2 * RULES.tickHz);
    const boss = g.enemies.find((e) => e.rank === "boss")!;
    expect(boss).toBeDefined();
    boss.speed = 0;
    run(g, 12 * RULES.tickHz);
    expect(g.phase).toBe("play");
    boss.hp = 1;
    popRedsAt(g, boss.x, boss.y - 80);
    run(g, 10);
    expect(g.stats.bossKilled).toBe(1);
    expect(g.phase).toBe("wrapup");
    run(g, RULES.stage.wrapUpSeconds * RULES.tickHz + 2);
    expect(g.phase).toBe("cleared");
    // 마무리 끝에 남은 상자와 골드는 자동으로 줍는다
    expect(g.stats.chestsOpened).toBe(1);
    expect(g.golds).toHaveLength(0);
  });

  it("엘리트형은 나온 엘리트를 다 쓰러뜨리면 마무리 시간", () => {
    const st: StageDef = { ...stage("stage10"), spawn: [{ from: 0, to: 270, interval: 9999 }], elites: [{ at: 0, kind: "chief_jelly" }, { at: 0, kind: "chameleon" }] };
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: st });
    g.spawnTimer = 9999;
    run(g, 2);
    const elites = g.enemies.filter((e) => e.rank === "elite");
    expect(elites).toHaveLength(2);
    elites[0]!.hp = 0.1;
    elites[0]!.dead = false;
    popRedsAt(g, elites[0]!.x, elites[0]!.y - 70);
    run(g, 10);
    expect(g.phase).toBe("play");
    for (const e of g.enemies.filter((x) => x.rank === "elite")) {
      e.hp = 0.1;
      popRedsAt(g, e.x, e.y - 70);
    }
    run(g, 10);
    expect(g.stats.elitesKilled).toBe(2);
    expect(g.phase).toBe("wrapup");
  });
});

describe("엘리트·보스는 즉시 팝 효과에도 끼지 않는다", () => {
  it("킥 7A로 같은 색 둘을 찼을 때 닿아 있던 같은 색 보스는 함께 터지지 않는다", () => {
    const g = emptyGame({ weapons: [makeWeapon(weapon("kick"), 7, "A")] });
    g.player.hp = g.player.maxHp = 1e9;
    const { x, y } = g.player;
    put(g, "green", x + 40, y);
    put(g, "green", x + 44, y + 30);
    const boss = spawnEnemy(g, "wool_giant", "green" as never, x + 100, y + 20);
    boss.speed = 0;
    run(g, 1);
    expect(boss.dead).toBe(false);
  });
});

describe("엘리트·보스 속도", () => {
  it("보스는 출현 구간 속도 배율을 받지 않고, 엘리트는 1.3배까지만", () => {
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: stage("stage15") });
    g.time = 150;
    const boss = spawnEnemy(g, "rainbow_shepherd", "red", 100, 100);
    const elite = spawnEnemy(g, "chief_jelly", "red", 200, 100);
    expect(boss.speed).toBe(ENEMIES.rainbow_shepherd!.speed);
    expect(elite.speed).toBeCloseTo(ENEMIES.chief_jelly!.speed * RULES.boss.eliteSpeedCap);
  });
});
