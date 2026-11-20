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

/** 마무리 시간에는 팝 경험치 보너스 */
function phaseXpMul(g: Game): number {
  return g.phase === "wrapup" ? 1 + RULES.stage.wrapUpXpBonus : 1;
}

function recordPop(g: Game, size: number, depth: number): void {
  const s = g.stats;
  if (g.phase === "wrapup") s.wrapUpPopped += size;
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
/** 팝 충격파 반경 배율 (도미노 진화를 들고 있으면 2배) */
export function popShockMul(g: Game): number {
  return g.weapons.some((w) => w.level.params.domino) ? 2 : 1;
}

export interface PopOptions {
  /** 팝 충격파를 일으키는지 (기본 true). 토템 압축 팝은 완성 전까지 false */
  shock?: boolean;
}

export function popCluster(g: Game, indices: number[], trigger: Enemy, color: MatchColor, opts: PopOptions = {}): void {
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
  xp *= chainMultiplier(depth) * phaseXpMul(g);
  const cushion = trigger.wallBounces > 0;
  const master = cushion && g.player.trait === "three_cushion";
  if (master) xp *= 1 + RULES.threeCushion.xpBonus;
  g.stats.xp += xp;
  recordPop(g, n, depth);
  g.events.push({ type: "pop", ids, size: n, color, chainDepth: depth, xp, cushion, x: cx, y: cy });

  if (n >= RULES.match.shockwaveMin && opts.shock !== false) {
    const radius = popShockRadius(n) * g.player.stats.chain_radius * (master ? 1 + RULES.threeCushion.shockBonus : 1) * popShockMul(g);
    shockwave(g, cx, cy, radius, RULES.match.shockKnock, { chainDepth: depth + 1, chainT: RULES.chain.window });
  }
  if (depth >= RULES.heal.minChainDepth && g.rng.chance(RULES.heal.dropChance * (1 + g.player.stats.heal_find))) {
    g.milks.push({ x: cx, y: cy, t: RULES.heal.lifetime });
    g.stats.milkDrops++;
    g.events.push({ type: "milk-drop", x: cx, y: cy });
  }
  if (n >= RULES.match.bombMin && g.stats.bombDrops < RULES.match.bombMaxPerStage) {
    const m = RULES.match;
    const p = (n >= 6 ? m.bombChance6 : m.bombChance5) * (depth >= 2 ? m.bombChainMul : 1) * (1 + g.player.stats.luck);
    if (g.rng.chance(p)) dropBomb(g, cx, cy, color);
  }
}

function dropBomb(g: Game, cx: number, cy: number, color: MatchColor): void {
  g.stats.bombDrops++;
  g.bombs.push({ x: cx, y: cy, color });
  g.events.push({ type: "bomb-drop", color, x: cx, y: cy });
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

/** 색 폭탄: 주운 자리 기준 화면(1280×720) 안의 그 색 적을 전부 터뜨린다. 한 번의 팝으로 세고, 충격파와 새 폭탄은 없다. */
export function detonateBomb(g: Game, color: MatchColor, x = g.player.x, y = g.player.y): number {
  const hw = RULES.view.w / 2;
  const hh = RULES.view.h / 2;
  let xp = 0;
  let count = 0;
  const ids: number[] = [];
  let cx = 0;
  let cy = 0;
  for (const e of g.enemies) {
    if (e.dead || e.color !== color) continue;
    if (Math.abs(e.x - x) > hw || Math.abs(e.y - y) > hh) continue;
    e.dead = true;
    xp += e.xp;
    cx += e.x;
    cy += e.y;
    ids.push(e.id);
    count++;
  }
  g.events.push({ type: "bomb-pickup", color, count });
  if (count === 0) return 0;
  xp *= phaseXpMul(g);
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
