import type { CharacterDef } from "../core/types.ts";
import { META } from "../data/index.ts";
import type { MetaNode } from "../data/index.ts";

/**
 * 2.3 영구 강화 트리 (런 밖). 노드 id → 산 레벨.
 * 1단계 노드는 바로, 2단계는 1단계 3레벨, 가지 끝은 2단계를 다 채워야 열린다 (data/meta_tree.json의 requires).
 */
export type MetaProfile = Record<string, number>;

/** 런 시작 때 적용되는 특수 효과 */
export interface MetaSpecials {
  revives: number;
  startWeaponLevel: number;
  freeRerolls: number;
  shopSlots: number;
  startGold: number;
  ballCooldownCut: number;
  cushionBonusUp: number;
}

export function metaNode(id: string): MetaNode {
  const n = META.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`알 수 없는 영구 강화: ${id}`);
  return n;
}

/** 다음 레벨 비용 (다 찼으면 null) */
export function nextCost(profile: MetaProfile, id: string): number | null {
  const n = metaNode(id);
  const lv = profile[id] ?? 0;
  return lv >= n.maxLevel ? null : (n.costs[lv] as number);
}

export function isUnlocked(profile: MetaProfile, id: string): boolean {
  const req = metaNode(id).requires ?? {};
  return Object.entries(req).every(([r, lv]) => (profile[r] ?? 0) >= lv);
}

export function canBuyNode(profile: MetaProfile, id: string, coins: number): boolean {
  const c = nextCost(profile, id);
  return c !== null && c <= coins && isUnlocked(profile, id);
}

export function buyNode(profile: MetaProfile, id: string): MetaProfile {
  if (!isUnlocked(profile, id)) throw new Error(`${id}: 아직 잠김`);
  if (nextCost(profile, id) === null) throw new Error(`${id}: 이미 최대`);
  return { ...profile, [id]: (profile[id] ?? 0) + 1 };
}

/** 트리를 전부 채우는 비용 */
export function totalTreeCost(): number {
  return META.nodes.reduce((a, n) => a + n.costs.reduce((x, y) => x + y, 0), 0);
}

/** 프로필이 규칙(최대 레벨, 선행 조건)을 지키는지 */
export function validateProfile(profile: MetaProfile): void {
  for (const [id, lv] of Object.entries(profile)) {
    const n = metaNode(id);
    if (lv < 0 || lv > n.maxLevel) throw new Error(`${id}: 레벨 ${lv}`);
    if (lv > 0 && !isUnlocked(profile, id)) throw new Error(`${id}: 선행 조건 미달`);
  }
}

/** 캐릭터 능력치에 영구 강화를 더한 사본과 특수 효과 */
export function applyMeta(ch: CharacterDef, profile: MetaProfile): { character: CharacterDef; specials: MetaSpecials } {
  validateProfile(profile);
  const s = { ...ch.stats };
  const sp: MetaSpecials = { revives: 0, startWeaponLevel: 1, freeRerolls: 0, shopSlots: 0, startGold: 0, ballCooldownCut: 0, cushionBonusUp: 0 };
  for (const [id, lv] of Object.entries(profile)) {
    if (lv <= 0) continue;
    const e = metaNode(id).effect;
    if (e.max_hp_pct) s.max_hp = Math.round(s.max_hp * (1 + e.max_hp_pct * lv));
    if (e.armor) s.armor += e.armor * lv;
    if (e.knock_power) s.knock_power += e.knock_power * lv;
    if (e.cooldown) s.cooldown += e.cooldown * lv;
    if (e.gold_find) s.gold_find += e.gold_find * lv;
    if (e.revive) sp.revives += e.revive * lv;
    if (e.startWeaponLevel) sp.startWeaponLevel += e.startWeaponLevel * lv;
    if (e.freeRerolls) sp.freeRerolls += e.freeRerolls * lv;
    if (e.shopSlots) sp.shopSlots += e.shopSlots * lv;
    if (e.move_speed) s.move_speed += e.move_speed * lv;
    if (e.pickup) s.pickup += e.pickup * lv;
    if (e.regen) s.regen += e.regen * lv;
    if (e.chain_radius) s.chain_radius += e.chain_radius * lv;
    if (e.aim_assist) s.aim_assist += e.aim_assist * lv;
    if (e.area) s.area += e.area * lv;
    if (e.luck) s.luck += e.luck * lv;
    if (e.startGold) sp.startGold += e.startGold * lv;
    if (e.ballCooldown) sp.ballCooldownCut += e.ballCooldown * lv;
    if (e.cushionBonus) sp.cushionBonusUp += e.cushionBonus * lv;
  }
  return { character: { ...ch, stats: s }, specials: sp };
}

/** 런이 끝나고 받는 코인과 그 내역 */
export interface RunCoins {
  /** 클리어 스테이지와 터뜨린 적에서 온 몫 */
  base: number;
  /** 런이 끝날 때 남은 인게임 골드에서 온 몫 (완주·실패 모두) */
  fromGold: number;
  total: number;
}

export function runCoins(stagesCleared: number, poppedEnemies: number, goldLeft = 0): RunCoins {
  const base = Math.round(META.coins.perStage * stagesCleared + META.coins.perPoppedEnemy * poppedEnemies);
  const fromGold = Math.floor(Math.max(0, goldLeft) * (META.coins.perGold ?? 0));
  return { base, fromGold, total: base + fromGold };
}

/** 런이 끝나고 받는 코인 (남은 골드 몫 포함) */
export function coinsForRun(stagesCleared: number, poppedEnemies: number, goldLeft = 0): number {
  return runCoins(stagesCleared, poppedEnemies, goldLeft).total;
}

/**
 * 시뮬용: 코인 c개를 모은 플레이어의 프로필. 살 수 있는 노드 중 가장 싼 것부터 산다
 * (같으면 생존 → 화력 → 경제, 데이터 순서).
 */
export function profileForCoins(coins: number): MetaProfile {
  let profile: MetaProfile = {};
  let left = coins;
  for (;;) {
    const options = META.nodes
      .filter((n) => canBuyNode(profile, n.id, left))
      .map((n) => ({ id: n.id, cost: nextCost(profile, n.id) as number }))
      .sort((a, b) => a.cost - b.cost);
    const pick = options[0];
    if (!pick) return profile;
    profile = buyNode(profile, pick.id);
    left -= pick.cost;
  }
}
