import { createGame, step } from "../core/game.ts";
import { RULES } from "../core/rules.ts";
import type { Game } from "../core/types.ts";
import { character, ENEMIES, lp, stage, weapon } from "../data/index.ts";
import { makeWeapon } from "../weapons/weapons.ts";
import { botInput } from "./bot.ts";

export interface SimOptions {
  seed: number;
  stageId: string;
  characterId: string;
  /** lv: 1~7 또는 "evo". Lv4 이후는 branch("A"/"B") */
  weapons: { id: string; lv: number | "evo"; branch?: string | null }[];
  /** 기본값: 스테이지 길이 */
  seconds?: number;
}

export interface WeaponReport {
  id: string;
  lv: number | "evo";
  branch: string | null;
  fires: number;
  /** 실측 타격 수 (발사 1회당 맞힌 적) */
  avgHits: number;
  /** 시트의 타격 수 가정값 */
  assumedTargets: number;
  lpSheet: number;
  lpMeasured: number;
}

export interface SimReport {
  seed: number;
  stage: string;
  character: string;
  seconds: number;
  survived: number;
  died: boolean;
  /** 클리어 (마무리 시간까지 생존) */
  cleared: boolean;
  /** 마무리 시간에 터뜨린 적 */
  wrapUpPopped: number;
  /** 마무리 시간이 끝날 때 남아서 사라진 적 */
  vanished: number;
  spawned: number;
  alivePeak: number;
  pops: number;
  poppedEnemies: number;
  killedEnemies: number;
  /** 매치로 처치한 비율 = 팝 ÷ (팝 + 직접 처치) */
  matchKillRatio: number;
  /** 평균 연쇄 = 전체 팝 ÷ 연쇄의 시작 팝 */
  avgChain: number;
  /** 폭탄 팝을 뺀 평균 연쇄 (매치 팝끼리만). M1 판정은 avgChain을 쓴다. */
  matchChain: number;
  bombPops: number;
  maxChain: number;
  stalls: number;
  stallsPerMinute: number;
  xp: number;
  weapons: WeaponReport[];
}

/** M1 통과 기준 (로드맵) */
export const M1_CRITERIA = { matchKillRatio: 0.7, avgChain: 1.3, stallsPerMinute: 1 } as const;

export function summarize(g: Game, opts: SimOptions, seconds: number): SimReport {
  const s = g.stats;
  const survived = g.time;
  const finished = s.poppedEnemies + s.killedEnemies;
  return {
    seed: opts.seed,
    stage: opts.stageId,
    character: opts.characterId,
    seconds,
    survived,
    died: g.player.dead,
    cleared: g.phase === "cleared",
    wrapUpPopped: s.wrapUpPopped,
    vanished: s.vanished,
    spawned: s.spawned,
    alivePeak: s.alivePeak,
    pops: s.pops,
    poppedEnemies: s.poppedEnemies,
    killedEnemies: s.killedEnemies,
    matchKillRatio: finished > 0 ? s.poppedEnemies / finished : 0,
    avgChain: s.rootPops > 0 ? s.pops / s.rootPops : 0,
    matchChain: s.rootPops - s.bombPops > 0 ? (s.pops - s.bombPops) / (s.rootPops - s.bombPops) : 0,
    bombPops: s.bombPops,
    maxChain: s.maxChain,
    stalls: s.stalls,
    stallsPerMinute: survived > 0 ? s.stalls / (survived / 60) : 0,
    xp: s.xp,
    weapons: g.weapons.map((w) => {
      const avgHits = w.fires > 0 ? w.hits / w.fires : 0;
      return {
        id: w.def.id,
        lv: w.level.lv,
        branch: w.level.branch,
        fires: w.fires,
        avgHits,
        assumedTargets: w.level.targets,
        lpSheet: lp(w.level),
        lpMeasured: lp(w.level, avgHits),
      };
    }),
  };
}

/** 봇으로 한 판을 끝까지 돌린다 (화면 없음). */
export function runSim(opts: SimOptions): SimReport {
  const st = stage(opts.stageId);
  const g = createGame({
    seed: opts.seed,
    character: character(opts.characterId),
    enemyDefs: ENEMIES,
    stage: st,
    weapons: opts.weapons.map((w) => makeWeapon(weapon(w.id), w.lv, w.branch ?? null)),
  });
  const seconds = opts.seconds ?? st.duration + RULES.stage.wrapUpSeconds;
  const ticks = Math.round(seconds * RULES.tickHz);
  for (let t = 0; t < ticks && (g.phase === "play" || g.phase === "wrapup"); t++) step(g, botInput(g));
  return summarize(g, opts, seconds);
}

export interface Aggregate {
  runs: number;
  deaths: number;
  clearRate: number;
  matchKillRatio: number;
  avgChain: number;
  stallsPerMinute: number;
  pass: { matchKillRatio: boolean; avgChain: boolean; stallsPerMinute: boolean; all: boolean };
}

/** 여러 시드의 평균과 M1 기준 판정 */
export function aggregate(reports: SimReport[]): Aggregate {
  const mean = (f: (r: SimReport) => number): number => reports.reduce((a, r) => a + f(r), 0) / Math.max(1, reports.length);
  const matchKillRatio = mean((r) => r.matchKillRatio);
  const avgChain = mean((r) => r.avgChain);
  const stallsPerMinute = mean((r) => r.stallsPerMinute);
  const pass = {
    matchKillRatio: matchKillRatio >= M1_CRITERIA.matchKillRatio,
    avgChain: avgChain >= M1_CRITERIA.avgChain,
    stallsPerMinute: stallsPerMinute < M1_CRITERIA.stallsPerMinute,
    all: false,
  };
  pass.all = pass.matchKillRatio && pass.avgChain && pass.stallsPerMinute;
  return { runs: reports.length, deaths: reports.filter((r) => r.died).length, clearRate: reports.filter((r) => r.cleared).length / Math.max(1, reports.length), matchKillRatio, avgChain, stallsPerMinute, pass };
}
