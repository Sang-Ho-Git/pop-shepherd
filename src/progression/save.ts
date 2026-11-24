import { CAMPAIGN, CHARACTERS, META } from "../data/index.ts";
import { buyNode, canBuyNode, costFor, isUnlocked, metaNode, nextCost, nodeForCharacter, nodesFor } from "./meta.ts";
import type { MetaBook, MetaProfile } from "./meta.ts";
import { emptyRunStats, emptyTotals, refreshUnlocks, RUN_STAT_KEYS } from "./unlocks.ts";
import type { RunStats, RunTotals } from "./unlocks.ts";

/**
 * 5.5 세이브: 런 밖에 남는 것만 저장한다 (영구 강화 코인과 트리, 기록).
 * 런 중간 저장은 하지 않는다 (한 판이 스테이지 15개, 약 30분).
 *
 * 저장 형식은 버전이 붙은 JSON이고, 읽을 때 데이터가 바뀌었어도 깨지지 않게 고친다:
 * 없어진 노드는 버리고, 최대 레벨이 줄었으면 깎고, 선행 조건이 안 맞는 노드는 버린다 (코인은 돌려주지 않는다).
 *
 * 캐릭터 해금(unlocked, totals, bests)은 버전 1 안에서 나중에 붙인 필드다. 이 필드가 없는 예전 세이브는
 * 기록으로 판정해 열어 준다: 조건을 이미 채운 캐릭터, 해본 적 있는 캐릭터(characters[id].runs > 0)는 열린다.
 * 누적 기록(totals)은 예전 세이브에 없으니 0부터 센다 (클리어 스테이지·런 수 조건은 예전 기록으로 판정된다).
 *
 * 버전 2 (11/24): 영구 강화가 캐릭터별 트리가 됐다 (meta: 캐릭터 id → 프로필). 코인 지갑은 공용.
 * 버전 1 세이브의 공용 트리는 쓴 코인을 전부 지갑으로 돌려주고 비운다 (캐릭터별로 다시 고르게).
 * 돌려준 코인은 metaRefund에 남겨 화면이 한 번 안내하고 0으로 지운다 (acknowledgeRefund).
 */
export const SAVE_VERSION = 2;

/**
 * 버전 1 세이브의 공용 트리 비용 (11/24 캐릭터별로 바꾸기 직전, 8845 코인 트리). 환불 계산에만 쓴다.
 * 여기 없는 노드(더 예전 트리에만 있던 것)는 돌려줄 값을 알 수 없어 0으로 본다. 넘친 레벨은 표의 길이로 깎는다.
 */
const LEGACY_COSTS: Record<string, number[]> = {
  sturdy: [80, 110, 145, 190],
  fleece: [160, 225],
  lick: [125, 170, 225],
  second_chance: [405, 720],
  strength: [80, 110, 145, 190],
  focus: [135, 180, 235],
  shock: [125, 170, 225],
  reach: [135, 190],
  first_move: [540],
  chalk: [65, 90, 125],
  boots: [115, 160, 215],
  quick_rack: [90, 125, 170],
  keen_eye: [205, 290],
  thrift: [65, 90, 125, 170],
  crook: [100, 145],
  purse: [90, 125, 170],
  clover: [135, 190],
  haggle: [135, 190],
  regular: [450],
};

/** 버전 1 공용 트리에 쓴 코인 (환불액) */
export function legacyRefund(raw: unknown): number {
  let sum = 0;
  for (const [id, lv] of Object.entries(record(raw))) {
    const costs = LEGACY_COSTS[id] ?? [];
    sum += costs.slice(0, count(lv)).reduce((a, b) => a + b, 0);
  }
  return sum;
}

export interface CharacterRecord {
  runs: number;
  wins: number;
  /** 가장 멀리 클리어한 스테이지 수 (0~15) */
  bestStage: number;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  coins: number;
  /** 캐릭터 id → 그 캐릭터의 영구 강화 트리 */
  meta: MetaBook;
  /** 캐릭터별 트리로 바뀌며 돌려받은 코인 (아직 안내하지 않았으면 > 0) */
  metaRefund: number;
  runs: number;
  wins: number;
  bestStage: number;
  characters: Record<string, CharacterRecord>;
  /** 열린 캐릭터 (src/progression/unlocks.ts) */
  unlocked: string[];
  /** 모든 판 누적 기록, 한 판 최고 기록 (해금 조건 판정용) */
  totals: RunTotals;
  bests: RunStats;
}

/** 런 결과 중 세이브에 필요한 것 (시뮬의 CampaignReport와 같은 이름). 런 기록이 없으면 0으로 본다. */
export interface RunResult extends Partial<RunStats> {
  character: string;
  /** 클리어한 스테이지 수 */
  reached: number;
  won: boolean;
  coins: number;
}

export function newSave(): SaveData {
  const s: SaveData = { version: SAVE_VERSION, coins: 0, meta: {}, metaRefund: 0, runs: 0, wins: 0, bestStage: 0, characters: {}, unlocked: [], totals: emptyTotals(), bests: emptyRunStats() };
  return { ...s, unlocked: refreshUnlocks(s) };
}

/** 런 기록을 세이브에 더한다. 조건을 채운 캐릭터는 여기서 열린다 (새로 열린 것은 unlocks.ts의 newlyUnlocked로). */
export function recordRun(save: SaveData, r: RunResult): SaveData {
  const prev = save.characters[r.character] ?? { runs: 0, wins: 0, bestStage: 0 };
  const totals = { ...save.totals, reached: save.totals.reached + Math.max(0, r.reached) };
  const bests = { ...save.bests };
  for (const k of RUN_STAT_KEYS) {
    const v = Math.max(0, r[k] ?? 0);
    totals[k] += v;
    bests[k] = Math.max(bests[k], v);
  }
  const next: SaveData = {
    ...save,
    totals,
    bests,
    coins: save.coins + Math.max(0, Math.round(r.coins)),
    runs: save.runs + 1,
    wins: save.wins + (r.won ? 1 : 0),
    bestStage: Math.max(save.bestStage, r.reached),
    characters: {
      ...save.characters,
      [r.character]: { runs: prev.runs + 1, wins: prev.wins + (r.won ? 1 : 0), bestStage: Math.max(prev.bestStage, r.reached) },
    },
  };
  return { ...next, unlocked: refreshUnlocks(next) };
}

/** 캐릭터의 트리 (없으면 빈 트리) */
export function profileOf(save: SaveData, characterId: string): MetaProfile {
  return save.meta[characterId] ?? {};
}

/** 캐릭터 트리의 노드 한 레벨을 공용 코인으로 산다. 코인이 모자라거나 잠겨 있거나 다른 캐릭터 전용이면 오류. */
export function spendOnMeta(save: SaveData, characterId: string, id: string): SaveData {
  if (!nodeForCharacter(metaNode(id), characterId)) throw new Error(`${id}: ${characterId} 전용 노드가 아님`);
  const profile = profileOf(save, characterId);
  const c = costFor(save.meta, characterId, id);
  if (c === null) throw new Error(`${id}: 이미 최대`);
  if (!isUnlocked(profile, id)) throw new Error(`${id}: 아직 잠김`);
  if (save.coins < c.cost) throw new Error(`${id}: 코인이 모자람 (${save.coins} < ${c.cost})`);
  return { ...save, coins: save.coins - c.cost, meta: { ...save.meta, [characterId]: buyNode(profile, id) } };
}

/** 시뮬용: 그 캐릭터 트리에서 살 수 있는 가장 싼 노드부터 코인이 떨어질 때까지 산다 (공유 할인 반영) */
export function botSpend(save: SaveData, characterId: string): SaveData {
  let s = save;
  for (;;) {
    const profile = profileOf(s, characterId);
    const options = nodesFor(characterId)
      .map((n) => ({ id: n.id, cost: costFor(s.meta, characterId, n.id)?.cost ?? null }))
      .filter((o): o is { id: string; cost: number } => o.cost !== null && canBuyNode(profile, o.id, s.coins, o.cost))
      .sort((a, b) => a.cost - b.cost);
    const pick = options[0];
    if (!pick) return s;
    s = spendOnMeta(s, characterId, pick.id);
  }
}

/** 캐릭터 트리를 얼마나 채웠는지 (산 레벨의 정가 ÷ 트리 전체 정가) */
export function treeProgress(save: SaveData, characterId: string): number {
  let spent = 0;
  let total = 0;
  const profile = profileOf(save, characterId);
  for (const n of nodesFor(characterId)) {
    const lv = profile[n.id] ?? 0;
    total += n.costs.reduce((a, b) => a + b, 0);
    spent += n.costs.slice(0, lv).reduce((a, b) => a + b, 0);
  }
  return total > 0 ? spent / total : 1;
}

/** 모든 캐릭터 트리의 평균 진행 (제목 화면 요약) */
export function allTreesProgress(save: SaveData): number {
  const ids = Object.keys(CHARACTERS);
  return ids.reduce((a, id) => a + treeProgress(save, id), 0) / Math.max(1, ids.length);
}

/** 환불 안내를 보여 줬다 */
export function acknowledgeRefund(save: SaveData): SaveData {
  return save.metaRefund > 0 ? { ...save, metaRefund: 0 } : save;
}

export function serializeSave(save: SaveData): string {
  return JSON.stringify(save);
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** 현재 트리에 맞게 캐릭터 프로필을 고친다 (없어진 노드·다른 캐릭터 전용·넘친 레벨·선행 조건 위반 제거) */
function repairProfile(raw: unknown, characterId: string): { meta: MetaProfile; dropped: string[] } {
  const dropped: string[] = [];
  const meta: MetaProfile = {};
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const [id, lv] of Object.entries(src)) {
    const node = META.nodes.find((n) => n.id === id);
    const n = count(lv);
    if (!node || !nodeForCharacter(node, characterId)) {
      dropped.push(id);
      continue;
    }
    if (n > 0) meta[id] = Math.min(n, node.maxLevel);
  }
  // 선행 조건이 안 맞는 노드는 버린다. 하나를 버리면 다른 노드가 깨질 수 있어 바뀌지 않을 때까지 반복.
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of Object.keys(meta)) {
      if (!isUnlocked(meta, id)) {
        delete meta[id];
        dropped.push(id);
        changed = true;
      }
    }
  }
  return { meta, dropped };
}

export type ParseResult = { ok: true; save: SaveData; dropped: string[] } | { ok: false; error: string };

export function parseSave(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON이 아님" };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "객체가 아님" };
  const o = raw as Record<string, unknown>;
  if (o.version !== SAVE_VERSION && o.version !== 1) return { ok: false, error: `알 수 없는 버전: ${String(o.version)}` };
  // 버전 1: 공용 트리 → 쓴 코인을 돌려주고 캐릭터별 트리는 빈 채로 시작
  const legacy = o.version === 1 ? legacyRefund(o.meta) : 0;
  const meta: MetaBook = {};
  const dropped: string[] = [];
  if (o.version === SAVE_VERSION) {
    for (const [ch, p] of Object.entries(record(o.meta))) {
      if (!CHARACTERS[ch]) {
        dropped.push(...Object.keys(record(p)).map((id) => `${ch}:${id}`));
        continue;
      }
      const r = repairProfile(p, ch);
      if (Object.keys(r.meta).length > 0) meta[ch] = r.meta;
      dropped.push(...r.dropped.map((id) => `${ch}:${id}`));
    }
  }
  const characters: Record<string, CharacterRecord> = {};
  if (o.characters && typeof o.characters === "object") {
    for (const [id, c] of Object.entries(o.characters as Record<string, unknown>)) {
      const r = (c ?? {}) as Record<string, unknown>;
      characters[id] = { runs: count(r.runs), wins: count(r.wins), bestStage: Math.min(CAMPAIGN.length, count(r.bestStage)) };
    }
  }
  const save: SaveData = {
    version: SAVE_VERSION,
    coins: count(o.coins) + legacy,
    meta,
    metaRefund: count(o.metaRefund) + legacy,
    runs: count(o.runs),
    wins: count(o.wins),
    bestStage: Math.min(CAMPAIGN.length, count(o.bestStage)),
    characters,
    unlocked: Array.isArray(o.unlocked) ? o.unlocked.filter((x): x is string => typeof x === "string") : [],
    totals: { ...readStats(o.totals), reached: count(record(o.totals).reached) },
    bests: readStats(o.bests),
  };
  // 예전 세이브(unlocked 없음)도, 해금 규칙이 바뀐 경우도 같은 규칙으로: 기록으로 열릴 것은 열고, 없는 캐릭터는 버린다
  return { ok: true, dropped, save: { ...save, unlocked: refreshUnlocks(save) } };
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function readStats(v: unknown): RunStats {
  const r = record(v);
  const out = emptyRunStats();
  for (const k of RUN_STAT_KEYS) out[k] = count(r[k]);
  return out;
}

/** 저장 장소 (브라우저 localStorage, 파일, 테스트용 메모리) */
export interface SaveStore {
  read(): string | null;
  write(text: string): void;
}

export function memoryStore(initial: string | null = null): SaveStore & { text: string | null; backup: string | null } {
  const s = {
    text: initial,
    backup: null as string | null,
    read: () => s.text,
    write: (t: string) => {
      s.text = t;
    },
  };
  return s;
}

/** 브라우저 localStorage. 막혀 있으면(사생활 보호 모드 등) 읽기는 null, 쓰기는 조용히 실패한다. */
export function browserStore(key = "pop-shepherd-save"): SaveStore {
  const ls = (): Storage | null => {
    try {
      return (globalThis as { localStorage?: Storage }).localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    read: () => {
      try {
        return ls()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write: (t) => {
      try {
        ls()?.setItem(key, t);
      } catch {
        // 저장 공간이 막혀 있으면 이번 판 기록만 잃는다
      }
    },
  };
}

/**
 * 세이브를 읽는다. 없으면 새로 만든다.
 * 깨져 있으면 새로 시작하되, 원본은 onCorrupt로 넘겨 따로 보관할 수 있게 한다 (덮어쓰기 전에).
 */
export function loadSave(store: SaveStore, onCorrupt?: (text: string, error: string) => void): SaveData {
  const text = store.read();
  if (text === null) return newSave();
  const r = parseSave(text);
  if (r.ok) return r.save;
  onCorrupt?.(text, r.error);
  return newSave();
}

export function writeSave(store: SaveStore, save: SaveData): void {
  store.write(serializeSave(save));
}
