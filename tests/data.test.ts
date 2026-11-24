import { describe, expect, it } from "vitest";
import { MATCH_COLORS } from "../src/core/types.ts";
import { BALANCE, CHARACTERS, ENEMIES, lp, STAGES, targetLp, WEAPONS } from "../src/data/index.ts";

const LEVEL_KEYS = ["1", "2", "3", "4A", "4B", "5A", "5B", "6A", "6B", "7A", "7B", "evo"];

describe("데이터: 무기 (밸런스 시트와 같은 값)", () => {
  it("무기 7종이 있다", () => {
    expect(Object.keys(WEAPONS).sort()).toEqual(["kick", "lasso", "magnet_totem", "paint_gun", "reflect_wall", "shockwave", "whirlwind"]);
  });

  for (const w of Object.values(WEAPONS)) {
    describe(w.name, () => {
      it("Lv1~3, Lv4~7 A/B, 진화의 12줄이 빠짐없이 있다", () => {
        expect(w.levels.map((l) => `${l.lv}${l.branch ?? ""}`)).toEqual(LEVEL_KEYS);
      });

      it.each(w.levels.map((l) => [`Lv${l.lv}${l.branch ?? ""}`, l] as const))("%s의 LP가 목표 ±15% 안", (_, l) => {
        const dev = lp(l) / targetLp(l) - 1;
        expect(Math.abs(dev)).toBeLessThanOrEqual(BALANCE.tolerance + 1e-9);
      });

      it("값이 모두 양수이고 조준 계수는 0.6~1.0", () => {
        for (const l of w.levels) {
          expect(l.cooldown).toBeGreaterThan(0);
          expect(l.targets).toBeGreaterThan(0);
          expect(l.knock + l.support).toBeGreaterThan(0);
          expect(l.aim).toBeGreaterThanOrEqual(0.6);
          expect(l.aim).toBeLessThanOrEqual(1);
          expect(l.damage).toBeGreaterThanOrEqual(0);
        }
      });
    });
  }

  it("구현된 무기는 Lv1~3에 동작 파라미터가 있다", () => {
    const need: Record<string, string[]> = { pulse: ["radius"], directional: ["range"], zone: ["radius", "duration"] };
    for (const w of Object.values(WEAPONS).filter((x) => x.implemented)) {
      for (const l of w.levels.filter((x) => typeof x.lv === "number" && x.lv <= 3)) {
        for (const key of need[w.behavior] ?? []) expect(l.params[key], `${w.id} Lv${l.lv} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("킥 Lv1 LP = 100 (정규화 상수의 기준점)", () => {
    const kick = WEAPONS.kick;
    expect(kick && lp(kick.levels[0]!)).toBe(100);
  });
});

describe("데이터: 캐릭터·적·스테이지", () => {
  it("캐릭터의 시작 무기가 무기 목록에 있다", () => {
    for (const c of Object.values(CHARACTERS)) expect(WEAPONS[c.startWeapon], c.id).toBeDefined();
  });

  it("캐릭터 능력치가 기획서 값과 같다", () => {
    // 11/23 밤: 당구 공으로 바꾼 뒤 큐가 가장 약해 체력 80 → 100, 속도 1.1 → 1.2 (36시드 완주 5 → 14)
    // 11/24 런 조정: 마무리 시간·반사벽 변경 뒤 큐가 47~82에서 2/36으로 처져 100 → 110 (docs/2026-11-24-런조정.md)
    expect(CHARACTERS.cue?.stats).toMatchObject({ max_hp: 110, move_speed: 1.2, knock_power: 1.25, area: 1 });
    expect(CHARACTERS.cue?.trait).toBe("three_cushion");
    expect(CHARACTERS.olly?.stats).toMatchObject({ max_hp: 130, armor: 2, pickup: 1.4 });
    // 11/24: 난이도를 올리자 팔레만 크게 앞섰다 (72시드 23 vs 9~11). 쿨다운 −10%가 색 공 쿨다운에도 들어가서라 0으로 (팔레 23 → 13)
    expect(CHARACTERS.pale?.stats).toMatchObject({ cooldown: 0, chain_radius: 1.2 });
    // 11/24: 양치기 체력 120 → 140 (가장 약해서)
    expect(CHARACTERS.shepherd?.stats).toMatchObject({ max_hp: 140, armor: 1 });
  });

  it("적 수치는 모두 양수이고 젤리 반지름은 14px", () => {
    for (const e of Object.values(ENEMIES)) {
      for (const k of ["radius", "mass", "hp", "speed", "xp"] as const) expect(e[k], `${e.id}.${k}`).toBeGreaterThan(0);
    }
    expect(ENEMIES.jelly?.radius).toBe(14);
  });

  it("스테이지 출현표는 0초부터 끝까지 빈틈없이 이어진다", () => {
    for (const s of Object.values(STAGES)) {
      expect(s.spawn[0]?.from, s.id).toBe(0);
      for (let i = 1; i < s.spawn.length; i++) expect(s.spawn[i]?.from, s.id).toBe(s.spawn[i - 1]?.to);
      expect(s.spawn[s.spawn.length - 1]?.to, s.id).toBe(s.duration);
      for (const c of s.colors) expect(MATCH_COLORS).toContain(c);
    }
  });
});
