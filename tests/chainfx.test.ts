import { describe, expect, it } from "vitest";
import { launch } from "../src/world/physics.ts";
import { emptyGame, put, run } from "./helpers.ts";

/** 11/26 연쇄 가시화: 화면 표시용 이벤트 (시뮬 상태는 바꾸지 않는다) */
describe("연쇄 표시 이벤트", () => {
  it("같은 색 하나에만 부딪치면 chain-miss 2/3 (일반 발사는 chain false)", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    launch(a, 1, 0, 600);
    const miss = run(g, 10).filter((e) => e.type === "chain-miss");
    expect(miss).toHaveLength(1);
    expect(miss[0]).toMatchObject({ size: 2, need: 3, color: "red", chain: false });
  });

  it("팝 충격파로 날아간(연쇄 인정 시간이 남은) 적이 같은 색 하나에 맞으면 chain true", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    launch(a, 1, 0, 600, { chainDepth: 1, chainT: 1 });
    const miss = run(g, 10).filter((e) => e.type === "chain-miss");
    expect(miss[0]).toMatchObject({ size: 2, chain: true });
  });

  it("터지는 충돌에는 chain-miss가 없다", () => {
    const g = emptyGame();
    const a = put(g, "red", 440, 400);
    put(g, "red", 500, 400);
    put(g, "red", 528, 400);
    launch(a, 1, 0, 600);
    expect(run(g, 10).some((e) => e.type === "chain-miss")).toBe(false);
  });

  it("연쇄 가능 적이 다른 색에 맞으면 chain-bounce, 일반 발사는 없다", () => {
    const withChain = emptyGame();
    const a = put(withChain, "red", 440, 400);
    put(withChain, "blue", 500, 400);
    launch(a, 1, 0, 600, { chainDepth: 1, chainT: 1 });
    expect(run(withChain, 10).filter((e) => e.type === "chain-bounce")).toHaveLength(1);

    const plain = emptyGame();
    const b = put(plain, "red", 440, 400);
    put(plain, "blue", 500, 400);
    launch(b, 1, 0, 600);
    expect(run(plain, 10).some((e) => e.type === "chain-bounce")).toBe(false);
  });
});
