import { describe, expect, it } from "vitest";
import { createGame, stateHash, step } from "../src/core/game.ts";
import { character, ENEMIES, stage, weapon } from "../src/data/index.ts";
import { botInput } from "../src/sim/bot.ts";
import { aggregate, runSim } from "../src/sim/run.ts";
import type { SimReport } from "../src/sim/run.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";

const M1_WEAPONS = [
  { id: "shockwave", lv: 3 },
  { id: "kick", lv: 3 },
  { id: "magnet_totem", lv: 3 },
];

function playSeconds(seed: number, seconds: number) {
  const g = createGame({
    seed,
    character: character("shepherd"),
    enemyDefs: ENEMIES,
    stage: stage("m1_proving"),
    weapons: M1_WEAPONS.map((w) => makeWeapon(weapon(w.id), w.lv)),
  });
  for (let t = 0; t < seconds * 60; t++) step(g, botInput(g));
  return g;
}

describe("5.3 재현성", () => {
  it("같은 시드는 60초 뒤 상태가 비트 단위로 같다", () => {
    expect(stateHash(playSeconds(11, 60))).toBe(stateHash(playSeconds(11, 60)));
  });

  it("시드가 다르면 다른 판이 된다", () => {
    expect(stateHash(playSeconds(11, 60))).not.toBe(stateHash(playSeconds(12, 60)));
  });

  it("2분 동안 위치·속도에 NaN이나 무한대가 생기지 않는다", () => {
    const g = playSeconds(3, 120);
    for (const e of g.enemies) {
      for (const v of [e.x, e.y, e.vx, e.vy]) expect(Number.isFinite(v)).toBe(true);
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(g.arena.w);
    }
  });
});

describe("6.3 헤드리스 시뮬레이터", () => {
  it("봇이 2분을 플레이하면 팝이 일어나고 지표가 정상 범위에 있다", () => {
    const r = runSim({ seed: 1, stageId: "m1_proving", characterId: "shepherd", weapons: M1_WEAPONS, seconds: 120 });
    expect(r.survived).toBeGreaterThan(0);
    expect(r.pops).toBeGreaterThan(0);
    expect(r.matchKillRatio).toBeGreaterThanOrEqual(0);
    expect(r.matchKillRatio).toBeLessThanOrEqual(1);
    expect(r.avgChain).toBeGreaterThanOrEqual(1);
    for (const w of r.weapons) expect(w.fires, w.id).toBeGreaterThan(0);
  });

  it("시트의 타격 수 가정값이 봇 실측의 ±25% 안에 있다 (충격파·자석 토템 Lv3)", () => {
    const reps = Array.from({ length: 6 }, (_, i) =>
      runSim({ seed: i + 1, stageId: "m1_proving", characterId: "shepherd", weapons: M1_WEAPONS }),
    );
    for (const id of ["shockwave", "magnet_totem"]) {
      const ws = reps.flatMap((r) => r.weapons.filter((w) => w.id === id));
      const fires = ws.reduce((s, w) => s + w.fires, 0);
      const measured = ws.reduce((s, w) => s + w.avgHits * w.fires, 0) / fires;
      const assumed = ws[0]!.assumedTargets;
      expect(Math.abs(measured / assumed - 1), `${id}: 실측 ${measured.toFixed(2)} / 가정 ${assumed}`).toBeLessThan(0.25);
    }
  }, 60_000);

  it("M1 판정: 세 기준을 모두 넘어야 통과", () => {
    const base: SimReport = {
      seed: 1, stage: "x", character: "x", seconds: 60, survived: 60, died: false, cleared: true, wrapUpPopped: 0, vanished: 0, spawned: 0, alivePeak: 0,
      pops: 0, poppedEnemies: 0, killedEnemies: 0, matchKillRatio: 0.8, avgChain: 1.4, matchChain: 1.5, bombPops: 0, maxChain: 2, stalls: 0,
      stallsPerMinute: 0.5, xp: 0, popsBy: {}, weapons: [],
    };
    expect(aggregate([base]).pass.all).toBe(true);
    expect(aggregate([{ ...base, avgChain: 1.2 }]).pass.all).toBe(false);
    expect(aggregate([{ ...base, stallsPerMinute: 1 }]).pass.stallsPerMinute).toBe(false);
  });
});
