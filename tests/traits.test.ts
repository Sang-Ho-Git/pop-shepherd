import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import { character, ENEMIES, stage, weapon } from "../src/data/index.ts";
import { spawnEnemy } from "../src/combat/spawner.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";
import { launch, PLAIN_LAUNCH, WEAPON_LAUNCH } from "../src/world/physics.ts";
import { emptyGame, put, run } from "./helpers.ts";

describe("기믹 적과 바위 (트리 3.2, 3.3)", () => {
  it("가시 젤리: 무기로는 밀리지 않고, 팝 충격파(일반 발사)로는 밀린다", () => {
    const g = emptyGame();
    const s = spawnEnemy(g, "spiky", "red", 600, 400);
    launch(s, 1, 0, 800, WEAPON_LAUNCH);
    expect(s.state).toBe("walk");
    launch(s, 1, 0, 800, PLAIN_LAUNCH);
    expect(s.state).toBe("launched");
  });

  it("가시 젤리도 같은 색 매치로는 터진다", () => {
    const g = emptyGame();
    spawnEnemy(g, "spiky", "red", 500, 400).speed = 0;
    put(g, "red", 528, 400);
    const a = put(g, "red", 440, 400);
    launch(a, 1, 0, 600);
    run(g, 10);
    expect(g.stats.poppedEnemies).toBe(3);
  });

  it("킥은 가시 젤리를 대상으로 삼지 않는다 (헛방 없음)", () => {
    const w = makeWeapon(weapon("kick"), 1);
    const g = emptyGame({ weapons: [w] });
    spawnEnemy(g, "spiky", "red", g.player.x + 40, g.player.y).speed = 0;
    run(g, 5);
    expect(w.fires).toBe(0);
  });

  it("겁쟁이 양: 가까우면 플레이어에게서 멀어진다", () => {
    const g = emptyGame();
    const r = spawnEnemy(g, "runner", "blue", g.player.x + 100, g.player.y);
    run(g, 30);
    expect(r.x).toBeGreaterThan(g.player.x + 100);
  });

  it("바위: 날아간 적이 튕겨 쿠션으로 세고, 바위 안에는 소환되지 않는다", () => {
    const st = stage("stage07");
    const g = createGame({ seed: 2, character: character("shepherd"), enemyDefs: ENEMIES, stage: st });
    g.spawnTimer = 9999;
    const rock = st.rocks![0]!;
    const e = put(g, "red", rock.x - rock.r - 40, rock.y);
    launch(e, 1, 0, 800, WEAPON_LAUNCH);
    run(g, 10);
    expect(e.vx).toBeLessThan(0);
    expect(e.wallBounces).toBe(1);
    g.spawnTimer = 0;
    run(g, 60 * RULES.tickHz);
    for (const x of g.enemies) for (const r of st.rocks!) expect(Math.hypot(x.x - r.x, x.y - r.y)).toBeGreaterThanOrEqual(r.r + x.radius - 0.5);
  });
});

describe("맵 기믹: 개울", () => {
  it("개울 안에서는 플레이어와 적이 느려진다", () => {
    const st = stage("stage02");
    const s = st.streams![0]!;
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: st });
    g.spawnTimer = 9999;
    g.player.y = s.y + s.h / 2;
    const x0 = g.player.x;
    run(g, 60, { moveX: 1, moveY: 0, whistle: false });
    const inside = g.player.x - x0;
    g.player.y = s.y - 200;
    const x1 = g.player.x;
    run(g, 60, { moveX: 1, moveY: 0, whistle: false });
    expect(inside).toBeCloseTo((g.player.x - x1) * RULES.terrain.streamSlow, 0);
  });
});

describe("맵 기믹: 돌풍", () => {
  it("정해진 간격으로 불고, 부는 동안 날아가는 적이 바람 쪽으로 휜다", () => {
    const st = { ...stage("stage08"), wind: { every: 1, duration: 2 } };
    const g = createGame({ seed: 4, character: character("shepherd"), enemyDefs: ENEMIES, stage: st });
    g.spawnTimer = 9999;
    g.player.hp = g.player.maxHp = 1e9;
    const events = run(g, 70);
    const start = events.find((e) => e.type === "wind-start");
    expect(start).toBeDefined();
    const e = put(g, "red", 1280, 400);
    launch(e, 0, 1, 900, WEAPON_LAUNCH);
    const vx0 = e.vx;
    run(g, 20);
    if (start && start.type === "wind-start" && Math.abs(start.dx) > 0.2) expect(Math.sign(e.vx - vx0)).toBe(Math.sign(start.dx));
  });
});
