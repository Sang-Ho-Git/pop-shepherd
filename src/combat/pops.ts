import { RULES } from "../core/rules.ts";
import type { Color, Enemy, Game, MatchColor } from "../core/types.ts";
import { launch, MAX_ENEMY_RADIUS } from "../world/physics.ts";
import { SHOP } from "../data/index.ts";
import { specialDamageMul } from "./bosses.ts";

/** 연쇄 단계 depth의 경험치 배율 */
export function chainMultiplier(depth: number): number {
  // 상한: 깊은 연쇄가 끝없이 이어지면 배율이 1.5^30 넘게 커져 레벨이 몇 초 만에 600을 넘었다 (11/23 밤 실시간 점검)
  return Math.pow(RULES.chain.xpPerStep, Math.min(depth, RULES.chain.maxDepth));
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
  /** 이 팝을 일으킨 쪽 (없으면 trigger.cause) */
  by?: string;
  /** 쿠션을 거친 팝으로 친다 (울타리에서 튕긴 색 공) */
  cushion?: boolean;
  /** 색 공이 거친 쿠션 수: 많을수록 경험치·골드 보너스 (RULES.ball.cushionBonus) */
  cushions?: number;
}

export function popCluster(g: Game, indices: number[], trigger: Enemy, color: MatchColor, opts: PopOptions = {}): void {
  const depth = trigger.chainT > 0 ? trigger.chainDepth : 0;
  const by = opts.by ?? trigger.cause ?? "none";
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
  const cushion = trigger.wallBounces > 0 || opts.cushion === true;
  const master = cushion && g.player.trait === "three_cushion";
  if (master) xp *= 1 + RULES.threeCushion.xpBonus;
  const cushions = opts.cushions ?? (cushion ? 1 : 0);
  const cb = RULES.ball.cushionBonus;
  const bonus = opts.cushions ? 1 + (cb[Math.min(opts.cushions, cb.length - 1)] ?? 0) * (1 + (g.player.cushionBonusUp ?? 0)) : 1;
  xp *= bonus;
  if (opts.cushions) {
    g.stats.cushionPops++;
    if (opts.cushions >= 3) g.stats.threeCushions++;
  }
  g.stats.xp += xp;
  dropGold(g, cx, cy, n * SHOP.goldPerPop * (1 + g.player.stats.gold_find) * bonus, n);
  recordPop(g, n, depth);
  g.stats.popsBy[by] = (g.stats.popsBy[by] ?? 0) + n;
  g.events.push({ type: "pop", ids, size: n, color, chainDepth: depth, xp, cushion, cushions, x: cx, y: cy });

  const radius = popShockRadius(n) * g.player.stats.chain_radius * (master ? 1 + RULES.threeCushion.shockBonus : 1) * popShockMul(g);
  // 엘리트·보스는 곁의 팝에 피해를 입는다 (충격파가 없는 압축 팝도 같은 반경으로 친다)
  hitSpecials(g, cx, cy, radius, n, color, depth);
  if (n >= RULES.match.shockwaveMin && opts.shock !== false) {
    shockwave(g, cx, cy, radius, RULES.match.shockKnock, { chainDepth: depth + 1, chainT: RULES.chain.window, by });
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

/**
 * 골드 주머니: 3마리 이상 팝은 그 자리에 주머니를 떨어뜨린다 (걸어가서 줍는다, 20초 뒤 사라짐).
 * 그보다 작은 팝(갈래 완성 효과의 2마리 팝)은 바로 들어온다.
 */
function dropGold(g: Game, x: number, y: number, amount: number, n: number): void {
  if (amount <= 0) return;
  if (n < RULES.match.minSize) {
    g.player.gold += amount;
    return;
  }
  g.golds.push({ x, y, amount, t: RULES.drops.goldLifetime });
  g.stats.goldDropped += amount;
}

/**
 * 곁의 팝이 엘리트·보스에 주는 피해 (기획: 팝 피해).
 * 터진 적 수 × popDamagePerEnemy × 연쇄 배율, 약점 색(몸 색)이면 ×weakMul.
 * 돌갑옷은 앞쪽(플레이어를 보는 쪽) frontHalfDeg 안에서 터진 팝을 frontMul만 받는다 (그로기 중에는 앞뒤가 없다).
 * 그로기면 ×groggyMul, 보호막이 있으면 피해가 없다.
 */
export function hitSpecials(g: Game, cx: number, cy: number, radius: number, n: number, color: Color, depth: number): void {
  for (const e of g.enemies) {
    if (e.dead || e.rank === "normal") continue;
    const dx = cx - e.x;
    const dy = cy - e.y;
    const d = Math.hypot(dx, dy);
    if (d > radius + e.radius) continue;
    // popMul: 보스별 팝 피해 배율 (그로기 없이도 곁의 팝으로 꾸준히 깎이게)
    let dmg = n * RULES.boss.popDamagePerEnemy * chainMultiplier(depth) * (e.boss?.params.popMul ?? 1);
    if (color === e.color) dmg *= RULES.boss.weakMul;
    const prm = e.boss?.params;
    if (prm?.frontHalfDeg !== undefined && d > 1e-9 && !(e.boss!.groggy > 0)) {
      const px = g.player.x - e.x;
      const py = g.player.y - e.y;
      const pl = Math.hypot(px, py);
      const cos = pl > 1e-9 ? (dx * px + dy * py) / (d * pl) : -1;
      if (cos >= Math.cos((prm.frontHalfDeg * Math.PI) / 180)) dmg *= prm.frontMul ?? 1;
    }
    const groggyNow = (e.boss?.groggy ?? 0) > 0;
    dmg *= specialDamageMul(e);
    if (dmg <= 0) continue;
    e.hp -= dmg;
    g.stats.specialDamage += dmg;
    if (e.rank === "boss") {
      if (groggyNow) g.stats.bossDmgGroggy += dmg;
      else g.stats.bossDmgPop += dmg;
    }
    g.stats.specialHits++;
    g.events.push({ type: "special-hit", id: e.id, damage: dmg, hp: e.hp });
    if (e.hp <= 0) killSpecial(g, e);
  }
}

/** 엘리트·보스 처치: 보물 상자를 떨어뜨린다 */
export function killSpecial(g: Game, e: Enemy): void {
  if (e.dead) return;
  e.dead = true;
  e.hp = 0;
  g.stats.xp += e.xp;
  const kind = e.rank === "boss" ? "boss" : "elite";
  if (kind === "boss") {
    g.stats.bossKilled++;
    g.stats.bossKilledAt = g.time;
  } else g.stats.elitesKilled++;
  g.chests.push({ x: e.x, y: e.y, kind });
  g.events.push({ type: "special-killed", id: e.id, kind: e.kind, rank: e.rank });
  g.events.push({ type: "chest-drop", kind, x: e.x, y: e.y });
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
  src: { chainDepth: number; chainT: number; by?: string },
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
    if (src.by) e.cause = src.by;
    hits++;
  }
  return hits;
}

/** 색 폭탄: 주운 자리 기준 화면(1280×720) 안의 그 색 적을 전부 터뜨린다. 한 번의 팝으로 세고, 충격파와 새 폭탄은 없다. */
export function detonateBomb(g: Game, color: MatchColor, x = g.player.x, y = g.player.y): number {
  const hw = g.view.w / 2;
  const hh = g.view.h / 2;
  let xp = 0;
  let count = 0;
  const ids: number[] = [];
  let cx = 0;
  let cy = 0;
  for (const e of g.enemies) {
    if (e.dead || e.color !== color || e.rank !== "normal") continue;
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
  g.stats.popsBy.bomb = (g.stats.popsBy.bomb ?? 0) + count;
  g.events.push({ type: "pop", ids, size: count, color: color as Color, chainDepth: 0, xp, cushion: false, cushions: 0, x: cx / count, y: cy / count });
  return count;
}

/**
 * 1.6 직접 피해. 체력이 0이 되면 처치하고 매치 처치 경험치의 20%를 준다.
 * 직접 피해는 막힘 방지 장치일 뿐, 매치보다 훨씬 손해다.
 */
export function damage(g: Game, e: Enemy, amount: number): void {
  if (e.dead || amount <= 0) return;
  e.hp -= amount * g.player.stats.direct_dmg * (e.rank !== "normal" ? specialDamageMul(e) : 1);
  g.stats.directHits++;
  if (e.hp > 0) return;
  if (e.rank !== "normal") return killSpecial(g, e);
  e.dead = true;
  const xp = e.xp * RULES.antiStall.directKillXpRatio;
  g.stats.xp += xp;
  g.stats.killedEnemies++;
  g.events.push({ type: "kill", id: e.id, xp });
}
