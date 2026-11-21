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

  it("다른 색에 맞으면 밀어내고 공은 사라진다", () => {
    const g = ballGame();
    g.ball!.current = "green";
    const { x, y } = g.player;
    const e = put(g, "yellow", x + 200, y);
    step(g, throwAt(x + 200, y));
    run(g, 20);
    expect(e.x).toBeGreaterThan(x + 210);
    expect(g.balls).toHaveLength(0);
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
