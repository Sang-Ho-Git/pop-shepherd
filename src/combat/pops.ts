import { RULES } from "../core/rules.ts";
import type { Color, Enemy, Game, MatchColor } from "../core/types.ts";
import { launch, MAX_ENEMY_RADIUS } from "../world/physics.ts";

/** 연쇄 단계 depth의 경험치 배율 */
export function chainMultiplier(depth: number): number {
  return Math.pow(RULES.chain.xpPerStep, depth);
}

/** 팝 충격파 반경 (캐릭터 chain_radius 배율 적용 전) */
export function popShockRadius(size: number): number {
  return RULES.match.shockRadiusBase + RULES.match.shockRadiusPerExtra * Math.max(0, size - RULES.match.shockwaveMin);
}

function recordPop(g: Game, size: number, depth: number): void {
  const s = g.stats;
  s.pops++;
  if (depth === 0) s.rootPops++;
  s.poppedEnemies += size;
  s.maxChain = Math.max(s.maxChain, depth + 1);
  s.stallTimer = 0;
}

/**
 * 1.5 무리 팝. trigger는 부딪친(발사된) 적.
 * - 연쇄 단계: trigger의 연쇄 인정 시간이 남아 있으면 그 단계, 아니면 0
 * - 경험치: 합계 × 1.5^단계
 * - 4마리 이상: 무리 중심에서 팝 충격파 (날아간 적은 단계 + 1)
 * - 5마리 이상: 색 폭탄 드롭
 */
export function popCluster(g: Game, indices: number[], trigger: Enemy, color: MatchColor): void {
  const depth = trigger.chainT > 0 ? trigger.chainDepth : 0;
  let xp = 0;
  let cx = 0;
  let cy = 0;
  const ids: number[] = [];
  for (const idx of indices) {
    const e = g.enemies[idx] as Enemy;
    e.dead = true;
    xp += e.xp;
    cx += e.x;
    cy += e.y;
    ids.push(e.id);
  }
  const n = indices.length;
  cx /= n;
  cy /= n;
  xp *= chainMultiplier(depth);
  g.stats.xp += xp;
  recordPop(g, n, depth);
  g.events.push({ type: "pop", ids, size: n, color, chainDepth: depth, xp, cushion: trigger.wallBounces > 0, x: cx, y: cy });

  if (n >= RULES.match.shockwaveMin) {
    const radius = popShockRadius(n) * g.player.stats.chain_radius;
    shockwave(g, cx, cy, radius, RULES.match.shockKnock, { chainDepth: depth + 1, chainT: RULES.chain.window });
  }
  if (n >= RULES.match.bombMin) {
    g.bombs.push({ x: cx, y: cy, color });
    g.events.push({ type: "bomb-drop", color, x: cx, y: cy });
  }
}

/** 중심에서 바깥으로 밀어내는 원형 충격파. 맞은 적 수를 돌려준다. */
export function shockwave(
  g: Game,
  x: number,
  y: number,
  radius: number,
  knock: number,
  src: { chainDepth: number; chainT: number },
): number {
  const buf: number[] = [];
  g.grid.query(x, y, radius + MAX_ENEMY_RADIUS, buf);
  let hits = 0;
  for (const j of buf) {
    const e = g.enemies[j] as Enemy;
    if (e.dead) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const reach = radius + e.radius;
    if (dx * dx + dy * dy > reach * reach) continue;
    launch(e, dx, dy, knock, src);
    hits++;
  }
  return hits;
}

/** 색 폭탄: 주운 자리에서 bombRadius 안의 그 색 적을 전부 터뜨린다. 한 번의 팝으로 세고, 충격파와 새 폭탄은 없다. */
export function detonateBomb(g: Game, color: MatchColor, x = g.player.x, y = g.player.y): number {
  const range = RULES.match.bombRadius;
  let xp = 0;
  let count = 0;
  const ids: number[] = [];
  let cx = 0;
  let cy = 0;
  for (const e of g.enemies) {
    if (e.dead || e.color !== color) continue;
    if (Math.hypot(e.x - x, e.y - y) > range) continue;
    e.dead = true;
    xp += e.xp;
    cx += e.x;
    cy += e.y;
    ids.push(e.id);
    count++;
  }
  g.events.push({ type: "bomb-pickup", color, count });
  if (count === 0) return 0;
  g.stats.xp += xp;
  recordPop(g, count, 0);
  g.stats.bombPops++;
  g.events.push({ type: "pop", ids, size: count, color: color as Color, chainDepth: 0, xp, cushion: false, x: cx / count, y: cy / count });
  return count;
}

/**
 * 1.6 직접 피해. 체력이 0이 되면 처치하고 매치 처치 경험치의 20%를 준다.
 * 직접 피해는 막힘 방지 장치일 뿐, 매치보다 훨씬 손해다.
 */
export function damage(g: Game, e: Enemy, amount: number): void {
  if (e.dead || amount <= 0) return;
  e.hp -= amount * g.player.stats.direct_dmg;
  g.stats.directHits++;
  if (e.hp > 0) return;
  e.dead = true;
  const xp = e.xp * RULES.antiStall.directKillXpRatio;
  g.stats.xp += xp;
  g.stats.killedEnemies++;
  g.events.push({ type: "kill", id: e.id, xp });
}
