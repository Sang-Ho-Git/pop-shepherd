import { describe, expect, it } from "vitest";
import { resolveMatchColor } from "../src/combat/match.ts";
import { launch } from "../src/world/physics.ts";
import { alive, emptyGame, pops, put, run } from "./helpers.ts";

describe("1.4 매치 색 판정", () => {
  it.each([
    ["red", "red", "match:red"],
    ["red", "blue", "bounce"],
    ["red", "rainbow", "match:red"],
    ["rainbow", "blue", "match:blue"],
    ["rainbow", "rainbow", "stick"],
    ["gray", "gray", "bounce"],
    ["gray", "red", "bounce"],
    ["rainbow", "gray", "bounce"],
  ] as const)("%s + %s → %s", (a, b, want) => {
    const r = resolveMatchColor(a, b);
    expect(r.kind === "match" ? `match:${r.color}` : r.kind).toBe(want);
  });
});

describe("1.4 충돌 매치", () => {
  it("같은 색이 붙어 있기만 해서는 터지지 않는다", () => {
    const g = emptyGame();
    for (let i = 0; i < 5; i++) put(g, "red", 400 + i * 28, 400);
    const events = run(g, 300);
    expect(pops(events)).toHaveLength(0);
    expect(g.enemies).toHaveLength(5);
  });

  it("발사된 빨강이 붙어 있는 빨강 둘에 부딪치면 셋이 함께 터진다", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    put(g, "red", 528, 400);
    launch(a, 1, 0, 600);
    const p = pops(run(g, 10));
    expect(p).toHaveLength(1);
    expect(p[0]?.size).toBe(3);
    expect(p[0]?.color).toBe("red");
    expect(g.enemies).toHaveLength(0);
  });

  it("같은 색 하나에만 부딪치면 터지지 않고 그 옆에 멈춰 붙는다", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    const b = put(g, "red", 500, 400);
    launch(a, 1, 0, 600);
    const events = run(g, 10);
    expect(pops(events)).toHaveLength(0);
    expect(events.some((e) => e.type === "stick")).toBe(true);
    expect(a.state).toBe("walk");
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(33);
  });

  it("붙어 있던 짝에 같은 색을 하나 더 날리면 터진다", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    launch(a, 1, 0, 600);
    run(g, 30);
    const c = put(g, "red", 300, 400);
    launch(c, 1, 0, 900);
    const p = pops(run(g, 20));
    expect(p).toHaveLength(1);
    expect(p[0]?.size).toBe(3);
  });

  it("다른 색에 부딪치면 튕기고 아무것도 터지지 않는다", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    const b = put(g, "blue", 500, 400);
    put(g, "blue", 528, 400);
    launch(a, 1, 0, 600);
    const events = run(g, 10);
    expect(pops(events)).toHaveLength(0);
    expect(events.some((e) => e.type === "bounce")).toBe(true);
    expect(b.state === "stunned" || b.state === "launched").toBe(true);
  });

  it("회색은 회색끼리도 매치되지 않는다", () => {
    const g = emptyGame();
    const a = put(g, "gray", 440, 400);
    put(g, "gray", 500, 400);
    put(g, "gray", 528, 400);
    launch(a, 1, 0, 600);
    expect(pops(run(g, 10))).toHaveLength(0);
  });

  it("무지개는 같은 색 무리를 이어 준다", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    put(g, "rainbow", 528, 400);
    put(g, "red", 556, 400);
    put(g, "blue", 584, 400);
    launch(a, 1, 0, 600);
    const p = pops(run(g, 10));
    expect(p).toHaveLength(1);
    expect(p[0]?.size).toBe(4);
    expect(g.enemies.map((e) => e.color)).toEqual(["blue"]);
  });

  it("무지개끼리만으로는 터지지 않는다", () => {
    const g = emptyGame();
    const a = put(g, "rainbow", 440, 400);
    put(g, "rainbow", 500, 400);
    put(g, "rainbow", 528, 400);
    launch(a, 1, 0, 600);
    const events = run(g, 10);
    expect(pops(events)).toHaveLength(0);
    expect(events.some((e) => e.type === "stick")).toBe(true);
  });

  it("함께 밀려 천천히 닿는 것은 부딪침이 아니다 (접근 속도 60px/s 미만)", () => {
    const g = emptyGame();
    // 셋이 한 덩어리로 같은 방향으로 밀려 간다. 서로 닿아 있지만 접근 속도가 작다.
    const a = put(g, "red", 470, 400);
    const b = put(g, "red", 500, 400);
    const c = put(g, "red", 528, 400);
    launch(a, 1, 0, 600);
    launch(b, 1, 0, 580);
    launch(c, 1, 0, 570);
    expect(pops(run(g, 3))).toHaveLength(0);
  });

  it("한 틱에 둘과 닿으면 가장 세게 부딪친 하나만 판정한다", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    // 정면의 파랑 (접근 속도 600)과 비스듬한 빨강 짝 (접근 속도 약 280)에 동시에 닿아 있다.
    const blue = put(g, "blue", 470, 400);
    put(g, "red", 455, 428);
    put(g, "red", 483, 428);
    launch(a, 1, 0, 600);
    const events = run(g, 1);
    expect(pops(events)).toHaveLength(0);
    // A의 판정은 파랑과의 한 번뿐. (날아간 파랑이 빨강을 친 것은 파랑 자신의 당구 충돌이다.)
    const fromA = events.filter((e) => (e.type === "bounce" || e.type === "stick") && e.a === a.id);
    expect(fromA).toEqual([{ type: "bounce", a: a.id, b: blue.id }]);
    expect(alive(g, blue)).toBe(true);
    expect(blue.state === "stunned" || blue.state === "launched").toBe(true);
  });
});
