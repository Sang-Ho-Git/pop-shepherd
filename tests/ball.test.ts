import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { Input } from "../src/core/types.ts";
import { character, ENEMIES } from "../src/data/index.ts";
import { addPassive } from "../src/progression/passives.ts";
import { pops, put, run } from "./helpers.ts";
import { step } from "../src/core/game.ts";

function ballGame() {
  const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, ballMode: true });
  g.player.hp = g.player.maxHp = 1e9;
  run(g, 1);
  return g;
}

const throwAt = (x: number, y: number): Input => ({ moveX: 0, moveY: 0, whistle: false, aimX: x, aimY: y, throwBall: true });

describe("색 공 던지기 (실험 규칙)", () => {
  it("같은 색 둘이 붙은 무리에 던지면 공까지 셋이라 터진다", () => {
    const g = ballGame();
    g.ball!.current = "red";
    const { x, y } = g.player;
    put(g, "red", x + 200, y);
    put(g, "red", x + 228, y);
    step(g, throwAt(x + 200, y));
    const p = pops(run(g, 30));
    expect(p[0]).toMatchObject({ size: 2, color: "red" });
    expect(g.stats.ballPops).toBe(1);
  });

  it("같은 색 하나뿐이면 공이 그 옆에 젤리로 붙는다", () => {
    const g = ballGame();
    g.ball!.current = "blue";
    const { x, y } = g.player;
    put(g, "blue", x + 200, y);
    step(g, throwAt(x + 200, y));
    run(g, 30);
    expect(g.enemies.filter((e) => e.color === "blue")).toHaveLength(2);
  });

  it("다른 색에 맞으면 적은 살짝 밀리기만 하고(날리지 않음) 공은 당구처럼 튕겨 느려진다", () => {
    const g = ballGame();
    g.ball!.current = "green";
    const { x, y } = g.player;
    const e = put(g, "yellow", x + 200, y);
    step(g, throwAt(x + 200, y));
    const events = run(g, 12);
    expect(events.some((ev) => ev.type === "ball-bounce")).toBe(true);
    expect(e.x).toBeGreaterThan(x + 205);
    expect(e.state).toBe("walk");
    const b = g.balls[0]!;
    expect(b.vx).toBeLessThan(0); // 되돌아 온다
    expect(Math.hypot(b.vx, b.vy)).toBeLessThan(RULES.ball.speed * RULES.ball.caromKeep);
  });

  it("섞인 무리에서 다른 색을 맞혀도 뒤의 같은 색이 반동으로 터지지 않는다 (버그 수정)", () => {
    const g = ballGame();
    g.ball!.current = "green";
    const { x, y } = g.player;
    put(g, "yellow", x + 200, y);
    put(g, "yellow", x + 230, y);
    put(g, "green", x + 228, y + 26);
    step(g, throwAt(x + 200, y));
    expect(pops(run(g, 60))).toHaveLength(0);
  });

  it("회색에 맞으면 회색이 공 색으로 물든다", () => {
    const g = ballGame();
    g.ball!.current = "blue";
    const { x, y } = g.player;
    const gr = put(g, "gray", x + 200, y);
    step(g, throwAt(x + 200, y));
    run(g, 20);
    expect(gr.color).toBe("blue");
  });

  it("색 공 규칙에서는 무기로 날린 적이 같은 색에 부딪혀도 터지지 않고 붙는다 (터뜨리는 것은 공)", async () => {
    const { launch, WEAPON_LAUNCH } = await import("../src/world/physics.ts");
    const g = ballGame();
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    put(g, "red", 528, 400);
    launch(a, 1, 0, 600, WEAPON_LAUNCH);
    expect(pops(run(g, 20))).toHaveLength(0);
  });

  it("던지면 다음 공이 손에 오고, 쿨다운 동안은 못 던진다", () => {
    const g = ballGame();
    const next = g.ball!.next;
    step(g, throwAt(g.player.x + 100, g.player.y));
    expect(g.ball!.current).toBe(next);
    step(g, throwAt(g.player.x + 100, g.player.y));
    expect(g.stats.ballsThrown).toBe(1);
    run(g, Math.ceil(RULES.ball.cooldown * 60));
    step(g, throwAt(g.player.x + 100, g.player.y));
    expect(g.stats.ballsThrown).toBe(2);
  });

  it("길잡이 별: 빗나간 조준을 같은 색 무리 쪽으로 꺾는다", () => {
    const g = ballGame();
    addPassive(g, "guiding_star");
    g.ball!.current = "red";
    const { x, y } = g.player;
    put(g, "red", x + 200, y + 80);
    put(g, "red", x + 228, y + 80);
    step(g, throwAt(x + 200, y));
    expect(pops(run(g, 30))).toHaveLength(1);
  });

  it("색 공 전용 패시브는 기존 규칙에서는 카드로 나오지 않는다", async () => {
    const { candidates } = await import("../src/progression/levelup.ts");
    const g = createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null });
    expect(candidates(g).newPassive.some((c) => c.kind === "newPassive" && c.id === "guiding_star")).toBe(false);
    expect(candidates(ballGame()).newPassive.some((c) => c.kind === "newPassive" && c.id === "guiding_star")).toBe(true);
  });
});

describe("색 공 울타리 쿠션", () => {
  it("공은 울타리에서 한 번 튕기고, 튕긴 뒤 터뜨리면 쿠션 팝", () => {
    const g = ballGame();
    g.player.x = 200;
    g.player.y = 700;
    g.ball!.current = "red";
    // 왼쪽 울타리로 던지면 튕겨 돌아와 오른쪽 무리에 맞는다
    put(g, "red", 330, 700);
    put(g, "red", 358, 700);
    step(g, throwAt(0, 700));
    const events = run(g, 60);
    expect(events.some((e) => e.type === "ball-cushion")).toBe(true);
    expect(pops(events)[0]).toMatchObject({ cushion: true });
  });

  it("굴러가며 느려지다 멈추면 사라진다 (쿠션마다 속도를 잃는다)", () => {
    const g = ballGame();
    g.ball!.current = "blue";
    step(g, throwAt(g.player.x + 100, g.player.y - 40));
    const events = run(g, 240);
    expect(events.some((e) => e.type === "ball-miss")).toBe(true);
    expect(g.balls).toHaveLength(0);
  });

  it("쿠션을 많이 거친 팝일수록 경험치를 더 준다 (3쿠션 이상이 가장 크다)", async () => {
    const { popCluster } = await import("../src/combat/pops.ts");
    const xpOf = (cushions: number): number => {
      const g = ballGame();
      const a = put(g, "red", 400, 400);
      put(g, "red", 428, 400);
      put(g, "red", 456, 400);
      const before = g.stats.xp;
      popCluster(g, [0, 1, 2].map((k) => g.enemies.length - 3 + k), a, "red", { by: "ball", cushions });
      return g.stats.xp - before;
    };
    const [x0, x1, x3] = [xpOf(0), xpOf(1), xpOf(3)];
    expect(x1).toBeCloseTo(x0 * (1 + RULES.ball.cushionBonus[1]!));
    expect(x3).toBeCloseTo(x0 * (1 + RULES.ball.cushionBonus[3]!));
  });

  it("반사벽에서도 튕긴다 (쿠션으로 센다)", () => {
    const g = ballGame();
    const { x, y } = g.player;
    g.walls.push({ x1: x + 150, y1: y - 100, x2: x + 150, y2: y + 100, t: 5, weapon: g.weapons[0]!, boost: 1, aimAssist: false, shock: 0 });
    g.ball!.current = "blue";
    step(g, throwAt(x + 300, y));
    const events = run(g, 20);
    expect(events.filter((e) => e.type === "ball-cushion")).toHaveLength(1);
    expect(g.balls[0]!.vx).toBeLessThan(0);
  });

  it("반사벽은 어느 쪽에서 오는 공이든 똑같이 튕긴다", () => {
    const g = ballGame();
    const { x, y } = g.player;
    g.walls.push({ x1: x + 150, y1: y - 100, x2: x + 150, y2: y + 100, t: 5, weapon: g.weapons[0]!, boost: 1, aimAssist: false, shock: 0 });
    g.ball!.current = "blue";
    step(g, throwAt(x + 300, y));
    let events = run(g, 20);
    expect(events.filter((e) => e.type === "ball-cushion")).toHaveLength(1);
    expect(g.balls[0]!.vx).toBeLessThan(0);
    // 바깥에서 플레이어 쪽으로 오는 공도 튕긴다
    g.balls = [{ x: x + 260, y, vx: -900, vy: 0, color: "blue", travel: 0, bounces: 0, lastHit: -1 }];
    events = run(g, 20);
    expect(events.filter((e) => e.type === "ball-cushion")).toHaveLength(1);
    expect(g.balls[0]!.vx).toBeGreaterThan(0);
  });

  it("조준선 미리보기는 울타리에서 꺾인다", async () => {
    const { predictBallPath } = await import("../src/combat/ball.ts");
    const g = ballGame();
    g.player.x = 100;
    g.player.y = 300;
    const pts = predictBallPath(g, Math.PI * 0.9, 2);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...pts.map((p) => p.x))).toBeLessThanOrEqual(RULES.ball.radius + 1);
  });
});

describe("색 공 바꾸기", () => {
  it("swapBall이면 지금 공과 다음 공이 바뀐다", () => {
    const g = ballGame();
    g.ball!.current = "red";
    g.ball!.next = "blue";
    step(g, { moveX: 0, moveY: 0, whistle: false, swapBall: true });
    expect([g.ball!.current, g.ball!.next]).toEqual(["blue", "red"]);
  });
});
