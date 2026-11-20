import { RULES } from "../core/rules.ts";
import type { Color, Enemy, Game, MatchColor, SpawnPhase, StageDef } from "../core/types.ts";

/** 적 하나를 만든다. 스테이지 체력 배율을 적용한다. */
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
    speed: def.speed,
    contactDamage: def.contactDamage,
    xp: def.xp,
    state: "walk",
    stunT: 0,
    chainDepth: 0,
    chainT: 0,
    wallBounces: 0,
    shot: false,
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
  return Math.abs(x - g.player.x) > RULES.view.w / 2 + margin || Math.abs(y - g.player.y) > RULES.view.h / 2 + margin;
}

/**
 * 소환 지점: 플레이어 기준 760~860px 고리 위에서, 아레나 안이면서 화면 밖인 곳.
 * 고리 위 점을 아레나 안으로 당기기만 하면 플레이어가 벽 근처일 때 화면 안(심하면 바로 옆)에 나타난다
 * (야간 점검: 소환의 20%가 화면 안). 고리에서 못 찾으면 아레나 안 화면 밖의 아무 곳.
 */
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
    if (offScreen(g, x, y, margin)) return { x, y };
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
  const pairs = g.rng.int(RULES.spawn.pairsMin, RULES.spawn.pairsMax);
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
    // 짝은 서로 닿게 (중심 거리 28) 접선 방향으로 나란히
    const tx = -Math.sin(ang) * 14;
    const ty = Math.cos(ang) * 14;
    for (let m = 0; m < RULES.spawn.pairSize && alive < stage.maxAlive; m++) {
      const s = m === 0 ? -1 : 1;
      spawnEnemy(g, "jelly", color, px + tx * s, py + ty * s);
      alive++;
    }
  }
}

/** 스테이지 출현표에 따라 매 틱 소환 타이머를 진행한다. */
export function tickSpawner(g: Game, dt: number): void {
  const stage = g.stage;
  if (!stage || g.time >= stage.duration) return;
  g.spawnTimer -= dt;
  while (g.spawnTimer <= 0) {
    spawnGroup(g, stage);
    g.spawnTimer += spawnInterval(stage, g.time);
  }
}
