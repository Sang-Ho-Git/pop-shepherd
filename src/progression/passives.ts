import { RULES } from "../core/rules.ts";
import type { CharacterStats, Game } from "../core/types.ts";
import { PASSIVES } from "../data/index.ts";

/** 쿨다운 감소 상한 (기획서 v2: -50%) */
export const COOLDOWN_CAP = 0.5;

/**
 * 플레이어 능력치 = 캐릭터 기본값 + 패시브 레벨 × 레벨당 증가.
 * 최대 체력이 오르면 오른 만큼 현재 체력도 채운다.
 */
export function recomputeStats(g: Game): void {
  const p = g.player;
  const s: CharacterStats = { ...p.baseStats };
  for (const [id, lv] of Object.entries(p.passives)) {
    const def = PASSIVES[id];
    if (!def) throw new Error(`알 수 없는 패시브: ${id}`);
    for (const [k, v] of Object.entries(def.perLevel) as [keyof CharacterStats, number][]) s[k] += v * lv;
  }
  s.cooldown = Math.min(COOLDOWN_CAP, s.cooldown);
  const gained = s.max_hp - p.maxHp;
  p.stats = s;
  p.maxHp = s.max_hp;
  if (gained > 0) p.hp += gained;
  p.hp = Math.min(p.hp, p.maxHp);
  p.speed = RULES.player.baseSpeed * s.move_speed;
}

export function addPassive(g: Game, id: string): void {
  const def = PASSIVES[id];
  if (!def) throw new Error(`알 수 없는 패시브: ${id}`);
  if (!def.implemented) throw new Error(`${id}: 동작이 아직 없음`);
  const lv = g.player.passives[id] ?? 0;
  if (lv >= def.maxLevel) throw new Error(`${id}: 이미 최대 레벨`);
  g.player.passives[id] = lv + 1;
  recomputeStats(g);
}
