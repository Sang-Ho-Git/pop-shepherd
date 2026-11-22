import { describe, expect, it } from "vitest";
import { RULES } from "../src/core/rules.ts";
import { chainMultiplier, damage, popShockRadius } from "../src/combat/pops.ts";
import { launch } from "../src/world/physics.ts";
import { emptyGame, pops, put, run } from "./helpers.ts";
import { BALANCE, CAMPAIGN, stage } from "../src/data/index.ts";

describe("1.5 매치 보상", () => {
  it("3매치: 경험치 3, 무리 중심에서 팝 충격파, 맞은 적은 연쇄 1단계로 날아간다, 폭탄 없음", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    put(g, "red", 528, 400);
    const bystander = put(g, "blue", 500, 460);
    const far = put(g, "blue", 700, 400);
    launch(a, 1, 0, 600);
    const events = run(g, 6);
    expect(pops(events)[0]?.xp).toBe(3);
    expect(g.bombs).toHaveLength(0);
    expect(bystander.state).toBe("launched");
    expect(bystander.chainDepth).toBe(1);
    expect(bystander.vy).toBeGreaterThan(0);
    expect(far.state).toBe("walk");
  });

  it("팝 충격파 반경은 3마리 90px에서 1마리마다 15px씩 커진다", () => {
    expect(RULES.match.shockwaveMin).toBe(3);
    expect(popShockRadius(3)).toBe(90);
    expect(popShockRadius(4)).toBe(105);
    expect(popShockRadius(6)).toBe(135);
  });

  it("5매치: 색 폭탄이 (확률로) 떨어지고, 주우면 화면 안의 그 색이 전부 터진다", () => {
    const g = emptyGame();
    g.player.stats = { ...g.player.stats, luck: 100 }; // 확률을 1 이상으로
    const a = put(g, "red", 440, 400);
    for (let i = 0; i < 4; i++) put(g, "red", 500 + i * 28, 400);
    put(g, "red", 700, 500);
    put(g, "red", 400, 700);
    put(g, "red", 2000, 300);
    put(g, "blue", 600, 600);
    launch(a, 1, 0, 600);
    run(g, 6);
    expect(g.bombs).toHaveLength(1);
    const bomb = g.bombs[0];
    if (!bomb) throw new Error("폭탄 없음");
    g.player.x = bomb.x;
    g.player.y = bomb.y;
    const events = run(g, 1);
    expect(events.some((e) => e.type === "bomb-pickup" && e.count === 2)).toBe(true);
    expect(g.enemies.map((e) => `${e.color}@${e.x}`)).toEqual(["red@2000", "blue@600"]);
  });

  it("연쇄: 팝 충격파에 날아간 적이 일으킨 팝은 1단계, 경험치 ×1.5", () => {
    const g = emptyGame();
    // 1단계 팝: 파랑 4마리
    const a = put(g, "blue", 380, 400);
    for (let i = 0; i < 3; i++) put(g, "blue", 440 + i * 28, 400);
    // 파랑 넷의 중심은 x ≈ 455. 충격파(반경 105)가 바로 아래 빨강을 수직으로 날려 아래의 빨강 둘에 꽂는다.
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

describe("색 폭탄은 레어 아이템", () => {
  function fivePop(seed: number, luck = 0, depthTwo = false) {
    const g = emptyGame({ seed });
    g.player.stats = { ...g.player.stats, luck };
    const a = put(g, "red", 440, 400);
    for (let i = 0; i < 4; i++) put(g, "red", 500 + i * 28, 400);
    launch(a, 1, 0, 600, depthTwo ? { chainDepth: 2, chainT: 1 } : undefined);
    run(g, 6);
    return g;
  }

  it("5마리 매치의 드롭 확률은 약 8%, 연쇄 2단계면 약 16%", () => {
    let base = 0;
    let chained = 0;
    for (let s = 1; s <= 600; s++) {
      base += fivePop(s).bombs.length;
      chained += fivePop(s, 0, true).bombs.length;
    }
    expect(base / 600).toBeGreaterThan(0.05);
    expect(base / 600).toBeLessThan(0.11);
    expect(chained / 600).toBeGreaterThan(0.12);
    expect(chained / 600).toBeLessThan(0.21);
  });

  it("스테이지당 최대 2개", () => {
    const g = emptyGame();
    g.player.stats = { ...g.player.stats, luck: 100 };
    for (let k = 0; k < 4; k++) {
      const a = put(g, "red", 200, 200 + k * 200);
      for (let i = 0; i < 4; i++) put(g, "red", 260 + i * 28, 200 + k * 200);
      launch(a, 1, 0, 600);
      run(g, 6);
    }
    expect(g.stats.bombDrops).toBe(RULES.match.bombMaxPerStage);
    expect(g.bombs.length).toBe(2);
  });
});

describe("우유병 (스테이지 안 회복)", () => {
  function chainPop(seed: number, depth: number, healFind = 0) {
    const g = emptyGame({ seed });
    g.player.stats = { ...g.player.stats, heal_find: healFind };
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    put(g, "red", 528, 400);
    launch(a, 1, 0, 600, { chainDepth: depth, chainT: 1 });
    run(g, 6);
    return g;
  }

  it("연쇄 단계 0 팝에서는 떨어지지 않는다", () => {
    for (let s = 1; s <= 100; s++) expect(chainPop(s, 0).milks).toHaveLength(0);
  });

  it("연쇄 단계 1 이상 팝에서 약 15% 확률로 떨어지고, heal_find가 확률을 올린다", () => {
    let base = 0;
    let boosted = 0;
    for (let s = 1; s <= 600; s++) {
      base += chainPop(s, 1).milks.length;
      boosted += chainPop(s, 1, 1).milks.length;
    }
    expect(base / 600).toBeGreaterThan(0.11);
    expect(base / 600).toBeLessThan(0.19);
    expect(boosted / 600).toBeGreaterThan(0.25);
  });

  it("주우면 최대 체력의 8%를 회복하고(최대치 초과 없음), 20초 뒤에는 사라진다", () => {
    const g = emptyGame();
    g.player.hp = 50;
    g.milks.push({ x: g.player.x + 10, y: g.player.y, t: RULES.heal.lifetime });
    run(g, 1);
    expect(g.player.hp).toBeCloseTo(58);
    expect(g.milks).toHaveLength(0);
    g.player.hp = g.player.maxHp - 2;
    g.milks.push({ x: g.player.x, y: g.player.y, t: RULES.heal.lifetime });
    run(g, 1);
    expect(g.player.hp).toBe(g.player.maxHp);
    g.milks.push({ x: 100, y: 100, t: RULES.heal.lifetime });
    run(g, RULES.heal.lifetime * RULES.tickHz + 2);
    expect(g.milks).toHaveLength(0);
  });
});

describe("큐 · 쓰리쿠션", () => {
  // 킥으로 날린 파랑이 빨강을 쳐서, 밀려난 빨강이 빨강 둘에 꽂히는 캐롬.
  function carom(characterId: string) {
    const g = emptyGame({ characterId });
    const blue = put(g, "blue", 400, 400);
    put(g, "red", 440, 400);
    put(g, "red", 560, 400);
    put(g, "red", 588, 400);
    launch(blue, 1, 0, 900, { chainDepth: 0, chainT: 0, weapon: true });
    return pops(run(g, 60));
  }

  it("큐는 캐롬 팝을 쿠션 팝으로 치고, 경험치 +50%를 받는다", () => {
    const p = carom("cue");
    expect(p).toHaveLength(1);
    expect(p[0]?.cushion).toBe(true);
    expect(p[0]?.xp).toBeCloseTo(3 * 1.5);
  });

  it("다른 캐릭터에게 캐롬 팝은 쿠션이 아니다", () => {
    const p = carom("shepherd");
    expect(p).toHaveLength(1);
    expect(p[0]?.cushion).toBe(false);
    expect(p[0]?.xp).toBe(3);
  });
});

describe("스테이지 접촉 피해 배율", () => {
  function hitBy(count: number, mul: number, armor: number): number {
    const g = emptyGame();
    g.stage = { ...stage("stage01"), contactMul: mul, spawn: [{ from: 0, to: 9999, interval: 9999 }] };
    g.spawnTimer = 9999;
    g.player.stats = { ...g.player.stats, armor };
    const { x, y } = g.player;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      put(g, "red", x + Math.cos(a) * 30, y + Math.sin(a) * 30, { moving: true });
    }
    const hit = run(g, 1).find((e) => e.type === "player-hit");
    return hit && hit.type === "player-hit" ? hit.damage : 0;
  }

  it("배율을 곱한 뒤 방어를 빼고, 닿은 적마다 더한다", () => {
    expect(hitBy(1, 1, 0)).toBe(5);
    expect(hitBy(1, 2, 0)).toBe(10);
    expect(hitBy(1, 2, 2)).toBe(8);
    expect(hitBy(3, 2, 2)).toBe(24);
  });

  it("배율이 오를수록 방어의 비중이 줄어든다 (방어 2: 배율 1에서 40%, 배율 2에서 20%)", () => {
    expect(1 - hitBy(1, 1, 2) / hitBy(1, 1, 0)).toBeCloseTo(0.4);
    expect(1 - hitBy(1, 2, 2) / hitBy(1, 2, 0)).toBeCloseTo(0.2);
  });

  it("스테이지별 계획표는 1.0에서 시작해 줄지 않고 오른다", () => {
    const v = BALANCE.stageContactMul.values;
    expect(v).toHaveLength(CAMPAIGN.length);
    expect(v[0]).toBe(1);
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeGreaterThanOrEqual(v[i - 1]!);
    expect(stage("stage01").contactMul).toBe(v[0]);
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

  it("화면 안에 터뜨릴 적이 3마리 이상인데 10초 동안 팝이 없으면 막힘 1회", () => {
    const g = emptyGame();
    for (let i = 0; i < 3; i++) put(g, "red", g.player.x - 300 + i * 100, g.player.y - 200);
    run(g, 10 * RULES.tickHz - 2);
    expect(g.stats.stalls).toBe(0);
    const events = run(g, 3);
    expect(g.stats.stalls).toBe(1);
    expect(events.some((e) => e.type === "stall")).toBe(true);
  });

  it("화면 밖의 적은 막힘 시계를 돌리지 않는다 (걸어오는 중)", () => {
    const g = emptyGame();
    for (let i = 0; i < 5; i++) put(g, "red", 200 + i * 100, 200);
    run(g, 20 * RULES.tickHz);
    expect(g.stats.stalls).toBe(0);
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
