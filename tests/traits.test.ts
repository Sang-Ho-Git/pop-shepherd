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
