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
    const [c1, c2] = META.nodes.find((n) => n.id === "sturdy")!.costs as [number, number];
    let s = { ...newSave(), coins: c1 + c2 - 1 };
    s = spendOnMeta(s, "sturdy");
    expect([s.coins, s.meta.sturdy]).toEqual([c2 - 1, 1]);
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

  it("11/24 이전 트리(가지 3개)의 세이브도 읽힌다: 남은 노드는 지키고, 넘친 레벨은 깎는다", () => {
    // 예전 트리를 다 채운 세이브 (sturdy 5, focus 3 등)
    const old = { sturdy: 5, fleece: 2, second_chance: 1, strength: 5, focus: 3, first_move: 1, thrift: 5, haggle: 3, regular: 1 };
    const r = parseSave(JSON.stringify({ version: 1, coins: 12, meta: old, runs: 18, wins: 9, bestStage: 15, characters: {} }));
    if (!r.ok) throw new Error(r.error);
    for (const [id, lv] of Object.entries(old)) {
      const n = META.nodes.find((x) => x.id === id);
      if (!n) expect(r.dropped).toContain(id);
      else expect(r.save.meta[id] ?? 0).toBe(Math.min(lv, n.maxLevel));
    }
    expect(r.save.coins).toBe(12);
    // 고친 프로필은 규칙을 지키고 그대로 쓸 수 있다
    expect(() => botSpend({ ...r.save, coins: 500 })).not.toThrow();
  });
});
