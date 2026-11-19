import { describe, expect, it } from "vitest";
import { DAMP_PER_TICK, DT, RULES } from "../src/core/rules.ts";
import { launch, speedOf } from "../src/world/physics.ts";
import { emptyGame, put, run } from "./helpers.ts";

/** 이산 틱 기준 비행 거리: 속도가 끝 속도 아래로 떨어질 때까지 v·dt 합 */
function expectedFlight(v0: number): number {
  let v = v0;
  let d = 0;
  for (;;) {
    v *= DAMP_PER_TICK;
    d += v * DT;
    if (v < RULES.physics.launchEndSpeed) return d;
  }
}

describe("1.2 물리: 발사와 감속", () => {
  it("발사 속도 = 날리는 힘 ÷ 질량", () => {
    const g = emptyGame();
    const jelly = put(g, "red", 400, 400);
    const stone = put(g, "blue", 400, 800, { kind: "stone" });
    launch(jelly, 1, 0, 600);
    launch(stone, 1, 0, 600);
    expect(speedOf(jelly)).toBeCloseTo(600);
    expect(speedOf(stone)).toBeCloseTo(200);
    expect(jelly.state).toBe("launched");
  });

  it("힘 600으로 날린 젤리는 약 190px 날아간 뒤 평소 상태로 돌아온다", () => {
    const g = emptyGame();
    const e = put(g, "red", 300, 300);
    launch(e, 1, 0, 600);
    let ticks = 0;
    while (e.state === "launched" && ticks < 600) {
      run(g, 1);
      ticks++;
    }
    const flown = e.x - 300;
    expect(flown).toBeCloseTo(expectedFlight(600), 0);
    expect(flown).toBeGreaterThan(180);
    expect(flown).toBeLessThan(200);
    expect(ticks * DT).toBeGreaterThan(0.55);
    expect(ticks * DT).toBeLessThan(0.7);
    expect(e.state).toBe("walk");
  });

  it("돌덩이(질량 3)는 같은 힘에 훨씬 덜 날아간다", () => {
    const g = emptyGame();
    const e = put(g, "red", 300, 300, { kind: "stone" });
    launch(e, 1, 0, 600);
    run(g, 120);
    expect(e.x - 300).toBeLessThan(40);
  });

  it("발사된 적은 울타리에 튕기고 쿠션 횟수가 남는다", () => {
    const g = emptyGame();
    const e = put(g, "red", 60, 300);
    launch(e, -1, 0, 900);
    run(g, 6);
    expect(e.vx).toBeGreaterThan(0);
    expect(e.wallBounces).toBe(1);
    expect(e.x).toBeGreaterThanOrEqual(e.radius);
  });

  it("평소 상태 적은 울타리를 넘지 못한다", () => {
    const g = emptyGame();
    const e = put(g, "red", 20, 20, { moving: true });
    e.x = -50;
    run(g, 1);
    expect(e.x).toBeGreaterThanOrEqual(e.radius);
  });
});

describe("1.2 물리: 겹침 해소", () => {
  it("겹친 두 적은 떨어지되 접촉 판정 안에 남는다 (붙어 있지만 겹치지 않음)", () => {
    const g = emptyGame();
    const a = put(g, "red", 400, 400);
    const b = put(g, "red", 410, 400);
    run(g, 30);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    expect(d).toBeGreaterThan(a.radius + b.radius - 0.5);
    expect(d).toBeLessThanOrEqual(a.radius + b.radius + RULES.physics.contactSlack);
  });

  it("적은 플레이어와 겹치지 않는다", () => {
    const g = emptyGame();
    const e = put(g, "red", g.player.x + 5, g.player.y);
    run(g, 1);
    expect(Math.hypot(e.x - g.player.x, e.y - g.player.y)).toBeGreaterThanOrEqual(g.player.radius + e.radius - 1e-6);
  });
});

describe("1.2 물리: 다른 색 충돌 (당구)", () => {
  it("무거운 돌덩이가 젤리를 치면 젤리가 발사 상태로 날아간다", () => {
    const g = emptyGame();
    const stone = put(g, "blue", 300, 400, { kind: "stone" });
    const jelly = put(g, "red", 350, 400);
    launch(stone, 1, 0, 2400);
    const events = run(g, 3);
    expect(events.some((e) => e.type === "bounce")).toBe(true);
    expect(jelly.state).toBe("launched");
    expect(jelly.vx).toBeGreaterThan(RULES.physics.launchEndSpeed);
  });

  it("가벼운 젤리가 돌덩이를 치면 돌덩이는 기절하고 젤리는 거의 멈춘다", () => {
    const g = emptyGame();
    const jelly = put(g, "red", 300, 400);
    const stone = put(g, "blue", 340, 400, { kind: "stone" });
    launch(jelly, 1, 0, 300);
    run(g, 3);
    expect(stone.state).toBe("stunned");
    expect(jelly.state).toBe("stunned");
  });
});
