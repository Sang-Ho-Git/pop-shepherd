import enemiesJson from "../../data/enemies.json" with { type: "json" };
import charactersJson from "../../data/characters.json" with { type: "json" };
import balanceJson from "../../data/balance.json" with { type: "json" };
import passivesJson from "../../data/passives.json" with { type: "json" };
import shopJson from "../../data/shop.json" with { type: "json" };
import metaJson from "../../data/meta_tree.json" with { type: "json" };
import stage01 from "../../data/stages/stage01.json" with { type: "json" };
import stage02 from "../../data/stages/stage02.json" with { type: "json" };
import stage03 from "../../data/stages/stage03.json" with { type: "json" };
import stage04 from "../../data/stages/stage04.json" with { type: "json" };
import stage05 from "../../data/stages/stage05.json" with { type: "json" };
import stage06 from "../../data/stages/stage06.json" with { type: "json" };
import stage07 from "../../data/stages/stage07.json" with { type: "json" };
import stage08 from "../../data/stages/stage08.json" with { type: "json" };
import stage09 from "../../data/stages/stage09.json" with { type: "json" };
import stage10 from "../../data/stages/stage10.json" with { type: "json" };
import stage11 from "../../data/stages/stage11.json" with { type: "json" };
import stage12 from "../../data/stages/stage12.json" with { type: "json" };
import stage13 from "../../data/stages/stage13.json" with { type: "json" };
import stage14 from "../../data/stages/stage14.json" with { type: "json" };
import stage15 from "../../data/stages/stage15.json" with { type: "json" };
import m1Proving from "../../data/stages/m1_proving.json" with { type: "json" };
import shockwave from "../../data/weapons/shockwave.json" with { type: "json" };
import kick from "../../data/weapons/kick.json" with { type: "json" };
import magnetTotem from "../../data/weapons/magnet_totem.json" with { type: "json" };
import lasso from "../../data/weapons/lasso.json" with { type: "json" };
import paintGun from "../../data/weapons/paint_gun.json" with { type: "json" };
import whirlwind from "../../data/weapons/whirlwind.json" with { type: "json" };
import reflectWall from "../../data/weapons/reflect_wall.json" with { type: "json" };
import type { CharacterDef, EnemyDef, PassiveDef, StageDef, WeaponDef, WeaponLevel } from "../core/types.ts";

/** data/ 아래 JSON을 타입이 붙은 정의로 묶는다. 값 검증은 tests/data.test.ts가 한다. */
export const ENEMIES = enemiesJson as Record<string, EnemyDef>;
export const CHARACTERS = charactersJson as Record<string, CharacterDef>;
export const PASSIVES = passivesJson as Record<string, PassiveDef>;
/** 캠페인 순서 */
export const CAMPAIGN = Array.from({ length: 15 }, (_, i) => `stage${String(i + 1).padStart(2, "0")}`);
export const STAGES: Record<string, StageDef> = {
  stage01: stage01 as StageDef,
  stage02: stage02 as StageDef,
  stage03: stage03 as StageDef,
  stage04: stage04 as StageDef,
  stage05: stage05 as StageDef,
  stage06: stage06 as StageDef,
  stage07: stage07 as StageDef,
  stage08: stage08 as StageDef,
  stage09: stage09 as StageDef,
  stage10: stage10 as StageDef,
  stage11: stage11 as StageDef,
  stage12: stage12 as StageDef,
  stage13: stage13 as StageDef,
  stage14: stage14 as StageDef,
  stage15: stage15 as StageDef,
  m1_proving: m1Proving as StageDef,
};
export const WEAPONS: Record<string, WeaponDef> = Object.fromEntries(
  [shockwave, kick, magnetTotem, lasso, paintGun, whirlwind, reflectWall].map((w) => [w.id, w as unknown as WeaponDef]),
);

export interface Balance {
  normalizer: number;
  tolerance: number;
  targetLp: Record<string, number>;
  /** 스테이지별 접촉 피해 배율 계획 (CAMPAIGN 순서) */
  stageContactMul: { values: number[] };
}
export const BALANCE = balanceJson as Balance;

export type ShopKind = "weaponUp" | "newWeapon" | "passiveUp" | "newPassive" | "heal";
export interface ShopDef {
  goldPerPop: number;
  fillerGold: number;
  slots: number;
  rerollCost: number;
  /** 한 번 살 때마다 모든 가격이 이만큼 (복리로) 오른다 */
  inflation: number;
  healFrac: number;
  prices: Record<ShopKind, number>;
}
export const SHOP = shopJson as ShopDef;

export interface MetaEffect {
  max_hp_pct?: number;
  armor?: number;
  revive?: number;
  knock_power?: number;
  cooldown?: number;
  startWeaponLevel?: number;
  gold_find?: number;
  freeRerolls?: number;
  shopSlots?: number;
  move_speed?: number;
  pickup?: number;
  regen?: number;
  chain_radius?: number;
  aim_assist?: number;
  area?: number;
  luck?: number;
  /** 회복 드롭 확률 증가 */
  heal_find?: number;
  /** 무지개 젤리가 섞여 나올 확률 */
  rainbow?: number;
  /** 런 시작 골드 */
  startGold?: number;
  /** 색 공 쿨다운 감소 비율 */
  ballCooldown?: number;
  /** 쿠션 보너스 배율 증가 (0.25 = 쿠션 보너스 ×1.25) */
  cushionBonus?: number;
}
export interface MetaNode {
  id: string;
  branch: string;
  /** 이 캐릭터들만 살 수 있는 전용 노드 (없으면 모든 캐릭터의 공통 노드) */
  chars?: string[];
  name: string;
  maxLevel: number;
  costs: number[];
  requires?: Record<string, number>;
  effect: MetaEffect;
  note: string;
}
export interface MetaTree {
  coins: { perStage: number; perPoppedEnemy: number; /** 런이 끝날 때 남은 골드 1당 코인 */ perGold?: number };
  /** 다른 캐릭터가 이미 산 공통 노드 레벨의 할인율 (0.4 = 40% 싸게) */
  shareDiscount?: number;
  nodes: MetaNode[];
}
export const META = metaJson as MetaTree;

/**
 * 발사력 점수 (밸런스 시트와 같은 식):
 * LP = (날리는 힘 + 보조 가치) × 타격 수 × 조준 계수 ÷ 쿨다운 ÷ 정규화 상수
 */
export function lp(level: WeaponLevel, targets: number = level.targets): number {
  return ((level.knock + level.support) * targets * level.aim) / level.cooldown / BALANCE.normalizer;
}

export function targetLp(level: WeaponLevel): number {
  const t = BALANCE.targetLp[String(level.lv)];
  if (t === undefined) throw new Error(`목표 LP 없음: Lv${level.lv}`);
  return t;
}

export function character(id: string): CharacterDef {
  const c = CHARACTERS[id];
  if (!c) throw new Error(`알 수 없는 캐릭터: ${id}`);
  return c;
}

export function weapon(id: string): WeaponDef {
  const w = WEAPONS[id];
  if (!w) throw new Error(`알 수 없는 무기: ${id}`);
  return w;
}

export function stage(id: string): StageDef {
  const s = STAGES[id];
  if (!s) throw new Error(`알 수 없는 스테이지: ${id}`);
  return s;
}
