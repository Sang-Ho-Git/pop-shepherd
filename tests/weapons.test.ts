import { describe, expect, it } from "vitest";
import { weapon } from "../src/data/index.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";
import { emptyGame, put, run } from "./helpers.ts";

describe("무기 동작 모듈 (M1 3종)", () => {
  it("충격파(pulse): 반경 안의 적을 플레이어 바깥쪽으로 날리고 쿨다운을 건다", () => {
    const w = makeWeapon(weapon("shockwave"), 1);
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    const right = put(g, "red", x + 80, y);
    const up = put(g, "blue", x, y - 80);
    const far = put(g, "red", x + 400, y);
    run(g, 1);
    expect(right.vx).toBeGreaterThan(0);
    expect(up.vy).toBeLessThan(0);
    expect(far.state).toBe("walk");
    expect(w.fires).toBe(1);
    expect(w.hits).toBe(2);
    expect(w.cd).toBeCloseTo(2.6);
    expect(right.hp).toBe(20 - 3);
  });

  it("충격파: 범위에 적이 없으면 쏘지 않고 기다린다", () => {
    const w = makeWeapon(weapon("shockwave"), 1);
    const g = emptyGame({ weapons: [w] });
    put(g, "red", g.player.x + 500, g.player.y);
    run(g, 30);
    expect(w.fires).toBe(0);
    expect(w.cd).toBe(0);
  });

  it("킥(directional): 바라보는 방향 부채꼴 안의 가장 가까운 적 하나를 그 방향으로 정확히 날린다", () => {
    const w = makeWeapon(weapon("kick"), 1);
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    const front = put(g, "red", x + 50, y + 10);
    const front2 = put(g, "red", x + 80, y - 30);
    const behind = put(g, "red", x - 40, y);
    run(g, 1);
    expect(front.state).toBe("launched");
    expect(front.vy).toBeCloseTo(0);
    expect(front.vx).toBeCloseTo(600, 0);
    expect(front2.state).toBe("walk");
    expect(behind.state).toBe("walk");
    expect(w.hits).toBe(1);
  });

  it("킥: 이동하면 바라보는 방향이 바뀐다", () => {
    const w = makeWeapon(weapon("kick"), 1);
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    const below = put(g, "red", x, y + 60);
    run(g, 1, { moveX: 0, moveY: 1, whistle: false });
    expect(g.player.faceY).toBe(1);
    expect(below.state).toBe("launched");
    expect(below.vy).toBeGreaterThan(0);
  });

  it("자석 토템(zone): 범위에서 가장 많은 색만 끌어모은다", () => {
    const w = makeWeapon(weapon("magnet_totem"), 1);
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    const reds = [put(g, "red", x + 120, y), put(g, "red", x - 120, y), put(g, "red", x, y + 120)];
    const blue = put(g, "blue", x, y - 120);
    run(g, 1);
    expect(g.totems).toHaveLength(1);
    expect(g.totems[0]?.color).toBe("red");
    g.player.x = 200;
    g.player.y = 200;
    const before = reds.map((r) => Math.hypot(r.x - x, r.y - y));
    const blueBefore = Math.hypot(blue.x - x, blue.y - y);
    run(g, 30);
    reds.forEach((r, i) => expect(Math.hypot(r.x - x, r.y - y)).toBeLessThan(before[i] as number));
    expect(Math.hypot(blue.x - x, blue.y - y)).toBeCloseTo(blueBefore, 0);
    run(g, 4 * 60);
    expect(g.totems).toHaveLength(0);
  });

  it("자석 토템: 타격 수는 지속 시간 동안 끌어온 서로 다른 적 수다 (세운 뒤 들어온 적도 센다)", () => {
    const w = makeWeapon(weapon("magnet_totem"), 1);
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    put(g, "red", x + 100, y);
    put(g, "red", x - 100, y);
    run(g, 1);
    expect(w.hits).toBe(2);
    g.player.x = 200;
    g.player.y = 200;
    put(g, "red", x, y + 120);
    run(g, 2);
    expect(w.hits).toBe(3);
    run(g, 30);
    expect(w.hits).toBe(3);
  });

  it("캐릭터 날리는 힘 배율이 발사 속도에 곱해진다 (큐 125%)", () => {
    const w = makeWeapon(weapon("kick"), 1);
    const g = emptyGame({ weapons: [w], characterId: "cue" });
    const e = put(g, "red", g.player.x + 50, g.player.y);
    run(g, 1);
    expect(e.vx).toBeCloseTo(750, 0);
  });

  it("동작이 없는 무기나 Lv4 이후 분기는 장착할 수 없다", () => {
    expect(() => makeWeapon(weapon("lasso"), 1)).toThrow(/동작 모듈/);
    expect(() => makeWeapon(weapon("kick"), 4, "A")).toThrow(/분기/);
    expect(() => makeWeapon(weapon("kick"), "evo")).toThrow(/분기/);
  });
});
