import { createGame, step } from "../core/game.ts";
import { RULES } from "../core/rules.ts";
import type { CharacterDef, Game } from "../core/types.ts";
import { applyMeta, coinsForRun } from "../progression/meta.ts";
import type { MetaProfile, MetaSpecials } from "../progression/meta.ts";
import { botShop } from "../progression/shop.ts";
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
  weapons: { id: string; lv: number | "evo"; branch: string | null }[];
  gold: number;
  purchases: number;
  revives: number;
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
  /** 스테이지에서 터뜨린 적 수 */
  popped: number;
  /** 스테이지가 끝났을 때 골드, 이 스테이지에서 번 골드 */
  gold: number;
  goldEarned: number;
  /** 이어진 정비 상점에서 산 것, 진화한 무기 */
  bought: string[];
  evolved: string[];
  /** 부활을 썼는지 */
  revived: boolean;
  /** 엘리트: 나온 수, 쓰러뜨린 수 */
  elitesSpawned: number;
  elitesKilled: number;
  /** 보스를 쓰러뜨리는 데 걸린 시간 (s, 등장부터). 보스가 없거나 못 잡았으면 null */
  bossTime: number | null;
  chests: number;
  /** 받은 접촉 피해, 그중 엘리트·보스 몫 */
  damageTaken: number;
  damageFromSpecial: number;
  evolutions: number;
  /** 스테이지가 끝났을 때 남은 보스 체력 비율 (보스가 없으면 null) */
  bossHpLeft: number | null;
  /** 엘리트·보스가 팝으로 입은 피해, 그런 팝 수 */
  specialDamage: number;
  specialHits: number;
  /** 떨어진 골드 중 주운 비율 */
  goldPickRate: number;
  /** 처치형 스테이지가 시간 제한에 걸렸는지 */
  timedOut: boolean;
}

export interface CampaignReport {
  seed: number;
  character: string;
  /** 클리어한 스테이지 수 (0~10) */
  reached: number;
  won: boolean;
  stages: StageResult[];
  /** 런이 끝나고 받는 영구 강화 코인 */
  coins: number;
}

export interface CampaignOptions {
  /** 영구 강화 (기본: 없음) */
  meta?: MetaProfile;
  /** 정비 상점을 쓰는지 (기본 true) */
  shop?: boolean;
}

/** 캐릭터의 시작 무기. 동작이 아직 없는 무기(올가미·물감총)는 킥으로 대신한다. */
export function startWeapon(characterId: string): string {
  const id = character(characterId).startWeapon;
  return weapon(id).implemented ? id : "kick";
}

/** 성장 상태를 이어 받아 스테이지 하나를 만든다 */
export function startStage(
  seed: number,
  characterId: string,
  stageId: string,
  carry: Carry | null,
  meta: { character: CharacterDef; specials: MetaSpecials } | null = null,
  /** 화면용: 레벨업·상자 선택을 사람에게 맡긴다 */
  manual = false,
  /** 색 공 규칙 (실험) */
  ballMode = false,
): Game {
  const startLv = meta?.specials.startWeaponLevel ?? 1;
  const g = createGame({
    seed,
    character: meta?.character ?? character(characterId),
    enemyDefs: ENEMIES,
    stage: stage(stageId),
    weapons: (carry?.weapons ?? [{ id: startWeapon(characterId), lv: startLv, branch: null }]).map((w) => makeWeapon(weapon(w.id), w.lv, w.branch)),
    leveling: true,
    manualChoices: manual,
    ballMode,
  });
  if (carry) {
    g.player.level = carry.level;
    g.player.passives = { ...carry.passives };
    g.stats.xp = carry.xp;
    recomputeStats(g);
    g.player.hp = Math.min(g.player.maxHp, carry.hp);
    g.player.gold = carry.gold;
    g.player.purchases = carry.purchases;
    g.player.revives = carry.revives;
  } else {
    g.player.revives = meta?.specials.revives ?? 0;
  }
  return g;
}

export function carryOf(g: Game): Carry {
  return {
    level: g.player.level,
    xp: g.stats.xp,
    hp: g.player.hp,
    passives: { ...g.player.passives },
    weapons: g.weapons.map((w) => ({ id: w.def.id, lv: w.level.lv, branch: w.level.branch })),
    gold: g.player.gold,
    purchases: g.player.purchases,
    revives: g.player.revives,
  };
}

/** 봇으로 스테이지 1부터 10까지 이어서 돌린다. 죽으면 거기서 끝. */
export function runCampaign(seed: number, characterId: string, stages: string[] = CAMPAIGN, opts: CampaignOptions = {}): CampaignReport {
  const out: StageResult[] = [];
  let carry: Carry | null = null;
  const meta = opts.meta ? applyMeta(character(characterId), opts.meta) : null;
  for (const [i, id] of stages.entries()) {
    const g = startStage(seed * 100 + i, characterId, id, carry, meta);
    const goldStart = g.player.gold;
    const revivesStart = g.player.revives;
    const hpStart = g.player.hp / g.player.maxHp;
    const levelStart = g.player.level;
    const xpStart = g.stats.xp;
    let hpMin = hpStart;
    const survive = (g.stage!.clear ?? "survive") === "survive";
    const limit = survive ? g.stage!.duration + RULES.stage.wrapUpSeconds : RULES.boss.hardLimit;
    const ticks = Math.round(limit * RULES.tickHz) + 2;
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
      weapons: g.weapons.map((w) => `${w.def.id}${w.level.lv}${w.level.branch ?? ""}`).join(" "),
      passives: Object.entries(g.player.passives).map(([k, v]) => `${k}${v}`).join(" "),
      popped: s.poppedEnemies,
      gold: g.player.gold,
      goldEarned: g.player.gold - goldStart,
      bought: [],
      evolved: [],
      revived: g.player.revives < revivesStart,
      elitesSpawned: s.elitesSpawned,
      elitesKilled: s.elitesKilled,
      bossTime: s.bossKilled > 0 && g.stage!.boss ? s.bossKilledAt - g.stage!.boss.at : null,
      chests: s.chestsOpened,
      damageTaken: s.damageTaken,
      damageFromSpecial: s.damageFromSpecial,
      evolutions: s.evolutions,
      bossHpLeft: (() => {
        if (!g.stage!.boss) return null;
        if (s.bossKilled > 0) return 0;
        const b = g.enemies.find((e) => e.rank === "boss");
        return b ? b.hp / b.maxHp : 1;
      })(),
      specialDamage: s.specialDamage,
      specialHits: s.specialHits,
      goldPickRate: s.goldDropped > 0 ? s.goldPicked / s.goldDropped : 1,
      timedOut: !g.player.dead && g.phase !== "cleared",
    });
    if (g.phase !== "cleared") break;
    // 스테이지 사이: 최대 체력의 일부를 회복한 뒤 정비 상점
    g.player.hp = Math.min(g.player.maxHp, g.player.hp + g.player.maxHp * RULES.stage.betweenHeal);
    if (opts.shop !== false && i < stages.length - 1) {
      const res = botShop(g, meta ? { extraSlots: meta.specials.shopSlots, freeRerolls: meta.specials.freeRerolls } : {});
      const last = out[out.length - 1] as StageResult;
      last.bought = res.bought;
      last.evolved = res.evolved;
    }
    carry = carryOf(g);
  }
  const reached = out.filter((r) => r.cleared).length;
  const coins = coinsForRun(reached, out.reduce((a, r) => a + r.popped, 0));
  return { seed, character: characterId, reached, won: reached === stages.length, stages: out, coins };
}
