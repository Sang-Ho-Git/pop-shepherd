import { createGame, step } from "../core/game.ts";
import { RULES } from "../core/rules.ts";
import type { Game } from "../core/types.ts";
import { CAMPAIGN, character, ENEMIES, stage, weapon } from "../data/index.ts";
import { recomputeStats } from "../progression/passives.ts";
import { makeWeapon } from "../weapons/weapons.ts";
import { botInput } from "./bot.ts";

/** 스테이지 사이에 이어지는 성장 상태 */
export interface Carry {
  level: number;
  /** 누적 경험치 */
  xp: number;
  hp: number;
  passives: Record<string, number>;
  weapons: { id: string; lv: number }[];
}

export interface StageResult {
  stage: string;
  cleared: boolean;
  survived: number;
  /** 시작 / 끝 체력 비율 */
  hpStart: number;
  hpEnd: number;
  /** 스테이지 중 최저 체력 비율 */
  hpMin: number;
  levelStart: number;
  levelEnd: number;
  xpGained: number;
  pops: number;
  avgChain: number;
  alivePeak: number;
  weapons: string;
  passives: string;
}

export interface CampaignReport {
  seed: number;
  character: string;
  /** 클리어한 스테이지 수 (0~10) */
  reached: number;
  won: boolean;
  stages: StageResult[];
}

/** 캐릭터의 시작 무기. 동작이 아직 없는 무기(올가미·물감총)는 킥으로 대신한다. */
export function startWeapon(characterId: string): string {
  const id = character(characterId).startWeapon;
  return weapon(id).implemented ? id : "kick";
}

/** 성장 상태를 이어 받아 스테이지 하나를 만든다 */
export function startStage(seed: number, characterId: string, stageId: string, carry: Carry | null): Game {
  const g = createGame({
    seed,
    character: character(characterId),
    enemyDefs: ENEMIES,
    stage: stage(stageId),
    weapons: (carry?.weapons ?? [{ id: startWeapon(characterId), lv: 1 }]).map((w) => makeWeapon(weapon(w.id), w.lv)),
    leveling: true,
  });
  if (carry) {
    g.player.level = carry.level;
    g.player.passives = { ...carry.passives };
    g.stats.xp = carry.xp;
    recomputeStats(g);
    g.player.hp = Math.min(g.player.maxHp, carry.hp);
  }
  return g;
}

export function carryOf(g: Game): Carry {
  return {
    level: g.player.level,
    xp: g.stats.xp,
    hp: g.player.hp,
    passives: { ...g.player.passives },
    weapons: g.weapons.map((w) => ({ id: w.def.id, lv: w.level.lv as number })),
  };
}

/** 봇으로 스테이지 1부터 10까지 이어서 돌린다. 죽으면 거기서 끝. */
export function runCampaign(seed: number, characterId: string, stages: string[] = CAMPAIGN): CampaignReport {
  const out: StageResult[] = [];
  let carry: Carry | null = null;
  for (const [i, id] of stages.entries()) {
    const g = startStage(seed * 100 + i, characterId, id, carry);
    const hpStart = g.player.hp / g.player.maxHp;
    const levelStart = g.player.level;
    const xpStart = g.stats.xp;
    let hpMin = hpStart;
    const ticks = Math.round((g.stage!.duration + RULES.stage.wrapUpSeconds) * RULES.tickHz) + 2;
    for (let t = 0; t < ticks && (g.phase === "play" || g.phase === "wrapup"); t++) {
      step(g, botInput(g));
      hpMin = Math.min(hpMin, g.player.hp / g.player.maxHp);
    }
    const s = g.stats;
    out.push({
      stage: id,
      cleared: g.phase === "cleared",
      survived: g.time,
      hpStart,
      hpEnd: Math.max(0, g.player.hp) / g.player.maxHp,
      hpMin: Math.max(0, hpMin),
      levelStart,
      levelEnd: g.player.level,
      xpGained: s.xp - xpStart,
      pops: s.pops,
      avgChain: s.rootPops > 0 ? s.pops / s.rootPops : 0,
      alivePeak: s.alivePeak,
      weapons: g.weapons.map((w) => `${w.def.id}${w.level.lv}`).join(" "),
      passives: Object.entries(g.player.passives).map(([k, v]) => `${k}${v}`).join(" "),
    });
    if (g.phase !== "cleared") break;
    carry = carryOf(g);
    // 상점 자리: 지금은 스테이지 사이에 최대 체력의 일부를 회복한다.
    carry.hp = Math.min(g.player.maxHp, carry.hp + g.player.maxHp * RULES.stage.betweenHeal);
  }
  const reached = out.filter((r) => r.cleared).length;
  return { seed, character: characterId, reached, won: reached === stages.length, stages: out };
}
