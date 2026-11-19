import { describe, expect, it } from "vitest";
import { RULES } from "../src/core/rules.ts";
import { chainMultiplier, damage, popShockRadius } from "../src/combat/pops.ts";
import { launch } from "../src/world/physics.ts";
import { emptyGame, pops, put, run } from "./helpers.ts";

describe("1.5 매치 보상", () => {
  it("3매치: 경험치 3, 충격파와 폭탄 없음", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    put(g, "red", 528, 400);
    const bystander = put(g, "blue", 514, 450);
    launch(a, 1, 0, 600);
    const events = run(g, 10);
    expect(pops(events)[0]?.xp).toBe(3);
    expect(g.bombs).toHaveLength(0);
    expect(bystander.state).toBe("walk");
  });

  it("4매치: 무리 중심에서 팝 충격파, 맞은 적은 연쇄 1단계로 날아간다", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    for (let i = 0; i < 3; i++) put(g, "red", 500 + i * 28, 400);
    const bystander = put(g, "blue", 520, 460);
    launch(a, 1, 0, 600);
    run(g, 6);
    expect(bystander.state).toBe("launched");
    expect(bystander.chainDepth).toBe(1);
    expect(bystander.vy).toBeGreaterThan(0);
  });

  it("팝 충격파 반경은 4마리 90px에서 1마리마다 15px씩 커진다", () => {
    expect(popShockRadius(4)).toBe(90);
    expect(popShockRadius(6)).toBe(120);
    expect(popShockRadius(3)).toBe(90);
  });

  it("5매치: 색 폭탄이 떨어지고, 주우면 그 색이 전부 터진다", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    for (let i = 0; i < 4; i++) put(g, "red", 500 + i * 28, 400);
    put(g, "red", 1500, 1000);
    put(g, "red", 2000, 300);
    put(g, "blue", 1800, 1200);
    launch(a, 1, 0, 600);
    run(g, 6);
    expect(g.bombs).toHaveLength(1);
    const bomb = g.bombs[0];
    if (!bomb) throw new Error("폭탄 없음");
    g.player.x = bomb.x;
    g.player.y = bomb.y;
    const events = run(g, 1);
    expect(events.some((e) => e.type === "bomb-pickup" && e.count === 2)).toBe(true);
    expect(g.enemies.map((e) => e.color)).toEqual(["blue"]);
  });

  it("연쇄: 팝 충격파에 날아간 적이 일으킨 팝은 1단계, 경험치 ×1.5", () => {
    const g = emptyGame();
    // 1단계 팝: 파랑 4마리
    const a = put(g, "blue", 380, 400);
    for (let i = 0; i < 3; i++) put(g, "blue", 440 + i * 28, 400);
    // 파랑 넷의 중심은 x ≈ 455. 충격파가 바로 아래 빨강을 수직으로 날려 아래의 빨강 둘에 꽂는다.
    put(g, "red", 455, 450);
    put(g, "red", 455, 560);
    put(g, "red", 455, 588);
    launch(a, 1, 0, 600);
    const p = pops(run(g, 60));
    expect(p).toHaveLength(2);
    expect(p[0]?.chainDepth).toBe(0);
    expect(p[1]?.chainDepth).toBe(1);
    expect(p[1]?.xp).toBeCloseTo(3 * 1.5);
    expect(g.stats.maxChain).toBe(2);
    expect(g.stats.pops / g.stats.rootPops).toBe(2);
  });

  it("연쇄 배율은 단계마다 ×1.5", () => {
    expect(chainMultiplier(0)).toBe(1);
    expect(chainMultiplier(1)).toBe(1.5);
    expect(chainMultiplier(2)).toBe(2.25);
  });

  it("연쇄 인정 시간 1.0초가 지나면 연쇄 단계가 0으로 돌아간다", () => {
    const g = emptyGame();
    const e = put(g, "red", 300, 300);
    launch(e, 1, 0, 2000, { chainDepth: 2, chainT: RULES.chain.window });
    run(g, 59);
    expect(e.chainDepth).toBe(2);
    run(g, 2);
    expect(e.state).toBe("launched");
    expect(e.chainDepth).toBe(0);
  });
});

describe("1.6 막힘 방지", () => {
  it("직접 피해로 처치하면 경험치는 매치의 20%", () => {
    const g = emptyGame();
    const e = put(g, "red", 400, 400);
    damage(g, e, 19);
    expect(e.dead).toBe(false);
    damage(g, e, 1);
    expect(e.dead).toBe(true);
    expect(g.stats.killedEnemies).toBe(1);
    expect(g.stats.xp).toBeCloseTo(0.2);
  });

  it("터뜨릴 적이 3마리 이상인데 10초 동안 팝이 없으면 막힘 1회", () => {
    const g = emptyGame();
    for (let i = 0; i < 3; i++) put(g, "red", 400 + i * 100, 400);
    run(g, 10 * RULES.tickHz - 2);
    expect(g.stats.stalls).toBe(0);
    const events = run(g, 3);
    expect(g.stats.stalls).toBe(1);
    expect(events.some((e) => e.type === "stall")).toBe(true);
  });

  it("적이 2마리 이하면 막힘 시계가 흐르지 않는다", () => {
    const g = emptyGame();
    put(g, "red", 400, 400);
    put(g, "blue", 600, 400);
    run(g, 20 * RULES.tickHz);
    expect(g.stats.stalls).toBe(0);
  });

  it("휘슬: 반경 360 안의 적을 날리고 쿨다운 60초", () => {
    const g = emptyGame();
    const near = put(g, "red", g.player.x + 200, g.player.y);
    const far = put(g, "red", g.player.x + 600, g.player.y);
    run(g, 1, { moveX: 0, moveY: 0, whistle: true });
    expect(near.state).toBe("launched");
    expect(near.vx).toBeGreaterThan(0);
    expect(far.state).toBe("walk");
    expect(g.player.whistleCd).toBeCloseTo(RULES.whistle.cooldown);
    run(g, 1, { moveX: 0, moveY: 0, whistle: true });
    expect(g.player.whistleCd).toBeLessThan(RULES.whistle.cooldown);
  });
});
