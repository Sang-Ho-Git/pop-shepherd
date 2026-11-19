import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng.ts";

describe("5.3 시드 난수", () => {
  it("같은 시드는 같은 수열을 낸다", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it("다른 시드는 다른 수열을 낸다", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const same = Array.from({ length: 50 }, () => a.nextU32() === b.nextU32()).filter(Boolean).length;
    expect(same).toBeLessThan(3);
  });

  it("int는 양 끝을 포함하고 범위를 벗어나지 않는다", () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = r.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([3, 4, 5]);
  });

  it("next는 [0, 1) 안에 있다", () => {
    const r = new Rng(9);
    for (let i = 0; i < 5000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("weighted는 가중치 0인 항목을 고르지 않고 비율을 따른다", () => {
    const r = new Rng(3);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 6000; i++) counts[r.weighted(["a", "b", "c"] as const, [1, 0, 3])]++;
    expect(counts.b).toBe(0);
    expect(counts.c / counts.a).toBeGreaterThan(2.6);
    expect(counts.c / counts.a).toBeLessThan(3.4);
  });
});
