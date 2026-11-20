import { describe, expect, it } from "vitest";
import { step } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import { BALANCE, CAMPAIGN, stage } from "../src/data/index.ts";
import { carryOf, runCampaign, startStage, startWeapon } from "../src/sim/campaign.ts";
import { botInput } from "../src/sim/bot.ts";

describe("캠페인 (스테이지 1~10)", () => {
  it("스테이지 10개가 순서대로 있고, 접촉 피해 배율이 계획표와 같다", () => {
    expect(CAMPAIGN).toHaveLength(10);
    CAMPAIGN.forEach((id, i) => {
      const st = stage(id);
      expect(st.contactMul ?? 1).toBe(BALANCE.stageContactMul.values[i]);
      expect(st.clear ?? "survive").toBe(["stage05", "stage10"].includes(id) ? "boss" : id === "stage09" ? "elites" : "survive");
      expect(st.spawn.at(-1)?.to).toBe(st.duration);
    });
  });

  it("뒤 스테이지일수록 마지막 구간이 빠르고 촘촘하다", () => {
    for (let i = 1; i < CAMPAIGN.length; i++) {
      const a = stage(CAMPAIGN[i - 1] as string).spawn.at(-1)!;
      const b = stage(CAMPAIGN[i] as string).spawn.at(-1)!;
      expect(b.interval).toBeLessThanOrEqual(a.interval);
      expect(b.speedMul ?? 1).toBeGreaterThanOrEqual(a.speedMul ?? 1);
    }
  });

  it("캐릭터마다 자기 시작 무기로 시작한다", () => {
    expect(startWeapon("shepherd")).toBe("kick");
    expect(startWeapon("olly")).toBe("lasso");
    expect(startWeapon("pale")).toBe("paint_gun");
  });

  it("다음 스테이지는 레벨·경험치·패시브·무기·체력을 이어 받는다", () => {
    const g = startStage(1, "shepherd", "stage01", null);
    for (let t = 0; t < 150 * RULES.tickHz; t++) step(g, botInput(g));
    expect(g.player.level).toBeGreaterThan(1);
    const c = carryOf(g);
    c.hp = 10;
    const h = startStage(2, "shepherd", "stage02", c);
    expect(h.player.level).toBe(c.level);
    expect(h.stats.xp).toBe(c.xp);
    expect(h.player.passives).toEqual(c.passives);
    expect(h.weapons.map((w) => [w.def.id, w.level.lv])).toEqual(c.weapons.map((w) => [w.id, w.lv]));
    expect(h.player.hp).toBe(10);
    expect(h.player.maxHp).toBe(g.player.maxHp);
    expect(h.leveling).toBe(true);
  });

  it("짧은 2스테이지 런: 클리어하면 다음으로 넘어가고, 레벨은 줄지 않는다", { timeout: 120_000 }, () => {
    const r = runCampaign(3, "shepherd", ["stage01", "stage02"]);
    expect(r.stages[0]?.cleared).toBe(true);
    expect(r.stages).toHaveLength(2);
    expect(r.stages[1]!.levelStart).toBe(r.stages[0]!.levelEnd);
    expect(r.stages[1]!.levelEnd).toBeGreaterThanOrEqual(r.stages[1]!.levelStart);
  });
});
