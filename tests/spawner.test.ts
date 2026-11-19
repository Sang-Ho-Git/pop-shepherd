import { describe, expect, it } from "vitest";
import { RULES } from "../src/core/rules.ts";
import { createGame } from "../src/core/game.ts";
import type { Color, Enemy, StageDef } from "../src/core/types.ts";
import { colorWeights, spawnColors, spawnGroup, spawnInterval, tickSpawner } from "../src/combat/spawner.ts";
import { touching } from "../src/combat/match.ts";
import { character, ENEMIES, stage } from "../src/data/index.ts";
import { Rng } from "../src/core/rng.ts";

function stageGame(st: StageDef, seed = 1) {
  return createGame({ seed, character: character("shepherd"), enemyDefs: ENEMIES, stage: st });
}

/** 같은 색으로 서로 닿아 이어진 가장 큰 무리의 크기 */
function largestSameColorCluster(enemies: Enemy[]): number {
  const seen = new Set<Enemy>();
  let best = 0;
  for (const start of enemies) {
    if (seen.has(start)) continue;
    let size = 0;
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const e = queue.pop()!;
      size++;
      for (const o of enemies) {
        if (seen.has(o) || o.color !== start.color || !touching(e, o)) continue;
        seen.add(o);
        queue.push(o);
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

describe("1.7 출현 보정", () => {
  it("1~2마리만 남은 색은 가중치 3, 0마리나 3마리 이상은 1", () => {
    const counts = new Map<Color, number>([
      ["red", 1],
      ["blue", 2],
      ["yellow", 3],
    ]);
    expect(colorWeights(["red", "blue", "yellow", "green"], counts)).toEqual([3, 3, 1, 1]);
  });

  it("혼자 남은 색이 더 자주 소환된다 (빨강 1마리, 파랑 3마리 → 빨강 약 75%)", () => {
    const rng = new Rng(5);
    const w = colorWeights(["red", "blue"], new Map<Color, number>([["red", 1], ["blue", 3]]));
    let red = 0;
    for (let i = 0; i < 4000; i++) if (rng.weighted(["red", "blue"], w) === "red") red++;
    expect(red / 4000).toBeGreaterThan(0.71);
    expect(red / 4000).toBeLessThan(0.79);
  });

  it("웨이브는 짝(같은 색 2마리) 2~3개이고, 이웃한 짝은 색이 다르다", () => {
    const st: StageDef = { ...stage("m1_proving"), grayRatio: 0 };
    for (let seed = 1; seed <= 30; seed++) {
      const g = stageGame(st, seed);
      spawnGroup(g, st);
      const n = g.enemies.length;
      expect(n % RULES.spawn.pairSize).toBe(0);
      expect(n / 2).toBeGreaterThanOrEqual(RULES.spawn.pairsMin);
      expect(n / 2).toBeLessThanOrEqual(RULES.spawn.pairsMax);
      for (let k = 0; k < n; k += 2) {
        const a = g.enemies[k]!;
        const b = g.enemies[k + 1]!;
        expect(a.color).toBe(b.color);
        expect(touching(a, b)).toBe(true);
        if (k > 0) expect(a.color).not.toBe(g.enemies[k - 2]!.color);
      }
    }
  });

  it("웨이브는 소환되자마자 매치 대상이 아니다 (같은 색 접촉 무리가 2마리 이하)", () => {
    const st: StageDef = { ...stage("m1_proving"), grayRatio: 0 };
    for (let seed = 1; seed <= 50; seed++) {
      const g = stageGame(st, seed);
      spawnGroup(g, st);
      expect(largestSameColorCluster(g.enemies), `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it("웨이브는 아레나 안, 플레이어에게서 떨어진 곳에 나온다", () => {
    const st: StageDef = { ...stage("m1_proving"), grayRatio: 0 };
    for (let seed = 1; seed <= 30; seed++) {
      const g = stageGame(st, seed);
      spawnGroup(g, st);
      for (const e of g.enemies) {
        expect(e.x).toBeGreaterThan(0);
        expect(e.x).toBeLessThan(g.arena.w);
        expect(e.y).toBeGreaterThan(0);
        expect(e.y).toBeLessThan(g.arena.h);
        expect(Math.hypot(e.x - g.player.x, e.y - g.player.y)).toBeGreaterThan(RULES.view.h / 2);
      }
    }
  });

  it("회색 확률 1이면 짝마다 회색 1마리로 바뀐다", () => {
    const st: StageDef = { ...stage("m1_proving"), grayRatio: 1 };
    const g = stageGame(st);
    spawnGroup(g, st);
    expect(g.enemies.length).toBeGreaterThanOrEqual(RULES.spawn.pairsMin);
    expect(g.enemies.length).toBeLessThanOrEqual(RULES.spawn.pairsMax);
    expect(new Set(g.enemies.map((e) => e.color))).toEqual(new Set(["gray"]));
  });

  it("색이 하나뿐인 스테이지에서도 소환된다", () => {
    const st: StageDef = { ...stage("m1_proving"), grayRatio: 0, colors: ["red"] };
    const g = stageGame(st);
    spawnGroup(g, st);
    expect(g.enemies.length).toBeGreaterThanOrEqual(4);
  });

  it("살아 있는 적이 상한에 닿으면 더 소환하지 않는다", () => {
    const st: StageDef = { ...stage("m1_proving"), grayRatio: 0, maxAlive: 4 };
    const g = stageGame(st);
    for (let i = 0; i < 10; i++) spawnGroup(g, st);
    expect(g.enemies.length).toBe(4);
  });

  it("출현 간격은 시간대 표를 따르고, 표가 끝나면 마지막 값을 쓴다", () => {
    const st = stage("m1_proving");
    expect(spawnInterval(st, 0)).toBe(3.5);
    expect(spawnInterval(st, 61)).toBe(2.8);
    expect(spawnInterval(st, 299)).toBe(1.6);
    expect(spawnInterval(st, 999)).toBe(1.6);
  });

  it("타이머: 시작하자마자 한 무리, 그 뒤로 간격마다 한 무리", () => {
    const st: StageDef = { ...stage("m1_proving"), grayRatio: 0 };
    const g = stageGame(st);
    tickSpawner(g, 1 / 60);
    const first = g.enemies.length;
    expect(first).toBeGreaterThanOrEqual(RULES.spawn.pairsMin * RULES.spawn.pairSize);
    for (let t = 0; t < 3.4 * 60; t++) tickSpawner(g, 1 / 60);
    expect(g.enemies.length).toBe(first);
    for (let t = 0; t < 0.2 * 60; t++) tickSpawner(g, 1 / 60);
    expect(g.enemies.length).toBeGreaterThan(first);
  });

  it("출현표 구간에 색이 정해져 있으면 그 색만 나온다 (M1 검증장 첫 1분은 빨강·파랑)", () => {
    const st: StageDef = { ...stage("m1_proving"), grayRatio: 0 };
    expect(spawnColors(st, 30)).toEqual(["red", "blue"]);
    expect(spawnColors(st, 90)).toEqual(["red", "blue", "yellow"]);
    for (let seed = 1; seed <= 20; seed++) {
      const g = stageGame(st, seed);
      for (let k = 0; k < 5; k++) spawnGroup(g, st);
      for (const e of g.enemies) expect(["red", "blue"]).toContain(e.color);
    }
  });

  it("스테이지 시간이 끝나면 소환을 멈춘다", () => {
    const st: StageDef = { ...stage("m1_proving"), grayRatio: 0 };
    const g = stageGame(st);
    g.time = st.duration;
    tickSpawner(g, 1 / 60);
    expect(g.enemies).toHaveLength(0);
  });
});
