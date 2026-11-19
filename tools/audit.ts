/**
 * 점검 도구: 여러 조합(스테이지 × 캐릭터 × 무기 구성 × 시드)을 봇으로 돌리며
 * 매 틱 불변식을 검사하고, 판마다 지표를 모아 이상 징후를 보고한다.
 *   node tools/audit.ts [--seeds 5] [--only 이름일부] [--json]
 */
import { createGame, step } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { Game } from "../src/core/types.ts";
import { character, ENEMIES, stage, weapon } from "../src/data/index.ts";
import { botInput } from "../src/sim/bot.ts";
import { makeWeapon } from "../src/weapons/weapons.ts";

interface Scenario {
  name: string;
  stageId: string;
  characterId: string;
  weapons: { id: string; lv: number }[];
}

const TRIO = (lv: number) => [
  { id: "shockwave", lv },
  { id: "kick", lv },
  { id: "magnet_totem", lv },
];

export const SCENARIOS: Scenario[] = [
  { name: "스테이지1 · 킥 Lv1 (시작 상태)", stageId: "stage01", characterId: "shepherd", weapons: [{ id: "kick", lv: 1 }] },
  { name: "검증장 · 킥 Lv1 만", stageId: "m1_proving", characterId: "shepherd", weapons: [{ id: "kick", lv: 1 }] },
  { name: "검증장 · 충격파 Lv1 만", stageId: "m1_proving", characterId: "shepherd", weapons: [{ id: "shockwave", lv: 1 }] },
  { name: "검증장 · 토템 Lv1 만", stageId: "m1_proving", characterId: "shepherd", weapons: [{ id: "magnet_totem", lv: 1 }] },
  { name: "검증장 · 세 무기 Lv1", stageId: "m1_proving", characterId: "shepherd", weapons: TRIO(1) },
  { name: "검증장 · 세 무기 Lv3", stageId: "m1_proving", characterId: "shepherd", weapons: TRIO(3) },
  { name: "검증장 · 큐 · 세 무기 Lv3", stageId: "m1_proving", characterId: "cue", weapons: TRIO(3) },
  { name: "검증장 · 올리 · 세 무기 Lv3", stageId: "m1_proving", characterId: "olly", weapons: TRIO(3) },
  { name: "검증장 · 팔레 · 세 무기 Lv3", stageId: "m1_proving", characterId: "pale", weapons: TRIO(3) },
];

export interface Anomalies {
  nonFinite: number;
  outOfArena: number;
  overCap: number;
  deepOverlap: number;
  longFlight: number;
  slowTicks: number;
  maxTickMs: number;
  /** 틱 시간의 99% 지점. 최대값은 JIT·GC로 가끔 튀므로 성능 판단은 이 값으로 한다. */
  p99TickMs: number;
  bombsLeft: number;
}

export interface RunResult {
  seed: number;
  survived: number;
  died: boolean;
  pops: number;
  popped: number;
  killed: number;
  matchKillRatio: number;
  avgChain: number;
  stallsPerMinute: number;
  alivePeak: number;
  hpLeft: number;
  anomalies: Anomalies;
}

function checkTick(g: Game, a: Anomalies, flight: Map<number, number>): void {
  const p = g.player;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.hp)) a.nonFinite++;
  const cap = g.stage?.maxAlive ?? Infinity;
  if (g.enemies.length > cap) a.overCap++;
  for (const e of g.enemies) {
    if (![e.x, e.y, e.vx, e.vy, e.hp].every(Number.isFinite)) a.nonFinite++;
    if (e.x < e.radius - 0.5 || e.y < e.radius - 0.5 || e.x > g.arena.w - e.radius + 0.5 || e.y > g.arena.h - e.radius + 0.5) a.outOfArena++;
    if (e.state === "launched") {
      const t = (flight.get(e.id) ?? 0) + 1;
      flight.set(e.id, t);
      if (t === 5 * RULES.tickHz) a.longFlight++;
    } else flight.delete(e.id);
  }
  // 깊은 겹침: 반지름 합의 절반 이상 겹친 쌍 (표본: 매 30틱)
  if (g.tick % 30 === 0) {
    const es = g.enemies;
    for (let i = 0; i < es.length; i++) {
      const ei = es[i]!;
      for (let j = i + 1; j < es.length; j++) {
        const ej = es[j]!;
        const d = Math.hypot(ei.x - ej.x, ei.y - ej.y);
        if (d < (ei.radius + ej.radius) * 0.5) a.deepOverlap++;
      }
    }
  }
}

export function runOne(sc: Scenario, seed: number): RunResult {
  const st = stage(sc.stageId);
  const g = createGame({
    seed,
    character: character(sc.characterId),
    enemyDefs: ENEMIES,
    stage: st,
    weapons: sc.weapons.map((w) => makeWeapon(weapon(w.id), w.lv)),
  });
  const a: Anomalies = { nonFinite: 0, outOfArena: 0, overCap: 0, deepOverlap: 0, longFlight: 0, slowTicks: 0, maxTickMs: 0, p99TickMs: 0, bombsLeft: 0 };
  const tickMs: number[] = [];
  const flight = new Map<number, number>();
  const ticks = st.duration * RULES.tickHz;
  for (let t = 0; t < ticks && !g.player.dead; t++) {
    const input = botInput(g);
    const t0 = performance.now();
    step(g, input);
    const ms = performance.now() - t0;
    a.maxTickMs = Math.max(a.maxTickMs, ms);
    tickMs.push(ms);
    if (ms > 4) a.slowTicks++;
    checkTick(g, a, flight);
  }
  a.bombsLeft = g.bombs.length;
  tickMs.sort((x, y) => x - y);
  a.p99TickMs = tickMs[Math.floor(tickMs.length * 0.99)] ?? 0;
  const s = g.stats;
  const fin = s.poppedEnemies + s.killedEnemies;
  return {
    seed,
    survived: g.time,
    died: g.player.dead,
    pops: s.pops,
    popped: s.poppedEnemies,
    killed: s.killedEnemies,
    matchKillRatio: fin > 0 ? s.poppedEnemies / fin : 0,
    avgChain: s.rootPops > 0 ? s.pops / s.rootPops : 0,
    stallsPerMinute: g.time > 0 ? s.stalls / (g.time / 60) : 0,
    alivePeak: s.alivePeak,
    hpLeft: g.player.hp / g.player.maxHp,
    anomalies: a,
  };
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(arg("seeds", "5"));
  const only = arg("only", "");
  const out: { scenario: string; runs: RunResult[] }[] = [];
  for (const sc of SCENARIOS) {
    if (only && !sc.name.includes(only)) continue;
    const runs = Array.from({ length: seeds }, (_, i) => runOne(sc, i + 1));
    out.push({ scenario: sc.name, runs });
    if (process.argv.includes("--json")) continue;
    const m = (f: (r: RunResult) => number): number => runs.reduce((x, r) => x + f(r), 0) / runs.length;
    const sum = (k: keyof Anomalies): number => runs.reduce((x, r) => x + r.anomalies[k], 0);
    const flags = (["nonFinite", "outOfArena", "overCap", "deepOverlap", "longFlight", "slowTicks", "bombsLeft"] as const)
      .filter((k) => sum(k) > 0)
      .map((k) => `${k}=${sum(k)}`)
      .join(" ");
    console.log(
      `${sc.name.padEnd(26)} 사망 ${runs.filter((r) => r.died).length}/${seeds}  생존 ${m((r) => r.survived).toFixed(0)}s  남은체력 ${(m((r) => r.hpLeft) * 100).toFixed(0)}%  매치 ${(m((r) => r.matchKillRatio) * 100).toFixed(0)}%  연쇄 ${m((r) => r.avgChain).toFixed(2)}  막힘 ${m((r) => r.stallsPerMinute).toFixed(2)}  최대적 ${m((r) => r.alivePeak).toFixed(0)}  틱99% ${Math.max(...runs.map((r) => r.anomalies.p99TickMs)).toFixed(2)}ms (최대 ${Math.max(...runs.map((r) => r.anomalies.maxTickMs)).toFixed(1)})  ${flags}`,
    );
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
}
