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

  it("대장 젤리는 내려찍기 예고를 플레이어 자리에 깔고, 예고 동안 멈춰 선다", () => {
    const g = emptyGame();
    const e = spawnEnemy(g, "chief_jelly", "blue", g.player.x + 500, g.player.y);
    const events = run(g, (ENEMIES.chief_jelly!.params!.atkFirst! + 0.1) * RULES.tickHz);
    expect(events.some((x) => x.type === "telegraph" && x.act === "slam")).toBe(true);
    const h = g.hazards[0]!;
    expect(h.kind).toBe("circle");
    expect(Math.hypot(h.x - g.player.x, h.y - g.player.y)).toBeLessThan(1);
    const x0 = e.x;
    run(g, 10);
    expect(e.x).toBe(x0);
  });
});

/** 바위 넷이 있는 스테이지 5 지형, 일반 소환 없음 (보스는 직접 놓는다) */
function rockGame() {
  const st: StageDef = { ...stage("stage05"), spawn: [{ from: 0, to: 9999, interval: 9999 }], boss: { at: 9999, kind: "wool_giant" } };
  const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: st });
  g.spawnTimer = 9999;
  return g;
}

describe("보스 패턴: 읽고 피하기", () => {
  it("예고가 끝나는 순간 경고 안에 있으면 맞고, 밖으로 나가면 맞지 않는다", () => {
    const hitWhen = (leave: boolean) => {
      const g = emptyGame();
      const e = spawnEnemy(g, "wool_giant", "red", g.player.x + 600, g.player.y);
      e.boss!.atkCd = 0;
      run(g, 1);
      const h = g.hazards.find((x) => x.act === "slam")!;
      expect(h).toBeDefined();
      const hp = g.player.hp;
      const ticks = Math.ceil(h.total * RULES.tickHz) + 2;
      run(g, ticks, { moveX: 0, moveY: leave ? 1 : 0, whistle: false });
      return hp - g.player.hp;
    };
    expect(hitWhen(false)).toBeGreaterThan(0);
    expect(hitWhen(true)).toBe(0);
  });

  it("양털 거인의 패턴은 내려찍기 → 털뭉치 부채꼴 → 돌진 차례, 부채꼴은 탄을 쏜다", () => {
    const g = emptyGame();
    g.player.hp = g.player.maxHp = 1e9;
    spawnEnemy(g, "wool_giant", "red", g.player.x + 600, g.player.y);
    const acts = run(g, 14 * RULES.tickHz)
      .filter((x) => x.type === "telegraph")
      .map((x) => (x as { act: string }).act);
    expect(acts.slice(0, 3)).toEqual(["slam", "fan", "dash"]);
    // 내려찍은 자리에 약점 색 양 (약점 팝 재료)
    expect(g.enemies.filter((x) => x.kind === "jelly" && x.color === "red").length).toBeGreaterThan(0);
  });

  it("부채꼴 예고가 끝나면 털뭉치 탄이 날아가고, 맞으면 아프다", () => {
    const g = emptyGame();
    const e = spawnEnemy(g, "wool_giant", "red", g.player.x + 300, g.player.y);
    e.speed = 0;
    e.boss!.atkN = 1; // 다음 패턴: 부채꼴
    e.boss!.atkCd = 0;
    run(g, 1);
    expect(g.hazards[0]!.kind).toBe("cone");
    const hp = g.player.hp;
    const events = run(g, 2 * RULES.tickHz);
    expect(events.some((x) => x.type === "hazard-hit" && x.act === "fan")).toBe(true);
    expect(g.player.hp).toBeLessThan(hp);
  });

  it("돌진하다 바위에 박으면 그로기: 멈추고, 곁의 팝 피해가 groggyMul배 (보스 팝 배율 포함), 닿아도 아프지 않다", () => {
    const g = rockGame();
    // 바위(525, 338) 너머에 보스, 플레이어는 바위 이쪽
    g.player.x = 380;
    g.player.y = 338;
    const e = spawnEnemy(g, "wool_giant", "blue", 800, 338);
    e.speed = 0;
    e.boss!.atkN = 2; // 다음 패턴: 돌진
    e.boss!.atkCd = 0;
    const events = run(g, 3 * RULES.tickHz, { moveX: 0, moveY: 0, whistle: false });
    expect(events.some((x) => x.type === "groggy" && x.why === "crash")).toBe(true);
    expect(e.boss!.groggy).toBeGreaterThan(0);
    const hp = e.hp;
    popRedsAt(g, e.x, e.y - 80);
    run(g, 10);
    expect(hp - e.hp).toBeCloseTo(3 * RULES.boss.popDamagePerEnemy * (ENEMIES.wool_giant!.params!.popMul ?? 1) * RULES.boss.groggyMul);
  });
});

describe("보스 파훼: 약점 색 공과 보호막", () => {
  function throwAt(g: ReturnType<typeof emptyGame>, color: "red" | "blue", x: number, y: number, bounces = 0) {
    g.balls = [{ x: x - 120, y, vx: 900, vy: 0, color, travel: 0, bounces, lastHit: -1 }];
  }

  it("머리 위 약점 색 공을 맞히면 최대 체력 × weakFrac, 쿠션을 거치면 더 크고, 약점 색이 바뀐다", () => {
    const dmg = (color: "red" | "blue", bounces: number) => {
      const g = emptyGame();
      g.ballMode = true;
      const e = special(g, "wool_giant", "red", 1800, 400);
      throwAt(g, color, e.x, e.y, bounces);
      run(g, 12);
      return { d: e.maxHp - e.hp, weak: e.boss!.weak, max: e.maxHp };
    };
    const frac = ENEMIES.wool_giant!.params!.weakFrac!;
    const plain = dmg("red", 0);
    expect(plain.d).toBeCloseTo(plain.max * frac);
    expect(plain.weak).not.toBe("red");
    expect(dmg("red", 2).d).toBeCloseTo(plain.max * frac * (1 + 2 * RULES.boss.weakCushionBonus));
    // 약점이 아닌 색은 맞고 튕길 뿐
    expect(dmg("blue", 0).d).toBe(0);
  });

  it("무지개 양치기: 체력 2/3 아래면 보호막. 팝 피해가 없고, 쿠션 공으로 다 깎으면 그로기", () => {
    const g = emptyGame();
    g.ballMode = true;
    g.player.hp = g.player.maxHp = 1e9;
    const e = special(g, "rainbow_shepherd", "red", 1800, 400);
    e.hp = e.maxHp * 0.6;
    const ev = run(g, 1);
    expect(ev.some((x) => x.type === "shield-up")).toBe(true);
    const need = e.boss!.shield;
    expect(need).toBe(ENEMIES.rainbow_shepherd!.params!.shieldNeed);
    // 쿠션 없는 공은 보호막을 깎지 못한다
    throwAt(g, "red", e.x, e.y, 0);
    run(g, 12);
    expect(e.boss!.shield).toBe(need);
    // 보호막 동안 곁의 팝은 피해가 없다
    const hp = e.hp;
    popRedsAt(g, e.x, e.y - 80);
    run(g, 10);
    expect(e.hp).toBe(hp);
    // 3쿠션 공 한 방
    g.balls = [];
    throwAt(g, "blue", e.x, e.y, 3);
    const ev2 = run(g, 12);
    expect(e.boss!.shield).toBe(0);
    expect(ev2.some((x) => x.type === "groggy" && x.why === "shield")).toBe(true);
  });
});

describe("그로기의 우선", () => {
  it("그로기가 되면 깔아 둔 예고가 취소되고, 그로기 동안에는 보호막을 치지 않는다 (끝나면 친다)", () => {
    const g = emptyGame();
    g.player.hp = g.player.maxHp = 1e9;
    const e = special(g, "rainbow_shepherd", "red", g.player.x + 400, g.player.y);
    e.boss!.atkCd = 0;
    run(g, 1);
    expect(g.hazards.length).toBeGreaterThan(0);
    e.boss!.groggy = 2;
    e.hp = e.maxHp * 0.6;
    run(g, 2);
    expect(g.hazards).toHaveLength(0);
    expect(e.boss!.shield).toBe(0);
    run(g, 2 * RULES.tickHz);
    expect(e.boss!.shield).toBe(ENEMIES.rainbow_shepherd!.params!.shieldNeed);
  });
});

describe("처치형 스테이지", () => {
  function bossStage(): StageDef {
    return { ...stage("stage05"), duration: 10, spawn: [{ from: 0, to: 10, interval: 9999 }], boss: { at: 1, kind: "wool_giant" } };
  }

  it("보스는 정해진 시각에 나오고, 쓰러뜨려야 클리어한다 (시간이 지나도 계속)", () => {
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
    // 11/26: 클리어 때 자동 수거는 줍는 거리 ×1.1 안만 — 보스 곁에 서 있어야 상자를 챙긴다
    g.player.x = boss.x;
    g.player.y = boss.y;
    popRedsAt(g, boss.x, boss.y - 80);
    run(g, 10);
    expect(g.stats.bossKilled).toBe(1);
    // 11/24: 마무리 시간 없이 바로 클리어. 가까이 남은 상자와 골드는 자동으로 줍는다
    expect(g.phase).toBe("cleared");
    expect(g.stats.chestsOpened).toBe(1);
    expect(g.golds).toHaveLength(0);
  });

  it("엘리트형은 나온 엘리트를 다 쓰러뜨리면 클리어", () => {
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
    expect(g.phase).toBe("cleared");
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
