import { describe, expect, it } from "vitest";
import { META } from "../src/data/index.ts";
import { totalTreeCost } from "../src/progression/meta.ts";
import {
  botSpend,
  loadSave,
  memoryStore,
  newSave,
  parseSave,
  recordRun,
  serializeSave,
  spendOnMeta,
  treeProgress,
  writeSave,
} from "../src/progression/save.ts";

describe("5.5 세이브", () => {
  it("런 기록: 코인이 쌓이고, 캐릭터별 최고 기록이 남는다", () => {
    let s = newSave();
    s = recordRun(s, { character: "olly", reached: 4, won: false, coins: 40 });
    s = recordRun(s, { character: "olly", reached: 10, won: true, coins: 120 });
    s = recordRun(s, { character: "cue", reached: 2, won: false, coins: 15 });
    expect(s.coins).toBe(175);
    expect([s.runs, s.wins, s.bestStage]).toEqual([3, 1, 10]);
    expect(s.characters.olly).toEqual({ runs: 2, wins: 1, bestStage: 10 });
    expect(s.characters.cue?.bestStage).toBe(2);
  });

  it("영구 강화 구매: 코인이 줄고, 모자라거나 잠긴 노드는 살 수 없다", () => {
    let s = { ...newSave(), coins: 25 };
    s = spendOnMeta(s, "sturdy");
    expect([s.coins, s.meta.sturdy]).toEqual([5, 1]);
    expect(() => spendOnMeta(s, "sturdy")).toThrow(/모자람/);
    expect(() => spendOnMeta({ ...s, coins: 999 }, "fleece")).toThrow(/잠김/);
  });

  it("코인이 충분하면 봇 구매로 트리가 다 찬다", () => {
    const s = botSpend({ ...newSave(), coins: totalTreeCost() });
    expect(treeProgress(s)).toBe(1);
    expect(s.coins).toBe(0);
  });

  it("저장했다 읽으면 그대로다", () => {
    const store = memoryStore();
    let s = recordRun(newSave(), { character: "pale", reached: 6, won: false, coins: 300 });
    s = botSpend(s);
    writeSave(store, s);
    expect(loadSave(store)).toEqual(s);
  });

  it("없으면 새 세이브, 깨져 있으면 새로 시작하고 원본을 넘겨준다", () => {
    expect(loadSave(memoryStore())).toEqual(newSave());
    let kept = "";
    const s = loadSave(memoryStore("{not json"), (text) => (kept = text));
    expect(s).toEqual(newSave());
    expect(kept).toBe("{not json");
    expect(parseSave(JSON.stringify({ version: 99 })).ok).toBe(false);
  });

  it("데이터가 바뀌어도 읽힌다: 없어진 노드는 버리고, 넘친 레벨은 깎고, 선행 조건이 깨진 노드는 버린다", () => {
    const sturdyMax = META.nodes.find((n) => n.id === "sturdy")!.maxLevel;
    const text = JSON.stringify({ version: 1, coins: -5, meta: { sturdy: 99, gone_node: 2, haggle: 1 }, runs: 3.7 });
    const r = parseSave(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.save.meta).toEqual({ sturdy: sturdyMax });
    expect(r.dropped.sort()).toEqual(["gone_node", "haggle"]);
    expect([r.save.coins, r.save.runs]).toEqual([0, 3]);
    expect(serializeSave(r.save)).toContain('"version":1');
  });
});
