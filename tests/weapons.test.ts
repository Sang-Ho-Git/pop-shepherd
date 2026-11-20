import { describe, expect, it } from "vitest";
import { weapon } from "../src/data/index.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";
import { emptyGame, pops, put, run } from "./helpers.ts";
import { launch } from "../src/world/physics.ts";

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
    expect(g.events.find((e) => e.type === "fire")).toMatchObject({ weapon: "kick", hits: 1, ids: [front.id] });
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

  it("동작이 없는 무기는 장착할 수 없고, Lv4 이후는 갈래가 필요하다", () => {
    expect(() => makeWeapon({ ...weapon("whirlwind"), implemented: false }, 1)).toThrow(/동작 모듈/);
    expect(() => makeWeapon(weapon("kick"), 4)).toThrow(/갈래/);
    expect(makeWeapon(weapon("kick"), 4, "B").level.params.stunOnImpact).toBe(1);
    expect(makeWeapon(weapon("kick"), "evo").level.lv).toBe("evo");
  });

  it("올가미(pull): 떨어진 적을 같은 색 무리에게 끌어다 부딪혀 터뜨린다", () => {
    const w = makeWeapon(weapon("lasso"), 1);
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    // 빨강 둘이 붙어 있고, 떨어진 빨강 하나, 파랑 하나
    put(g, "red", x + 100, y);
    put(g, "red", x + 128, y);
    const lone = put(g, "red", x - 150, y + 60);
    put(g, "blue", x, y + 200);
    const events = run(g, 90);
    expect(w.fires).toBe(1);
    expect(lone.dead).toBe(true);
    expect(pops(events)[0]?.size).toBe(3);
  });

  it("올가미: 같은 색 짝이 없으면 쏘지 않는다", () => {
    const w = makeWeapon(weapon("lasso"), 1);
    const g = emptyGame({ weapons: [w] });
    put(g, "red", g.player.x + 100, g.player.y);
    put(g, "blue", g.player.x - 100, g.player.y);
    run(g, 30);
    expect(w.fires).toBe(0);
  });

  it("올가미 Lv3: 같은 색 2마리를 같은 짝에게 끌어온다", () => {
    const w = makeWeapon(weapon("lasso"), 3);
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    put(g, "blue", x + 120, y);
    put(g, "blue", x - 150, y);
    put(g, "blue", x, y - 160);
    run(g, 1);
    expect(w.hits).toBe(2);
  });

  it("페인트 총(projectile): 옆 무리의 색으로 칠하고 밀어 붙여 터뜨린다", () => {
    const w = makeWeapon(weapon("paint_gun"), 1);
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    put(g, "green", x + 200, y);
    put(g, "green", x + 228, y);
    const odd = put(g, "yellow", x + 172, y + 4);
    const events = run(g, 60);
    expect(w.fires).toBe(1);
    expect(odd.dead).toBe(true);
    expect(pops(events)[0]).toMatchObject({ size: 3, color: "green" });
  });

  it("페인트 총: 칠해서 짝이 생기는 적이 없으면 쏘지 않는다", () => {
    const w = makeWeapon(weapon("paint_gun"), 1);
    const g = emptyGame({ weapons: [w] });
    put(g, "red", g.player.x + 150, g.player.y);
    put(g, "blue", g.player.x - 150, g.player.y);
    run(g, 30);
    expect(w.fires).toBe(0);
  });

  it("회오리(orbit): 칼날이 둘레를 돌며 닿은 적을 접선 방향으로 튕기고, 한 바퀴를 발사 1회로 센다", () => {
    const w = makeWeapon(weapon("whirlwind"), 1);
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    // 칼날은 각도 0(오른쪽)에서 출발해 아래쪽(+y)으로 돈다
    const e = put(g, "red", x + 80, y + 10);
    run(g, 3);
    expect(e.state).toBe("launched");
    expect(e.vy).toBeGreaterThan(0);
    // 한 바퀴 = 쿨다운
    run(g, Math.ceil(w.level.cooldown * 60) - 3);
    expect(w.fires).toBe(1);
    expect(w.hits).toBe(1);
  });

  it("회오리 4B 강풍: 바깥 방향으로 튕긴다", () => {
    const w = makeWeapon(weapon("whirlwind"), 4, "B");
    const g = emptyGame({ weapons: [w] });
    const e = put(g, "red", g.player.x + 95, g.player.y + 5);
    run(g, 3);
    expect(e.vx).toBeGreaterThan(Math.abs(e.vy));
  });

  it("반사벽(wall): 앞에 적이 있으면 벽을 세우고, 날아온 적을 되튕겨 쿠션으로 센다", () => {
    const w = makeWeapon(weapon("reflect_wall"), 1);
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    put(g, "red", x + 250, y);
    put(g, "blue", x + 250, y + 60);
    put(g, "green", x + 250, y - 60);
    run(g, 1);
    expect(g.walls).toHaveLength(1);
    const first = g.walls[0]!;
    const shot = put(g, "yellow", x + 60, y);
    launch(shot, 1, 0, 700);
    run(g, 20);
    expect(shot.vx).toBeLessThan(0);
    expect(shot.wallBounces).toBe(1);
    expect(w.hits).toBe(1);
    // 첫 벽은 지속 시간이 지나면 사라진다 (쿨다운이 더 짧으면 그사이 새 벽이 선다)
    run(g, Math.ceil(w.level.params.duration! * 60));
    expect(g.walls).not.toContain(first);
  });

  it("반사벽 진화 만화경: 플레이어를 둘러싼 벽 3장", () => {
    const w = makeWeapon(weapon("reflect_wall"), "evo");
    const g = emptyGame({ weapons: [w] });
    const { x, y } = g.player;
    for (let i = 0; i < 3; i++) put(g, "red", x + 200, y + (i - 1) * 50);
    run(g, 1);
    expect(g.walls).toHaveLength(3);
  });
});
