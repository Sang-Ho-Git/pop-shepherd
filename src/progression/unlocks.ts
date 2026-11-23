import unlocksJson from "../../data/unlocks.json" with { type: "json" };
import { CHARACTERS } from "../data/index.ts";
import type { SaveData } from "./save.ts";

/**
 * 캐릭터 해금 (런 밖). 처음에는 data/unlocks.json의 start만 열려 있고,
 * 나머지는 런 기록(세이브에 쌓인 최고 기록·누적 기록)이 조건 중 하나를 채우면 열린다.
 * 한 번 열린 캐릭터는 다시 잠기지 않는다.
 */

/** 런 하나에서 나오는 기록 중 해금에 쓰는 것 (런마다 누적과 최고를 세이브에 남긴다) */
export interface RunStats {
  poppedEnemies: number;
  /** 쿠션을 거쳐 터뜨린 팝 수 (색 공 규칙에서만 센다) */
  cushionPops: number;
  /** 그중 3쿠션 이상 */
  threeCushions: number;
  /** 가장 긴 연쇄 */
  maxChain: number;
}
/** 누적 기록: 런 기록 + 클리어한 스테이지 수 합 */
export type RunTotals = RunStats & { reached: number };
export const RUN_STAT_KEYS = ["poppedEnemies", "cushionPops", "threeCushions", "maxChain"] as const satisfies readonly (keyof RunStats)[];

/** 조건에 쓸 수 있는 기록: 런 기록 + 클리어 스테이지(reached), 런 수(runs) */
export type UnlockStat = keyof RunStats | "reached" | "runs";
export const UNLOCK_STATS: readonly UnlockStat[] = [...RUN_STAT_KEYS, "reached", "runs"];

export interface UnlockCondition {
  /** best: 한 판 최고 기록, total: 모든 판 누적 */
  kind: "best" | "total";
  stat: UnlockStat;
  n: number;
}
export interface UnlockRule {
  /** 이 중 하나만 채우면 열린다 */
  any: UnlockCondition[];
  /** 선택 화면에 보일 조건 글 */
  text: string;
}
export interface UnlockData {
  start: string[];
  characters: Record<string, UnlockRule>;
}
export const UNLOCKS = unlocksJson as UnlockData;

export function emptyRunStats(): RunStats {
  return { poppedEnemies: 0, cushionPops: 0, threeCushions: 0, maxChain: 0 };
}
export function emptyTotals(): RunTotals {
  return { ...emptyRunStats(), reached: 0 };
}

/** 세이브에서 조건 하나의 현재 값 */
export function statValue(save: SaveData, kind: UnlockCondition["kind"], stat: UnlockStat): number {
  if (stat === "runs") return save.runs; // 한 판 최고 런 수는 뜻이 없으니 best도 누적으로 본다
  if (stat === "reached") return kind === "best" ? save.bestStage : save.totals.reached;
  return kind === "best" ? save.bests[stat] : save.totals[stat];
}

export function conditionMet(save: SaveData, c: UnlockCondition): boolean {
  return statValue(save, c.kind, c.stat) >= c.n;
}

/** 조건 하나의 진행 (0~1) */
export function conditionProgress(save: SaveData, c: UnlockCondition): number {
  return c.n <= 0 ? 1 : Math.min(1, statValue(save, c.kind, c.stat) / c.n);
}

/** 기록만으로 열려야 하는 캐릭터 (처음부터 열린 캐릭터 포함, 데이터 순서) */
export function earnedUnlocks(save: SaveData): string[] {
  const out = UNLOCKS.start.filter((id) => CHARACTERS[id]);
  for (const [id, rule] of Object.entries(UNLOCKS.characters)) {
    if (!CHARACTERS[id] || out.includes(id)) continue;
    if (rule.any.some((c) => conditionMet(save, c))) out.push(id);
  }
  return out;
}

/**
 * 세이브의 해금 목록을 기록에 맞게 고친다: 이미 열린 것은 그대로(없어진 캐릭터만 버린다),
 * 조건을 채운 것과 해본 적 있는 캐릭터(runs > 0)는 연다. 해금 규칙이 없는 캐릭터(새로 추가했는데 규칙을 안 적은 경우)도 연다.
 */
export function refreshUnlocks(save: SaveData): string[] {
  const set = new Set(save.unlocked.filter((id) => CHARACTERS[id]));
  for (const id of earnedUnlocks(save)) set.add(id);
  for (const [id, rec] of Object.entries(save.characters)) if (CHARACTERS[id] && rec.runs > 0) set.add(id);
  for (const id of Object.keys(CHARACTERS)) if (!UNLOCKS.start.includes(id) && !UNLOCKS.characters[id]) set.add(id);
  return Object.keys(CHARACTERS).filter((id) => set.has(id)).sort((a, b) => order(a) - order(b));
}

/** 데이터 순서 (start 먼저, 그다음 해금 규칙 순) */
function order(id: string): number {
  const all = [...UNLOCKS.start, ...Object.keys(UNLOCKS.characters)];
  const i = all.indexOf(id);
  return i < 0 ? all.length : i;
}

export function isCharacterUnlocked(save: SaveData, id: string): boolean {
  return save.unlocked.includes(id);
}

/** 런 기록 전후로 새로 열린 캐릭터 */
export function newlyUnlocked(before: SaveData, after: SaveData): string[] {
  return after.unlocked.filter((id) => !before.unlocked.includes(id));
}
