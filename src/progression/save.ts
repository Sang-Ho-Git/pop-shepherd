import { META } from "../data/index.ts";
import { buyNode, canBuyNode, isUnlocked, nextCost } from "./meta.ts";
import type { MetaProfile } from "./meta.ts";

/**
 * 5.5 세이브: 런 밖에 남는 것만 저장한다 (영구 강화 코인과 트리, 기록).
 * 런 중간 저장은 하지 않는다 (한 판이 스테이지 10개, 30~40분).
 *
 * 저장 형식은 버전이 붙은 JSON이고, 읽을 때 데이터가 바뀌었어도 깨지지 않게 고친다:
 * 없어진 노드는 버리고, 최대 레벨이 줄었으면 깎고, 선행 조건이 안 맞는 노드는 버린다 (코인은 돌려주지 않는다).
 */
export const SAVE_VERSION = 1;

export interface CharacterRecord {
  runs: number;
  wins: number;
  /** 가장 멀리 클리어한 스테이지 수 (0~10) */
  bestStage: number;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  coins: number;
  meta: MetaProfile;
  runs: number;
  wins: number;
  bestStage: number;
  characters: Record<string, CharacterRecord>;
}

/** 런 결과 중 세이브에 필요한 것 (시뮬의 CampaignReport와 같은 이름) */
export interface RunResult {
  character: string;
  /** 클리어한 스테이지 수 */
  reached: number;
  won: boolean;
  coins: number;
}

export function newSave(): SaveData {
  return { version: SAVE_VERSION, coins: 0, meta: {}, runs: 0, wins: 0, bestStage: 0, characters: {} };
}

export function recordRun(save: SaveData, r: RunResult): SaveData {
  const prev = save.characters[r.character] ?? { runs: 0, wins: 0, bestStage: 0 };
  return {
    ...save,
    coins: save.coins + Math.max(0, Math.round(r.coins)),
    runs: save.runs + 1,
    wins: save.wins + (r.won ? 1 : 0),
    bestStage: Math.max(save.bestStage, r.reached),
    characters: {
      ...save.characters,
      [r.character]: { runs: prev.runs + 1, wins: prev.wins + (r.won ? 1 : 0), bestStage: Math.max(prev.bestStage, r.reached) },
    },
  };
}

/** 영구 강화 노드 한 레벨을 코인으로 산다. 코인이 모자라거나 잠겨 있으면 오류. */
export function spendOnMeta(save: SaveData, id: string): SaveData {
  const cost = nextCost(save.meta, id);
  if (cost === null) throw new Error(`${id}: 이미 최대`);
  if (!isUnlocked(save.meta, id)) throw new Error(`${id}: 아직 잠김`);
  if (save.coins < cost) throw new Error(`${id}: 코인이 모자람 (${save.coins} < ${cost})`);
  return { ...save, coins: save.coins - cost, meta: buyNode(save.meta, id) };
}

/** 시뮬용: 살 수 있는 가장 싼 노드부터 코인이 떨어질 때까지 산다 */
export function botSpend(save: SaveData): SaveData {
  let s = save;
  for (;;) {
    const options = META.nodes
      .filter((n) => canBuyNode(s.meta, n.id, s.coins))
      .map((n) => ({ id: n.id, cost: nextCost(s.meta, n.id) as number }))
      .sort((a, b) => a.cost - b.cost);
    const pick = options[0];
    if (!pick) return s;
    s = spendOnMeta(s, pick.id);
  }
}

/** 트리를 얼마나 채웠는지 (쓴 코인 ÷ 전체 비용) */
export function treeProgress(save: SaveData): number {
  let spent = 0;
  let total = 0;
  for (const n of META.nodes) {
    const lv = save.meta[n.id] ?? 0;
    total += n.costs.reduce((a, b) => a + b, 0);
    spent += n.costs.slice(0, lv).reduce((a, b) => a + b, 0);
  }
  return total > 0 ? spent / total : 1;
}

export function serializeSave(save: SaveData): string {
  return JSON.stringify(save);
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** 현재 트리에 맞게 프로필을 고친다 (없어진 노드·넘친 레벨·선행 조건 위반 제거) */
function repairProfile(raw: unknown): { meta: MetaProfile; dropped: string[] } {
  const dropped: string[] = [];
  const meta: MetaProfile = {};
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const [id, lv] of Object.entries(src)) {
    const node = META.nodes.find((n) => n.id === id);
    const n = count(lv);
    if (!node) {
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
  if (o.version !== SAVE_VERSION) return { ok: false, error: `알 수 없는 버전: ${String(o.version)}` };
  const { meta, dropped } = repairProfile(o.meta);
  const characters: Record<string, CharacterRecord> = {};
  if (o.characters && typeof o.characters === "object") {
    for (const [id, c] of Object.entries(o.characters as Record<string, unknown>)) {
      const r = (c ?? {}) as Record<string, unknown>;
      characters[id] = { runs: count(r.runs), wins: count(r.wins), bestStage: Math.min(10, count(r.bestStage)) };
    }
  }
  return {
    ok: true,
    dropped,
    save: {
      version: SAVE_VERSION,
      coins: count(o.coins),
      meta,
      runs: count(o.runs),
      wins: count(o.wins),
      bestStage: Math.min(10, count(o.bestStage)),
      characters,
    },
  };
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
