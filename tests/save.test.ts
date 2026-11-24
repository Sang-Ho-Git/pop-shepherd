import { describe, expect, it } from "vitest";
import { META } from "../src/data/index.ts";
import { applyMeta, costFor, nodesFor, profileForCoins, totalTreeCost } from "../src/progression/meta.ts";
import { character } from "../src/data/index.ts";
import {
  acknowledgeRefund,
  allTreesProgress,
  botSpend,
  legacyRefund,
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
    s = spendOnMeta(s, "olly", "sturdy");
    expect([s.coins, s.meta.olly?.sturdy]).toEqual([c2 - 1, 1]);
    expect(() => spendOnMeta(s, "olly", "sturdy")).toThrow(/모자람/);
    expect(() => spendOnMeta({ ...s, coins: 999 }, "olly", "fleece")).toThrow(/잠김/);
  });

  it("트리는 캐릭터마다 따로: 산 노드는 그 캐릭터에만 붙고, 코인 지갑은 공용이다", () => {
    let s = { ...newSave(), coins: 1000 };
    s = spendOnMeta(s, "cue", "sturdy");
    s = spendOnMeta(s, "cue", "cue_rail");
    expect(s.meta.cue).toEqual({ sturdy: 1, cue_rail: 1 });
    expect(s.meta.shepherd).toBeUndefined();
    // 다른 캐릭터의 전용 노드는 살 수 없다
    expect(() => spendOnMeta(s, "shepherd", "cue_rail")).toThrow(/전용/);
    // 런 시작 때는 그 캐릭터 트리만 적용된다
    const hpCue = applyMeta(character("cue"), s.meta.cue!).character.stats.max_hp;
    expect(hpCue).toBeGreaterThan(character("cue").stats.max_hp);
    expect(() => applyMeta(character("shepherd"), s.meta.cue!)).toThrow(/전용/);
    // 전용 노드는 캐릭터마다 1~3개, 다른 캐릭터 트리에는 없다
    for (const id of ["shepherd", "cue", "olly", "pale"]) {
      const own = nodesFor(id).filter((n) => n.chars);
      expect(own.length).toBeGreaterThanOrEqual(1);
      expect(own.length).toBeLessThanOrEqual(3);
      expect(own.every((n) => n.chars!.includes(id))).toBe(true);
    }
  });

  it("다른 캐릭터가 이미 산 공통 노드 레벨은 싸다 (전용 노드는 할인 없음)", () => {
    const full = META.nodes.find((n) => n.id === "sturdy")!.costs[0]!;
    let s = { ...newSave(), coins: 5000 };
    expect(costFor(s.meta, "pale", "sturdy")).toEqual({ cost: full, shared: false });
    s = spendOnMeta(s, "shepherd", "sturdy");
    const c = costFor(s.meta, "pale", "sturdy")!;
    expect(c.shared).toBe(true);
    expect(c.cost).toBe(Math.round(full * (1 - META.shareDiscount!)));
    const before = s.coins;
    s = spendOnMeta(s, "pale", "sturdy");
    expect(before - s.coins).toBe(c.cost);
    // 둘째 레벨은 아직 아무도 안 샀다 → 정가
    expect(costFor(s.meta, "pale", "sturdy")!.shared).toBe(false);
  });

  it("코인이 충분하면 봇 구매로 그 캐릭터 트리가 다 찬다 (다른 캐릭터는 그대로)", () => {
    const s = botSpend({ ...newSave(), coins: totalTreeCost("olly") }, "olly");
    expect(treeProgress(s, "olly")).toBe(1);
    expect(treeProgress(s, "shepherd")).toBe(0);
    expect(s.coins).toBe(0);
    expect(allTreesProgress(s)).toBeCloseTo(1 / 4);
    expect(s.meta.olly).toEqual(profileForCoins(totalTreeCost("olly"), "olly"));
  });

  it("저장했다 읽으면 그대로다", () => {
    const store = memoryStore();
    let s = recordRun(newSave(), { character: "pale", reached: 6, won: false, coins: 300 });
    s = botSpend(s, "pale");
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

  it("데이터가 바뀌어도 읽힌다: 없어진 노드·남의 전용 노드는 버리고, 넘친 레벨은 깎고, 선행 조건이 깨진 노드는 버린다", () => {
    const sturdyMax = META.nodes.find((n) => n.id === "sturdy")!.maxLevel;
    const text = JSON.stringify({ version: 2, coins: -5, meta: { olly: { sturdy: 99, gone_node: 2, haggle: 1, cue_rail: 1 }, ghost: { sturdy: 1 } }, runs: 3.7 });
    const r = parseSave(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.save.meta).toEqual({ olly: { sturdy: sturdyMax } });
    expect(r.dropped.sort()).toEqual(["ghost:sturdy", "olly:cue_rail", "olly:gone_node", "olly:haggle"]);
    expect([r.save.coins, r.save.runs, r.save.metaRefund]).toEqual([0, 3, 0]);
    expect(serializeSave(r.save)).toContain('"version":2');
  });

  it("버전 1 (공용 트리) 세이브: 쓴 코인을 전부 지갑으로 돌려주고, 트리는 비우고, 안내를 한 번 남긴다", () => {
    // 11/24 공용 트리 (8845 코인)에서 산 노드들: 튼튼한 몸 2 (80+110), 두꺼운 털 1 (160), 알뜰 1 (65), 첫 수 1 (540)
    const old = { version: 1, coins: 37, meta: { sturdy: 2, fleece: 1, thrift: 1, first_move: 1, gone_node: 3 }, runs: 12, wins: 3, bestStage: 15, characters: { shepherd: { runs: 12, wins: 3, bestStage: 15 } } };
    const refund = 80 + 110 + 160 + 65 + 540;
    expect(legacyRefund(old.meta)).toBe(refund);
    const r = parseSave(JSON.stringify(old));
    if (!r.ok) throw new Error(r.error);
    expect(r.save.meta).toEqual({});
    expect(r.save.coins).toBe(37 + refund);
    expect(r.save.metaRefund).toBe(refund);
    expect([r.save.runs, r.save.wins, r.save.characters.shepherd?.wins]).toEqual([12, 3, 3]);
    // 안내를 보여 주면 지워지고, 다시 읽어도 또 돌려주지 않는다 (버전 2로 저장됨)
    const seen = acknowledgeRefund(r.save);
    expect(seen.metaRefund).toBe(0);
    const again = parseSave(serializeSave(seen));
    if (!again.ok) throw new Error(again.error);
    expect(again.save.coins).toBe(37 + refund);
    expect(again.save.metaRefund).toBe(0);
    // 안내 전에 저장했다 읽어도 안내는 남는다
    const pending = parseSave(serializeSave(r.save));
    expect(pending.ok && pending.save.metaRefund).toBe(refund);
    // 돌려받은 코인으로 바로 캐릭터 트리를 살 수 있다
    expect(() => botSpend(r.save, "shepherd")).not.toThrow();
  });

  it("11/24 이전 트리(가지 3개)의 버전 1 세이브: 넘친 레벨은 그 무렵 트리 길이까지만 돌려준다", () => {
    const old = { sturdy: 5, fleece: 2, second_chance: 1, strength: 5, focus: 3, first_move: 1, thrift: 5, haggle: 3, regular: 1 };
    const r = parseSave(JSON.stringify({ version: 1, coins: 12, meta: old, runs: 18, wins: 9, bestStage: 15, characters: {} }));
    if (!r.ok) throw new Error(r.error);
    const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
    const expected = sum([80, 110, 145, 190]) + sum([160, 225]) + 405 + sum([80, 110, 145, 190]) + sum([135, 180, 235]) + 540 + sum([65, 90, 125, 170]) + sum([135, 190]) + 450;
    expect(r.save.coins).toBe(12 + expected);
    expect(r.save.meta).toEqual({});
  });
});
