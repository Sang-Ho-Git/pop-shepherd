import { CHARACTERS } from "../data/index.ts";
import { metaNode, nodesFor } from "./meta.ts";
import { newSave, parseSave, serializeSave } from "./save.ts";
import type { SaveData } from "./save.ts";
import { UNLOCKS } from "./unlocks.ts";

/**
 * 테스트용 세이브 조작 (11/26: 영구 강화·해금을 초기화하거나 임의로 정해 시험하는 화면).
 * 모든 함수는 새 세이브를 돌려주고, 끝에 저장·읽기와 같은 규칙(parseSave)으로 고친다:
 *  - 노드 레벨은 최대 레벨까지, 선행 조건이 모자란 노드는 버려진다 (읽을 때도 그렇게 고쳐지므로 같게 둔다).
 *  - 잠근 캐릭터는 그 캐릭터의 판 기록(runs)을 지운다. 그래도 누적·최고 기록이 해금 조건을 채우면 읽을 때 다시 열린다.
 */
function normalize(save: SaveData): SaveData {
  const r = parseSave(serializeSave(save));
  if (!r.ok) throw new Error(r.error);
  return r.save;
}

/** 처음 상태: 올리만 열림, 코인 0, 트리 비움, 기록 0 */
export function resetSave(): SaveData {
  return newSave();
}

/** 처음부터 열려 있는 캐릭터는 잠글 수 없다 */
export function canLock(id: string): boolean {
  return !UNLOCKS.start.includes(id);
}

export function setCharacterUnlocked(save: SaveData, id: string, open: boolean): SaveData {
  if (!CHARACTERS[id]) throw new Error(`알 수 없는 캐릭터: ${id}`);
  if (open) return normalize({ ...save, unlocked: [...new Set([...save.unlocked, id])] });
  if (!canLock(id)) return save;
  const characters = { ...save.characters };
  delete characters[id];
  return normalize({ ...save, unlocked: save.unlocked.filter((x) => x !== id), characters });
}

export function unlockAll(save: SaveData): SaveData {
  return normalize({ ...save, unlocked: Object.keys(CHARACTERS) });
}

export function setCoins(save: SaveData, coins: number): SaveData {
  return { ...save, coins: Number.isFinite(coins) ? Math.max(0, Math.floor(coins)) : 0 };
}

export function addCoins(save: SaveData, delta: number): SaveData {
  return setCoins(save, save.coins + delta);
}

/** 그 캐릭터 트리를 모두 최대 레벨로 */
export function fillTree(save: SaveData, characterId: string): SaveData {
  const profile: Record<string, number> = {};
  for (const n of nodesFor(characterId)) profile[n.id] = n.maxLevel;
  return normalize({ ...save, meta: { ...save.meta, [characterId]: profile } });
}

export function clearTree(save: SaveData, characterId: string): SaveData {
  const meta = { ...save.meta };
  delete meta[characterId];
  return { ...save, meta };
}

/** 노드 레벨을 직접 지정한다 (0~최대). 선행 조건이 안 맞으면 읽을 때처럼 버려진다. */
export function setNodeLevel(save: SaveData, characterId: string, id: string, level: number): SaveData {
  const node = metaNode(id);
  const lv = Math.max(0, Math.min(node.maxLevel, Math.floor(level)));
  const profile = { ...(save.meta[characterId] ?? {}) };
  if (lv > 0) profile[id] = lv;
  else delete profile[id];
  return normalize({ ...save, meta: { ...save.meta, [characterId]: profile } });
}
