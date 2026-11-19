import { describe, expect, it } from "vitest";
import { runOne, SCENARIOS } from "../tools/audit.ts";

/**
 * 야간 점검(tools/audit.ts)에서 찾은 버그가 다시 생기지 않는지, 대표 조합을 짧게 돌려 확인한다.
 * 아레나 이탈, 비정상 값, 상한 초과, 끝나지 않는 비행, 깊은 겹침.
 */
const PICK = ["스테이지1 · 킥 Lv1 (시작 상태)", "검증장 · 킥 Lv1 만", "검증장 · 세 무기 Lv3", "검증장 · 큐 · 세 무기 Lv3"];

describe("불변식 (점검 도구로 찾은 버그의 회귀 방지)", () => {
  for (const sc of SCENARIOS.filter((s) => PICK.includes(s.name))) {
    it(`${sc.name}: 2판 동안 불변식이 깨지지 않는다`, () => {
      for (const seed of [1, 2]) {
        const r = runOne(sc, seed);
        const a = r.anomalies;
        expect(a.nonFinite, `시드 ${seed} 비정상 값`).toBe(0);
        expect(a.outOfArena, `시드 ${seed} 아레나 이탈`).toBe(0);
        expect(a.overCap, `시드 ${seed} 상한 초과`).toBe(0);
        expect(a.longFlight, `시드 ${seed} 5초 넘는 비행`).toBe(0);
        expect(a.deepOverlap, `시드 ${seed} 깊은 겹침`).toBeLessThanOrEqual(2);
      }
    }, 60_000);
  }
});
