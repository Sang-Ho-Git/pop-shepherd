import { RULES } from "../core/rules.ts";
import type { Color, Enemy, Game, MatchColor, SpawnPhase, StageDef } from "../core/types.ts";

/** 적 하나를 만든다. 스테이지 체력 배율을 적용한다. */
/**
 * 출현 구간의 속도 배율을 적 등급에 맞게 깎는다.
 * 보스는 받지 않고, 엘리트는 최대 1.3배. (스테이지 15에서 보스가 55 → 143px/s가 되어 올리(144)를 따라잡던 것)
 */
function specialSpeedMul(rank: string, mul: number): number {
  if (rank === "boss") return 1;
  if (rank === "elite") return Math.min(mul, RULES.boss.eliteSpeedCap);
  return mul;
}

export function spawnEnemy(g: Game, kind: string, color: Color, x: number, y: number): Enemy {
  const def = g.enemyDefs[kind];
  if (!def) throw new Error(`알 수 없는 적: ${kind}`);
  const hpMul = g.stage?.enemyHpMul ?? 1;
  const e: Enemy = {
    id: g.nextId++,
    kind,
    color,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: def.radius,
    mass: def.mass,
    hp: def.hp * hpMul,
    speed: def.speed * specialSpeedMul(def.rank ?? "normal", g.stage ? spawnPhase(g.stage, g.time).speedMul ?? 1 : 1),
    contactDamage: def.contactDamage,
    xp: def.xp,
    state: "walk",
    stunT: 0,
    chainDepth: 0,
    chainT: 0,
    wallBounces: 0,
    fx: null,
    shot: false,
    rank: def.rank ?? "normal",
    trait: def.trait ?? null,
    cause: null,
    wetT: 0,
    maxHp: def.hp * hpMul,
    boss: def.ai
      ? {
          ai: def.ai,
          params: def.params ?? {},
          phase: 1,
          summonT: 0,
          shiftT: 0,
          dashX: 0,
          dashY: 0,
          // 약점 색은 몸 색으로 시작한다 (회색 돌갑옷은 약점 공이 없다: 그로기 때만 맞힌다)
          weak: color === "gray" || color === "rainbow" ? null : color,
          groggy: 0,
          shield: 0,
          atkCd: def.params?.atkFirst ?? def.params?.atkEvery ?? 0,
          atkN: 0,
          dashLeft: 0,
          dashDmg: 0,
          shieldT: 0,
          shields: 0,
        }
      : null,
    dead: false,
  };
  g.enemies.push(e);
  g.stats.spawned++;
  return e;
}

/** 필드에 살아 있는 색별 수 */
export function countColors(g: Game): Map<Color, number> {
  const m = new Map<Color, number>();
  for (const e of g.enemies) if (!e.dead) m.set(e.color, (m.get(e.color) ?? 0) + 1);
  return m;
}

/**
 * 1.7 출현 보정: 1~2마리만 남아 짝이 안 맞는 색은 가중치 orphanWeight, 나머지는 1.
 * 그래서 혼자 남은 색에 짝이 빨리 온다.
 */
export function colorWeights(colors: readonly MatchColor[], counts: Map<Color, number>): number[] {
  return colors.map((c) => {
    const n = counts.get(c) ?? 0;
    return n === 1 || n === 2 ? RULES.spawn.orphanWeight : 1;
  });
}

/** 현재 시간의 출현표 구간. 표 밖이면 마지막 구간. */
export function spawnPhase(stage: StageDef, time: number): SpawnPhase {
  for (const p of stage.spawn) if (time >= p.from && time < p.to) return p;
  const last = stage.spawn[stage.spawn.length - 1];
  if (!last) throw new Error(`${stage.id}: 출현표가 비어 있음`);
  return last;
}

/** 현재 시간의 소환 간격 */
export function spawnInterval(stage: StageDef, time: number): number {
  return spawnPhase(stage, time).interval;
}

/** 현재 시간에 나오는 색 */
export function spawnColors(stage: StageDef, time: number): MatchColor[] {
  return spawnPhase(stage, time).colors ?? stage.colors;
}

/** (x, y)가 플레이어 화면 밖인지 (화면 가장자리에서 margin만큼 더 바깥) */
export function offScreen(g: Game, x: number, y: number, margin: number): boolean {
  return Math.abs(x - g.player.x) > g.view.w / 2 + margin || Math.abs(y - g.player.y) > g.view.h / 2 + margin;
}

/**
 * 소환 지점: 플레이어 기준 760~860px 고리 위에서, 아레나 안이면서 화면 밖인 곳.
 * 고리 위 점을 아레나 안으로 당기기만 하면 플레이어가 벽 근처일 때 화면 안(심하면 바로 옆)에 나타난다
 * (야간 점검: 소환의 20%가 화면 안). 고리에서 못 찾으면 아레나 안 화면 밖의 아무 곳.
 */
/** 바위 안(여유 50px)인지 */
function inRock(g: Game, x: number, y: number): boolean {
  return (g.stage?.rocks ?? []).some((r) => Math.hypot(x - r.x, y - r.y) < r.r + 50);
}

export function spawnPoint(g: Game): { x: number; y: number } {
  const { ringMin, ringMax, edgeMargin, waveRadius } = RULES.spawn;
  const lo = edgeMargin;
  const hiX = g.arena.w - edgeMargin;
  const hiY = g.arena.h - edgeMargin;
  const margin = waveRadius + 30;
  for (let i = 0; i < 16; i++) {
    const a = g.rng.range(0, Math.PI * 2);
    const d = g.rng.range(ringMin, ringMax);
    const x = g.player.x + Math.cos(a) * d;
    const y = g.player.y + Math.sin(a) * d;
    if (x >= lo && x <= hiX && y >= lo && y <= hiY && offScreen(g, x, y, margin)) return { x, y };
  }
  for (let i = 0; i < 32; i++) {
    const x = g.rng.range(lo, hiX);
    const y = g.rng.range(lo, hiY);
    if (offScreen(g, x, y, margin) && !inRock(g, x, y)) return { x, y };
  }
  // 아레나가 화면보다 작은 경우뿐이다: 플레이어에게서 가장 먼 모서리.
  return { x: g.player.x < g.arena.w / 2 ? hiX : lo, y: g.player.y < g.arena.h / 2 ? hiY : lo };
}

/**
 * 웨이브 하나: 짝(같은 색 2마리) 2~3개를 한 지점 둘레에 소환한다.
 * - 짝의 색은 출현 보정 가중치로 고르되, 바로 앞 짝과 같은 색은 피한다 (색이 하나뿐인 스테이지 제외).
 * - 짝끼리는 서로 떨어뜨려 놓는다. 그래서 웨이브 자체는 매치 대상이 아니고, 세 번째를 데려와야 터진다.
 * - 짝마다 grayRatio 확률로 회색 1마리로 바뀐다.
 */
export function spawnGroup(g: Game, stage: StageDef): void {
  let alive = g.enemies.reduce((n, e) => n + (e.dead ? 0 : 1), 0);
  if (alive >= stage.maxAlive) return;
  const at = spawnPoint(g);
  const [lo = RULES.spawn.pairsMin, hi = RULES.spawn.pairsMax] = stage.pairs ?? [];
  const pairs = g.rng.int(lo, hi);
  const base = g.rng.range(0, Math.PI * 2);
  const colors = spawnColors(stage, g.time);
  let prev: MatchColor | null = null;
  for (let k = 0; k < pairs && alive < stage.maxAlive; k++) {
    const ang = base + (k / pairs) * Math.PI * 2;
    const px = at.x + Math.cos(ang) * RULES.spawn.waveRadius;
    const py = at.y + Math.sin(ang) * RULES.spawn.waveRadius;
    if (g.rng.chance(stage.grayRatio)) {
      spawnEnemy(g, "gray", "gray", px, py);
      alive++;
      continue;
    }
    const counts = countColors(g);
    const choices = colors.length > 1 ? colors.filter((c) => c !== prev) : colors;
    const color = g.rng.weighted(choices, colorWeights(choices, counts));
    prev = color;
    // 짝의 종류: 젤리(가중치 1)와 스테이지 mix의 기믹 적. 짝 둘은 같은 종류다.
    const kinds = ["jelly", ...Object.keys(stage.mix ?? {})];
    const kind = kinds.length > 1 ? g.rng.weighted(kinds, kinds.map((k) => (k === "jelly" ? 1 : (stage.mix?.[k] ?? 0)))) : "jelly";
    // 짝은 서로 닿게 (중심 거리 28) 접선 방향으로 나란히
    const tx = -Math.sin(ang) * 14;
    const ty = Math.cos(ang) * 14;
    let group: number | undefined;
    for (let m = 0; m < RULES.spawn.pairSize && alive < stage.maxAlive; m++) {
      const s = m === 0 ? -1 : 1;
      const e = spawnEnemy(g, kind, color, px + tx * s, py + ty * s);
      group ??= e.id;
      e.groupId = group;
      alive++;
    }
    // 무지개 잉크: 짝 옆에 어떤 색과도 이어지는 무지개 젤리 (짝과 닿지 않게 바깥쪽)
    if (g.player.stats.rainbow > 0 && alive < stage.maxAlive && g.rng.chance(g.player.stats.rainbow)) {
      spawnEnemy(g, "jelly", "rainbow", px + Math.cos(ang) * 40, py + Math.sin(ang) * 40);
      alive++;
    }
  }
}

/** 스테이지 출현표에 따라 매 틱 소환 타이머를 진행한다. */
/**
 * 생존형은 duration까지 소환한다. 처치형(보스·엘리트)은 목표를 다 쓰러뜨릴 때까지 마지막 구간으로 계속 소환한다.
 * 보스가 살아 있는 동안은 간격 2배 (기획: 일반 출현 절반).
 */
export function tickSpawner(g: Game, dt: number): void {
  const stage = g.stage;
  if (!stage || g.phase !== "play") return;
  if ((stage.clear ?? "survive") === "survive" && g.time >= stage.duration) return;
  g.spawnTimer -= dt;
  const bossAlive = g.enemies.some((e) => e.rank === "boss" && !e.dead);
  while (g.spawnTimer <= 0) {
    spawnGroup(g, stage);
    g.spawnTimer += spawnInterval(stage, g.time) * (bossAlive ? RULES.boss.spawnSlowdown : 1);
  }
}
