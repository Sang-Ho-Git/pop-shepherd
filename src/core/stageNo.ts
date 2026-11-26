import { RULES } from "./rules.ts";
import type { Game } from "./types.ts";

/** 지금 스테이지 번호 (stage08 → 8, 모르면 0) */
export function stageNo(g: Game): number {
  return Number(/(\d+)$/.exec(g.stage?.id ?? "")?.[1] ?? 0);
}

/** 후반(RULES.heal.lateFrom 스테이지부터) 우유병 드롭 확률 배율. 빌드가 꽉 찬 뒤 회복이 넘쳐 죽을 상황이 안 나오던 문제 (11/26 사용자 피드백) */
export function milkDropMul(g: Game): number {
  return stageNo(g) >= RULES.heal.lateFrom ? RULES.heal.lateDropMul : 1;
}

/** 후반 우유병 회복량 배율 */
export function milkHealMul(g: Game): number {
  return stageNo(g) >= RULES.heal.lateFrom ? RULES.heal.lateHealMul : 1;
}
