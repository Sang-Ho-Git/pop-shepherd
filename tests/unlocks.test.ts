import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../src/data/index.ts";
import { newSave, parseSave, recordRun, serializeSave } from "../src/progression/save.ts";
import { conditionProgress, newlyUnlocked, UNLOCK_STATS, UNLOCKS } from "../src/progression/unlocks.ts";

const run = (character: string, reached: number, extra: Record<string, number> = {}) => ({ character, reached, won: reached >= 15, coins: 0, ...extra });

describe("캐릭터 해금", () => {
  it("데이터: 모든 캐릭터가 처음부터 열려 있거나 해금 규칙이 있고, 조건 이름과 수치가 올바르다", () => {
    expect(UNLOCKS.start).toEqual(["olly"]);
    for (const id of Object.keys(CHARACTERS)) expect(UNLOCKS.start.includes(id) || UNLOCKS.characters[id] !== undefined).toBe(true);
    for (const [id, rule] of Object.entries(UNLOCKS.characters)) {
      expect(CHARACTERS[id], id).toBeDefined();
      expect(UNLOCKS.start).not.toContain(id);
      expect(rule.any.length).toBeGreaterThan(0);
      expect(rule.text.length).toBeGreaterThan(0);
      for (const c of rule.any) {
        expect(UNLOCK_STATS).toContain(c.stat);
        expect(["best", "total"]).toContain(c.kind);
        expect(c.n).toBeGreaterThan(0);
      }
    }
  });

  it("새 세이브에는 올리만 열려 있다", () => {
    expect(newSave().unlocked).toEqual(["olly"]);
  });

  it("스테이지 5를 클리어하면 양치기가, 10을 클리어하면 팔레가 열린다 (어느 캐릭터로든)", () => {
    let s = recordRun(newSave(), run("olly", 4));
    expect(s.unlocked).toEqual(["olly"]);
    const before = s;
    s = recordRun(s, run("olly", 5));
    expect(newlyUnlocked(before, s)).toEqual(["shepherd"]);
    s = recordRun(s, run("shepherd", 10));
    expect(s.unlocked).toContain("pale");
  });

  it("누적 기록: 쿠션 팝은 여러 판에 걸쳐 쌓여 큐를 연다", () => {
    const need = UNLOCKS.characters.cue!.any.find((c) => c.stat === "cushionPops")!.n;
    let s = recordRun(newSave(), run("olly", 2, { cushionPops: need - 1 }));
    expect(s.unlocked).not.toContain("cue");
    expect(conditionProgress(s, { kind: "total", stat: "cushionPops", n: need })).toBeCloseTo((need - 1) / need);
    s = recordRun(s, run("olly", 1, { cushionPops: 1 }));
    expect(s.totals.cushionPops).toBe(need);
    expect(s.unlocked).toContain("cue");
  });

  it("3쿠션 팝으로도 큐가 열린다, 최고 기록은 한 판 기준", () => {
    const need = UNLOCKS.characters.cue!.any.find((c) => c.stat === "threeCushions")!.n;
    let s = recordRun(newSave(), run("olly", 1, { threeCushions: need, maxChain: 7 }));
    s = recordRun(s, run("olly", 1, { maxChain: 3 }));
    expect(s.unlocked).toContain("cue");
    expect(s.bests.maxChain).toBe(7);
    expect(s.bests.threeCushions).toBe(need);
  });

  it("한 번 열린 캐릭터는 기록이 모자라도 다시 잠기지 않는다", () => {
    const s = parseSave(JSON.stringify({ ...newSave(), unlocked: ["olly", "pale"] }));
    if (!s.ok) throw new Error(s.error);
    expect(s.save.unlocked).toEqual(["olly", "pale"]);
  });

  it("예전 세이브(해금 필드 없음): 기록이 조건을 채운 캐릭터와 해본 캐릭터는 열어 준다", () => {
    const old = {
      version: 1,
      coins: 50,
      meta: {},
      runs: 3,
      wins: 0,
      bestStage: 6,
      characters: { olly: { runs: 2, wins: 0, bestStage: 6 }, cue: { runs: 1, wins: 0, bestStage: 2 } },
    };
    const r = parseSave(JSON.stringify(old));
    if (!r.ok) throw new Error(r.error);
    // 양치기: 스테이지 5 클리어 기록, 큐: 해본 적 있음, 팔레: 스테이지 10 기록이 없어 잠김
    expect(r.save.unlocked).toEqual(["olly", "shepherd", "cue"]);
    expect(r.save.totals.cushionPops).toBe(0);
    // 다시 저장하면 새 필드가 붙는다
    expect(JSON.parse(serializeSave(r.save)).unlocked).toEqual(["olly", "shepherd", "cue"]);
  });

  it("세이브 고치기: 없는 캐릭터와 이상한 값은 버리고, 처음 캐릭터는 늘 열려 있다", () => {
    const r = parseSave(JSON.stringify({ ...newSave(), unlocked: ["gone", 3, "cue"], totals: { cushionPops: -4, reached: "x" }, bests: null }));
    if (!r.ok) throw new Error(r.error);
    expect(r.save.unlocked).toEqual(["olly", "cue"]);
    expect(r.save.totals).toEqual({ poppedEnemies: 0, cushionPops: 0, threeCushions: 0, maxChain: 0, reached: 0 });
    expect(r.save.bests.maxChain).toBe(0);
  });

  it("런 기록이 없는 RunResult(예전 호출)도 받는다", () => {
    const s = recordRun(newSave(), { character: "olly", reached: 3, won: false, coins: 10 });
    expect(s.totals).toEqual({ poppedEnemies: 0, cushionPops: 0, threeCushions: 0, maxChain: 0, reached: 3 });
  });
});
