import { describe, expect, it } from "vitest";
import { createGame } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import { character, ENEMIES, weapon } from "../src/data/index.ts";
import { applyCard, candidates, canEvolve, drawCards } from "../src/progression/levelup.ts";
import { addPassive } from "../src/progression/passives.ts";
import { popShockMul } from "../src/combat/pops.ts";
import { launch, WEAPON_LAUNCH } from "../src/world/physics.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";
import { emptyGame, pops, put, run } from "./helpers.ts";

const w = (id: string, lv: number | "evo", branch: string | null = null) => makeWeapon(weapon(id), lv, branch);

describe("킥 갈래", () => {
  it("4B 강타: 찬 적에 부딪힌 다른 색 적은 날아가지 않고 기절한다", () => {
    const g = emptyGame({ weapons: [w("kick", 4, "B")] });
    const { x, y } = g.player;
    put(g, "red", x + 40, y);
    const blue = put(g, "blue", x + 140, y);
    run(g, 20);
    expect(blue.state).toBe("stunned");
    expect(Math.hypot(blue.x - (x + 140), blue.y - y)).toBeLessThan(10);
  });

  it("7A 완성: 한 번에 찬 같은 색 두 마리는 즉시 팝", () => {
    const g = emptyGame({ weapons: [w("kick", 7, "A")] });
    const { x, y } = g.player;
    put(g, "green", x + 40, y);
    put(g, "green", x + 44, y + 30);
    const p = pops(run(g, 1));
    expect(p[0]).toMatchObject({ size: 2, color: "green" });
  });

  it("7B 완성: 찬 적이 착지할 때 작은 충격파가 근처 적을 민다", () => {
    const g = emptyGame({ weapons: [w("kick", 7, "B")] });
    const { x, y } = g.player;
    const a = put(g, "red", x + 40, y);
    let sawShock = false;
    for (let t = 0; t < 120 && !sawShock; t++) {
      run(g, 1);
      sawShock = g.effects.some((f) => f.kind === "shock") || (a.state === "walk" && t > 2);
    }
    expect(sawShock).toBe(true);
  });
});

describe("충격파 갈래", () => {
  it("4A 집중파: 이동 방향 부채꼴 밖의 적은 맞지 않는다", () => {
    const g = emptyGame({ weapons: [w("shockwave", 4, "A")] });
    const { x, y } = g.player;
    const front = put(g, "red", x + 100, y);
    const back = put(g, "blue", x - 100, y);
    run(g, 1);
    expect(front.state).toBe("launched");
    expect(back.state).toBe("walk");
  });

  it("4B 이중파: 0.4초 뒤 두 번째 파동이 나간다 (타격 수에 더함)", () => {
    const sw = w("shockwave", 4, "B");
    const g = emptyGame({ weapons: [sw] });
    put(g, "red", g.player.x + 100, g.player.y);
    run(g, 1);
    expect(sw.hits).toBe(1);
    expect(g.effects).toHaveLength(1);
    run(g, Math.ceil(0.4 * RULES.tickHz) + 1);
    expect(g.effects).toHaveLength(0);
  });

  it("7A 완성: 맞은 적이 더 멀리 난다", () => {
    const dist = (lv: 6 | 7) => {
      const g = emptyGame({ weapons: [w("shockwave", lv, "A")] });
      const e = put(g, "red", g.player.x + 100, g.player.y);
      run(g, 120);
      return e.x - (g.player.x + 100);
    };
    expect(dist(7)).toBeGreaterThan(dist(6) * 1.3);
  });

  it("진화 도미노: 팝 충격파 반경 2배", () => {
    const g = emptyGame({ weapons: [w("shockwave", "evo")] });
    expect(popShockMul(g)).toBe(2);
    expect(popShockMul(emptyGame({ weapons: [w("shockwave", 7, "B")] }))).toBe(1);
  });
});

describe("자석 토템 갈래", () => {
  it("4A 쌍둥이: 색이 다른 토템 두 개를 각 무리 한가운데에 세운다", () => {
    const g = emptyGame({ weapons: [w("magnet_totem", 4, "A")] });
    const { x, y } = g.player;
    put(g, "red", x + 100, y);
    put(g, "red", x + 120, y + 40);
    put(g, "blue", x - 100, y);
    put(g, "blue", x - 120, y - 40);
    run(g, 1);
    expect(g.totems.map((t) => t.color).sort()).toEqual(["blue", "red"]);
    expect(g.totems.find((t) => t.color === "red")!.x).toBeGreaterThan(x);
  });

  it("4B 압축: 끌려와 닿은 같은 색 3마리는 발사 없이 팝, 충격파는 없다", () => {
    const g = emptyGame({ weapons: [w("magnet_totem", 4, "B")] });
    const { x, y } = g.player;
    put(g, "yellow", x + 120, y);
    put(g, "yellow", x - 120, y);
    put(g, "yellow", x, y + 120);
    const bystander = put(g, "red", x + 200, y + 200);
    const p = pops(run(g, 4 * RULES.tickHz));
    expect(p[0]).toMatchObject({ size: 3, color: "yellow" });
    expect(bystander.state).toBe("walk");
  });

  it("진화 프리즘 코어: 범위 안의 다른 색도 가장 많은 색으로 칠해 끌어온다", () => {
    const g = emptyGame({ weapons: [w("magnet_totem", "evo")] });
    const { x, y } = g.player;
    put(g, "red", x + 100, y);
    put(g, "red", x + 120, y + 40);
    const blue = put(g, "blue", x - 100, y);
    run(g, 1);
    expect(blue.color).toBe("red");
  });
});

describe("올가미 갈래", () => {
  it("4B 투척: 짝을 향해 세게 던진다 (끌기보다 빠르다)", () => {
    const speed = (lv: 3 | 4) => {
      const g = emptyGame({ weapons: [w("lasso", lv, lv === 4 ? "B" : null)] });
      const { x, y } = g.player;
      put(g, "red", x + 60, y);
      const lone = put(g, "red", x - 100, y);
      run(g, 1);
      return Math.hypot(lone.vx, lone.vy);
    };
    expect(speed(4)).toBeGreaterThan(speed(3));
  });

  it("7A 완성: 끌어온 적과 짝을 그 자리에서 바로 터뜨린다", () => {
    const g = emptyGame({ weapons: [w("lasso", 7, "A")] });
    const { x, y } = g.player;
    put(g, "blue", x + 100, y);
    put(g, "blue", x + 128, y);
    put(g, "blue", x - 150, y);
    const p = pops(run(g, 1));
    expect(p[0]).toMatchObject({ size: 3, color: "blue" });
  });

  it("7B 완성: 던진 적이 다른 색을 뚫고 지나간다", () => {
    const g = emptyGame({ weapons: [] });
    const a = put(g, "red", 400, 400);
    const b = put(g, "blue", 440, 400);
    launch(a, 1, 0, 900, { ...WEAPON_LAUNCH, fx: { pierce: 2 } });
    const v0 = a.vx;
    run(g, 6);
    expect(b.state).not.toBe("walk");
    expect(a.vx).toBeGreaterThan(v0 * 0.7);
  });
});

describe("페인트 총 갈래", () => {
  it("7A 웅덩이: 맞은 자리 주변도 같은 색으로 칠한다", () => {
    const g = emptyGame({ weapons: [w("paint_gun", 7, "A")] });
    const { x, y } = g.player;
    put(g, "green", x + 200, y);
    put(g, "green", x + 228, y);
    put(g, "yellow", x + 172, y + 4);
    const near = put(g, "red", x + 160, y + 40);
    run(g, 1);
    expect(near.color).toBe("green");
  });

  it("4B 저격: 같은 선 위 뒤쪽 적까지 뚫고, 7B는 첫 적의 색으로 통일한다", () => {
    const g = emptyGame({ weapons: [w("paint_gun", 7, "B")] });
    const { x, y } = g.player;
    put(g, "green", x + 100, y - 30);
    put(g, "green", x + 128, y - 30);
    const first = put(g, "yellow", x + 100, y);
    const behind = put(g, "red", x + 200, y);
    run(g, 1);
    expect(first.color).toBe("green");
    expect(behind.color).toBe("green");
  });
});

describe("갈래·진화 카드", () => {
  function game() {
    return createGame({ seed: 1, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, weapons: [w("shockwave", 3)], leveling: true });
  }

  it("Lv3 무기의 강화 카드는 한 장이고, 고르면 갈래 선택 창(chooseBranch)에서 고른 갈래로 Lv4가 된다", () => {
    const g = game();
    expect(candidates(g).weaponUp).toEqual([{ kind: "weaponUp", id: "shockwave" }]);
    g.chooseBranch = () => "B";
    applyCard(g, { kind: "weaponUp", id: "shockwave" });
    expect([g.weapons[0]!.level.lv, g.weapons[0]!.level.branch]).toEqual([4, "B"]);
    applyCard(g, { kind: "weaponUp", id: "shockwave" });
    expect([g.weapons[0]!.level.lv, g.weapons[0]!.level.branch]).toEqual([5, "B"]);
  });

  it("Lv7에서 짝 패시브가 있어야 진화 카드가 나온다", () => {
    const g = game();
    g.weapons = [w("shockwave", 7, "A")];
    expect(canEvolve(g, "shockwave")).toBe(false);
    expect(candidates(g).weaponUp).toEqual([]);
    addPassive(g, "chain_amp");
    expect(candidates(g).weaponUp).toEqual([{ kind: "evolve", id: "shockwave" }]);
    applyCard(g, { kind: "evolve", id: "shockwave" });
    expect(g.weapons[0]!.level.lv).toBe("evo");
    // 진화해도 갈래 A(집중파)의 완성 효과가 남는다
    expect(g.weapons[0]!.level.branch).toBe("A");
    expect(g.weapons[0]!.level.params).toMatchObject({ coneDeg: 45, flightMul: 1.5, domino: 1, radius: 180 });
  });

  it("Lv5 이상 무기의 짝 패시브가 없으면 그 패시브가 카드에 더 자주 나온다", () => {
    const count = (lv: 4 | 5) => {
      let n = 0;
      for (let s = 1; s <= 300; s++) {
        const g = createGame({ seed: s, character: character("shepherd"), enemyDefs: ENEMIES, stage: null, weapons: [w("shockwave", lv, "A")], leveling: true });
        if (drawCards(g).some((c) => c.kind === "newPassive" && c.id === "chain_amp")) n++;
      }
      return n;
    };
    expect(count(5)).toBeGreaterThan(count(4) * 1.3);
  });

  it("짝 패시브의 동작이 없는 무기(킥·페인트 총)는 아직 진화하지 않는다", () => {
    const g = game();
    g.weapons = [w("kick", 7, "A"), w("paint_gun", 7, "A")];
    expect(canEvolve(g, "kick")).toBe(false);
    expect(canEvolve(g, "paint_gun")).toBe(false);
  });
});
