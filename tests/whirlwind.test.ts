import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { WeaponInstance } from "../src/core/types.ts";
import { character, ENEMIES, weapon } from "../src/data/index.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";
import { put, run } from "./helpers.ts";

/** 색 공 규칙 게임 (회오리는 색 공 규칙에서만 둔화·삭제로 동작한다) */
function ballGame(weapons: WeaponInstance[]) {
  return createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, ballMode: true, weapons });
}

describe("회오리 (색 공 규칙, 11/24): 튕기지 않고 둔화, 여러 번 맞으면 사라짐", () => {
  it("칼날에 닿은 적은 날아가지 않고 둔화된다", () => {
    const w = makeWeapon(weapon("whirlwind"), 1);
    const g = ballGame([w]);
    const e = put(g, "red", g.player.x + 80, g.player.y + 10);
    run(g, 3);
    expect(e.state).toBe("walk");
    expect(e.slowT).toBeGreaterThan(1);
    expect(e.slowMul).toBeCloseTo(w.level.params.slow!);
    expect(e.bladeHits).toBe(1);
  });

  it("둔화된 적은 그만큼 느리게 걷는다", () => {
    const g = ballGame([]);
    const e = put(g, "red", g.player.x + 300, g.player.y, { moving: true });
    run(g, 1);
    const free = Math.hypot(e.vx, e.vy);
    e.slowT = 1;
    e.slowMul = 0.4;
    run(g, 1);
    expect(Math.hypot(e.vx, e.vy)).toBeLessThan(free * 0.7);
  });

  it("같은 적이 strikes번 맞으면 사라진다: 경험치·골드·팝 없음", () => {
    const w = makeWeapon(weapon("whirlwind"), 1);
    const g = ballGame([w]);
    const e = put(g, "red", g.player.x + 80, g.player.y + 10);
    const xp = g.stats.xp;
    const gold = g.player.gold;
    const strikes = w.level.params.strikes!;
    const period = Math.max(RULES.ball.orbit.minPeriod, w.level.cooldown);
    const events = run(g, Math.ceil(period * 60 * strikes) + 5);
    expect(e.dead).toBe(true);
    expect(g.stats.bladeVanished).toBe(1);
    expect(events.some((x) => x.type === "blade-vanish" && x.id === e.id)).toBe(true);
    expect(g.stats.xp).toBe(xp);
    expect(g.player.gold).toBe(gold);
    expect(g.stats.pops).toBe(0);
    expect(g.stats.killedEnemies).toBe(0);
  });

  it("한 바퀴에 칠 수 있는 적은 cap마리까지 (무적 오라가 되지 않게)", () => {
    const w = makeWeapon(weapon("whirlwind"), 1);
    const g = ballGame([w]);
    const cap = w.level.params.cap!;
    // 칼날이 지나가는 고리 위에 빙 둘러 10마리
    const es = Array.from({ length: 10 }, (_, k) => {
      const a = (k / 10) * Math.PI * 2 + 0.2;
      return put(g, k % 2 ? "red" : "blue", g.player.x + Math.cos(a) * 80, g.player.y + Math.sin(a) * 80);
    });
    const period = Math.max(RULES.ball.orbit.minPeriod, w.level.cooldown);
    run(g, Math.floor(period * 60) - 2);
    expect(es.filter((e) => (e.bladeHits ?? 0) > 0)).toHaveLength(cap);
  });

  it("회전 주기는 최소 주기보다 빠르지 않다 (7A 쿨다운 0.4 → 0.6초)", () => {
    const w = makeWeapon(weapon("whirlwind"), 7, "A");
    const g = ballGame([w]);
    run(g, 60);
    expect(w.fires).toBe(Math.floor(1 / RULES.ball.orbit.minPeriod));
  });

  it("엘리트·보스는 지우지 않고 둔화만 절반", () => {
    const w = makeWeapon(weapon("whirlwind"), 1);
    const g = ballGame([w]);
    const e = put(g, "red", g.player.x + 80, g.player.y + 10, { kind: "chief_jelly" });
    e.rank = "elite";
    run(g, 60 * 6);
    expect(e.dead).toBe(false);
    expect(e.bladeHits ?? 0).toBe(0);
  });

  it("기존 규칙(색 공 끔)에서도 튕기지 않고 둔화한다 (11/26: 두 규칙 공통)", () => {
    const w = makeWeapon(weapon("whirlwind"), 1);
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, weapons: [w] });
    const e = put(g, "red", g.player.x + 80, g.player.y + 10);
    run(g, 3);
    expect(e.state).toBe("walk");
    expect(e.slowT).toBeGreaterThan(1);
    expect(e.bladeHits).toBe(1);
  });
});
