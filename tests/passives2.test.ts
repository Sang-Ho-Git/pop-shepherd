import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import { character, ENEMIES, stage, weapon } from "../src/data/index.ts";
import { addPassive } from "../src/progression/passives.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";
import { launch, WEAPON_LAUNCH } from "../src/world/physics.ts";
import { emptyGame, put, run } from "./helpers.ts";

describe("패시브 탄성·무지개 잉크", () => {
  it("탄성: 무기로 날린 적은 울타리에서 처음 N번은 속도를 잃지 않는다", () => {
    const speedAfterWall = (lv: number) => {
      const g = emptyGame();
      for (let i = 0; i < lv; i++) addPassive(g, "elasticity");
      const e = put(g, "red", 40, 700);
      launch(e, -1, 0, 900, WEAPON_LAUNCH);
      run(g, 3);
      return e.vx;
    };
    expect(speedAfterWall(0)).toBeLessThan(speedAfterWall(1) * 0.85);
    expect(speedAfterWall(1)).toBeGreaterThan(0);
  });

  it("무지개 잉크: 짝 옆에 무지개 젤리가 함께 나온다", { timeout: 60_000 }, () => {
    const count = (lv: number) => {
      const g = createGame({ seed: 3, character: character("shepherd"), enemyDefs: ENEMIES, stage: stage("stage03") });
      for (let i = 0; i < lv; i++) addPassive(g, "rainbow_ink");
      g.player.hp = g.player.maxHp = 1e9;
      // 무지개는 곧잘 터지므로 매 틱 본 무지개 id를 모은다
      const seen = new Set<number>();
      for (let t = 0; t < 60 * RULES.tickHz; t++) {
        run(g, 1);
        for (const e of g.enemies) if (e.color === "rainbow") seen.add(e.id);
      }
      return seen.size;
    };
    expect(count(0)).toBe(0);
    expect(count(5)).toBeGreaterThan(0);
  });

  it("킥 진화 핀볼: 찬 적이 가장 가까운 같은 색 쪽으로 휘어 간다", () => {
    const g = emptyGame({ weapons: [makeWeapon(weapon("kick"), "evo", "A")] });
    const { x, y } = g.player;
    const a = put(g, "blue", x + 40, y);
    // 같은 색 짝은 진행 방향에서 비켜 위쪽에 있다
    put(g, "blue", x + 300, y - 160);
    put(g, "blue", x + 328, y - 160);
    run(g, 20);
    expect(a.dead || a.y < y - 20).toBe(true);
  });
});
