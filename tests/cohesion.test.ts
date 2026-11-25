import { afterEach, describe, expect, it } from "vitest";
import { RULES } from "../src/core/rules.ts";
import { emptyGame, put, run } from "./helpers.ts";

const coh = RULES.cohesion as { speed: number; mode: string };
const saved = { ...coh };
afterEach(() => Object.assign(coh, saved));

describe("같은 색 응집 (11/25 시험안 포함)", () => {
  it("기본은 개별 끌림: 근처 같은 색 쪽으로 다가간다", () => {
    expect(RULES.cohesion.mode).toBe("pull");
    const g = emptyGame();
    const a = put(g, "red", 300, 300, { moving: true });
    const b = put(g, "red", 400, 300, { moving: true });
    g.player.x = 350;
    g.player.y = 1000;
    run(g, 30);
    expect(Math.abs(a.x - b.x)).toBeLessThan(100);
  });

  it("응집 없앰(speed 0): 같은 색이라도 서로 다가가지 않는다", () => {
    coh.speed = 0;
    const g = emptyGame();
    const a = put(g, "red", 300, 300, { moving: true });
    const b = put(g, "red", 400, 300, { moving: true });
    g.player.x = 350;
    g.player.y = 5000;
    run(g, 30);
    // 플레이어가 둘 사이 아래에 있어 추적만으로도 조금 가까워진다. 끌림이 없으면 기본보다 덜 가까워진다
    const gap = Math.abs(a.x - b.x);
    Object.assign(coh, saved);
    const h = emptyGame();
    const c = put(h, "red", 300, 300, { moving: true });
    const d = put(h, "red", 400, 300, { moving: true });
    h.player.x = 350;
    h.player.y = 5000;
    run(h, 30);
    expect(gap).toBeGreaterThan(Math.abs(c.x - d.x) + 5);
  });

  it("무리로 걷기(flock): 같은 무리는 대형을 지키며 같은 방향으로 걷고, 멀어진 적은 무리를 떠난다", () => {
    coh.mode = "flock";
    const g = emptyGame();
    const a = put(g, "red", 300, 300, { moving: true });
    const b = put(g, "red", 300, 360, { moving: true });
    a.groupId = b.groupId = a.id;
    g.player.x = 1500;
    g.player.y = 900;
    run(g, 60);
    // 대형(위아래로 60px)이 그대로다. 개별 끌림이면 서로 다가가 간격이 줄고, 각자 쫓으면 방향이 갈라진다
    expect(b.x - a.x).toBeCloseTo(0, 1);
    expect(b.y - a.y).toBeCloseTo(60, 1);
    expect(a.x).toBeGreaterThan(330);
    // 한 마리가 멀리 떨어지면 무리를 떠난다
    b.x = 1000;
    run(g, 1);
    expect(b.groupId).toBeUndefined();
  });
});
