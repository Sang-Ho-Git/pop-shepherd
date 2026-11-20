import { DT, RULES } from "../core/rules.ts";
import { MATCH_COLORS } from "../core/types.ts";
import type { Enemy, Game, MatchColor, WeaponDef, WeaponInstance, WeaponLevel } from "../core/types.ts";
import { damage } from "../combat/pops.ts";
import { launch, MAX_ENEMY_RADIUS, WEAPON_LAUNCH } from "../world/physics.ts";

/** 무기 정의에서 레벨 한 줄을 찾는다. Lv1~3은 branch 없음, Lv4~7은 "A"/"B". */
export function weaponLevel(def: WeaponDef, lv: number | "evo", branch: string | null = null): WeaponLevel {
  const row = def.levels.find((l) => l.lv === lv && (typeof lv === "number" && lv <= 3 ? true : l.branch === branch));
  if (!row) throw new Error(`${def.id}: Lv${lv}${branch ?? ""} 없음`);
  return row;
}

/** 지금 시뮬이 동작까지 구현한 레벨. Lv4 이후 분기 효과(부채꼴, 이중파, 관통 등)는 M2에서 붙인다. */
export const MAX_IMPLEMENTED_LEVEL = 3;

export function makeWeapon(def: WeaponDef, lv: number | "evo", branch: string | null = null): WeaponInstance {
  if (!def.implemented) throw new Error(`${def.id}: 동작 모듈(${def.behavior})이 아직 없음`);
  if (lv === "evo" || lv > MAX_IMPLEMENTED_LEVEL) {
    throw new Error(`${def.id}: Lv${lv} 분기·진화 효과는 아직 구현되지 않음 (Lv1~${MAX_IMPLEMENTED_LEVEL}만 가능)`);
  }
  return { def, level: weaponLevel(def, lv, branch), cd: 0, fires: 0, hits: 0 };
}

function param(level: WeaponLevel, key: string, fallback?: number): number {
  const v = level.params[key] ?? fallback;
  if (v === undefined) throw new Error(`무기 파라미터 ${key} 없음`);
  return v;
}

/** 캐릭터 보정이 들어간 쿨다운 */
function cooldownOf(g: Game, level: WeaponLevel): number {
  return level.cooldown * (1 - g.player.stats.cooldown);
}

function knockOf(g: Game, level: WeaponLevel): number {
  return level.knock * g.player.stats.knock_power;
}

/** (x, y)에서 radius 안의 살아 있는 적 (반지름 포함) */
function enemiesWithin(g: Game, x: number, y: number, radius: number, buf: number[]): Enemy[] {
  g.grid.query(x, y, radius + MAX_ENEMY_RADIUS, buf);
  const out: Enemy[] = [];
  for (const j of buf) {
    const e = g.enemies[j] as Enemy;
    if (e.dead) continue;
    const reach = radius + e.radius;
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy <= reach * reach) out.push(e);
  }
  out.sort((p, q) => p.id - q.id);
  return out;
}

/** pulse (충격파): 주변 적을 사방으로 밀어낸다. 범위 안에 적이 있을 때만 쏜다. */
/** 방금 쏜 무기가 맞힌 적 id (발사 이벤트에 실어 분석에 쓴다) */
let firedIds: number[] = [];

function firePulse(g: Game, w: WeaponInstance, buf: number[]): number {
  const p = g.player;
  const radius = param(w.level, "radius") * p.stats.area;
  const targets = enemiesWithin(g, p.x, p.y, radius, buf);
  if (targets.length === 0 || targets.length < param(w.level, "minTargets", 1)) return -1;
  const knock = knockOf(g, w.level);
  for (const e of targets) {
    launch(e, e.x - p.x, e.y - p.y, knock, WEAPON_LAUNCH);
    damage(g, e, w.level.damage);
  }
  firedIds = targets.map((e) => e.id);
  return targets.length;
}

/**
 * directional (킥): 이동 방향 부채꼴 안의 가장 가까운 적을 이동 방향으로 정확히 날린다.
 * 대상이 없으면 쏘지 않고 기다린다.
 */
function fireDirectional(g: Game, w: WeaponInstance, buf: number[]): number {
  const p = g.player;
  const range = param(w.level, "range");
  const cone = Math.cos((param(w.level, "coneDeg", 40) * Math.PI) / 180);
  const maxTargets = param(w.level, "maxTargets", 1);
  const candidates = enemiesWithin(g, p.x, p.y, p.radius + range, buf)
    .map((e) => {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      return { e, d, cos: d > 1e-9 ? (dx * p.faceX + dy * p.faceY) / d : 1 };
    })
    .filter((c) => c.cos >= cone)
    .sort((a, b) => a.d - b.d || a.e.id - b.e.id)
    .slice(0, maxTargets);
  if (candidates.length === 0) return -1;
  const knock = knockOf(g, w.level);
  for (const c of candidates) {
    launch(c.e, p.faceX, p.faceY, knock, WEAPON_LAUNCH);
    damage(g, c.e, w.level.damage);
  }
  firedIds = candidates.map((c) => c.e.id);
  return candidates.length;
}

/** 범위 안에서 가장 많은 매치 색 (동률이면 MATCH_COLORS 순서) */
export function dominantColor(enemies: Enemy[]): { color: MatchColor; count: number } | null {
  let best: { color: MatchColor; count: number } | null = null;
  for (const c of MATCH_COLORS) {
    const n = enemies.filter((e) => e.color === c).length;
    if (n > 0 && (!best || n > best.count)) best = { color: c, count: n };
  }
  return best;
}

/**
 * zone (자석 토템): 플레이어 자리에 토템을 세우고, 범위 안에서 가장 많은 색 하나를 지속 시간 동안 끌어모은다.
 * 그 색이 2마리 이상 있을 때만 세운다.
 */
function fireZone(g: Game, w: WeaponInstance, buf: number[]): number {
  const p = g.player;
  const radius = param(w.level, "radius") * p.stats.area;
  const inRange = enemiesWithin(g, p.x, p.y, radius, buf);
  const dom = dominantColor(inRange);
  if (!dom || dom.count < Math.max(2, param(w.level, "minTargets", 2))) return -1;
  const pulled = new Set<number>();
  for (const e of inRange) if (e.color === dom.color) pulled.add(e.id);
  g.totems.push({ x: p.x, y: p.y, radius, color: dom.color, t: param(w.level, "duration"), pullSpeed: param(w.level, "pullSpeed", 110), pulled, weapon: w });
  for (const e of inRange) if (e.color === dom.color) damage(g, e, w.level.damage);
  // 타격 수 = 지속 시간 동안 끌어온 서로 다른 적 수. 세운 순간의 수만 먼저 세고, 나머지는 tickTotems가 더한다.
  firedIds = inRange.filter((e) => e.color === dom.color).map((e) => e.id);
  return dom.count;
}

/** 같은 색 적끼리 붙어 있는지 보는 여유 (반지름 합 + 이 값) */
const TOUCH_SLACK = 30;

function sameColorCluster(enemies: Enemy[], b: Enemy): number {
  let n = 0;
  for (const e of enemies) {
    if (e.color !== b.color) continue;
    const reach = e.radius + b.radius + TOUCH_SLACK;
    const dx = e.x - b.x;
    const dy = e.y - b.y;
    if (dx * dx + dy * dy <= reach * reach) n++;
  }
  return n;
}

/** 감속 뒤 arrive 속도로 도착하도록 하는 출발 속도 (비행 거리 = (v0 - v) / damping) */
function speedToArrive(dist: number, arrive: number): number {
  return RULES.physics.damping * Math.max(0, dist) + arrive;
}

/** 올가미가 끌어온 적이 짝에 닿을 때의 속도. 충돌 매치 기준(60px/s)보다 넉넉하게. */
export const LASSO_ARRIVE_SPEED = 220;

/**
 * pull (올가미): 사거리 안의 적 하나를 같은 색 짝에게 끌어다 부딪힌다.
 * 짝은 이미 같은 색이 많이 붙어 있는 쪽을 고르고 (3매치를 만들기 쉬운 쪽), 같으면 가까운 쪽.
 * Lv3부터 같은 색을 maxTargets마리까지 같은 짝에게 끌어온다. 짝이 없으면 쏘지 않는다.
 */
function firePull(g: Game, w: WeaponInstance, buf: number[]): number {
  const p = g.player;
  const range = param(w.level, "range");
  const maxTargets = param(w.level, "maxTargets", 1);
  const inRange = enemiesWithin(g, p.x, p.y, range, buf).filter((e) => e.state === "walk" && e.color !== "gray" && e.color !== "rainbow");
  let best: { t: Enemy; b: Enemy; cluster: number; d: number } | null = null;
  for (const t of inRange) {
    for (const b of inRange) {
      if (b === t || b.color !== t.color) continue;
      const d = Math.hypot(b.x - t.x, b.y - t.y) - t.radius - b.radius;
      if (d < TOUCH_SLACK) continue;
      const cluster = sameColorCluster(inRange, b);
      if (!best || cluster > best.cluster || (cluster === best.cluster && d < best.d)) best = { t, b, cluster, d };
    }
  }
  if (!best) return -1;
  const { b } = best;
  const pulled = inRange
    .filter((e) => e !== b && e.color === b.color && Math.hypot(b.x - e.x, b.y - e.y) - e.radius - b.radius >= TOUCH_SLACK)
    .sort((x, y) => Math.hypot(b.x - x.x, b.y - x.y) - Math.hypot(b.x - y.x, b.y - y.y) || x.id - y.id);
  // 가장 좋은 대상은 꼭 넣고, 나머지는 짝에 가까운 순서
  const targets = [best.t, ...pulled.filter((e) => e !== best.t)].slice(0, maxTargets);
  for (const e of targets) {
    const d = Math.hypot(b.x - e.x, b.y - e.y) - e.radius - b.radius;
    const v = Math.min(w.level.support, speedToArrive(d, LASSO_ARRIVE_SPEED));
    launch(e, b.x - e.x, b.y - e.y, v * e.mass, WEAPON_LAUNCH);
    damage(g, e, w.level.damage);
  }
  firedIds = targets.map((e) => e.id);
  return targets.length;
}

/** 페인트 총 사거리 (데이터에 없으면) */
export const PAINT_RANGE = 380;

/**
 * projectile (페인트 총): 사거리 안에서 색을 바꾸면 매치가 가장 크게 되는 적을 골라,
 * 옆 무리의 색으로 칠하고 그 무리 쪽으로 살짝 밀어 부딪힌다 (지금은 즉시 명중으로 계산한다).
 * 탄 수만큼 서로 다른 적을 맞힌다. 칠해서 짝이 생기는 적이 없으면 쏘지 않는다.
 */
function fireProjectile(g: Game, w: WeaponInstance, buf: number[]): number {
  const p = g.player;
  const range = param(w.level, "range", PAINT_RANGE);
  const shots = param(w.level, "projectiles", 1);
  const inRange = enemiesWithin(g, p.x, p.y, range, buf).filter((e) => e.state === "walk");
  const options: { e: Enemy; color: MatchColor; n: number; cx: number; cy: number; d: number }[] = [];
  for (const e of inRange) {
    if (e.color === "rainbow") continue;
    let bestC: { color: MatchColor; n: number; cx: number; cy: number } | null = null;
    for (const c of MATCH_COLORS) {
      if (c === e.color) continue;
      let n = 0;
      let cx = 0;
      let cy = 0;
      for (const o of inRange) {
        if (o === e || o.color !== c) continue;
        const reach = e.radius + o.radius + TOUCH_SLACK;
        const dx = o.x - e.x;
        const dy = o.y - e.y;
        if (dx * dx + dy * dy > reach * reach) continue;
        n++;
        cx += o.x;
        cy += o.y;
      }
      if (n > 0 && (!bestC || n > bestC.n)) bestC = { color: c, n, cx: cx / n, cy: cy / n };
    }
    if (bestC) options.push({ e, ...bestC, d: Math.hypot(e.x - p.x, e.y - p.y) });
  }
  if (options.length === 0) return -1;
  options.sort((a, b) => b.n - a.n || a.d - b.d || a.e.id - b.e.id);
  const targets = options.slice(0, shots);
  const knock = knockOf(g, w.level);
  for (const o of targets) {
    o.e.color = o.color;
    launch(o.e, o.cx - o.e.x, o.cy - o.e.y, knock, WEAPON_LAUNCH);
    damage(g, o.e, w.level.damage);
  }
  firedIds = targets.map((o) => o.e.id);
  return targets.length;
}

/** 쿨다운이 끝난 무기를 쏜다. 쏠 대상이 없으면 쿨다운 0에서 기다린다. */
export function fireWeapons(g: Game): void {
  const buf: number[] = [];
  for (const w of g.weapons) {
    w.cd = Math.max(0, w.cd - DT);
    if (w.cd > 0) continue;
    let hits: number;
    switch (w.def.behavior) {
      case "pulse":
        hits = firePulse(g, w, buf);
        break;
      case "directional":
        hits = fireDirectional(g, w, buf);
        break;
      case "zone":
        hits = fireZone(g, w, buf);
        break;
      case "pull":
        hits = firePull(g, w, buf);
        break;
      case "projectile":
        hits = fireProjectile(g, w, buf);
        break;
      default:
        throw new Error(`${w.def.id}: 동작 모듈(${w.def.behavior})이 아직 없음`);
    }
    if (hits < 0) continue;
    w.cd = cooldownOf(g, w.level);
    w.fires++;
    w.hits += hits;
    g.events.push({ type: "fire", weapon: w.def.id, hits, ids: firedIds });
  }
}

/**
 * 토템 지속: 대상 색의 평소 상태 적을 토템 중심으로 끌어당긴다 (추적 AI보다 우선).
 * 공간 해시를 다시 채우기 전에 돌기 때문에 적 목록을 직접 훑는다 (토템은 몇 개뿐이다).
 */
export function tickTotems(g: Game): void {
  for (const t of g.totems) {
    t.t -= DT;
    const inRange = [];
    for (const e of g.enemies) {
      if (e.dead || e.state !== "walk" || e.color !== t.color) continue;
      const dx = t.x - e.x;
      const dy = t.y - e.y;
      const reach = t.radius + e.radius;
      if (dx * dx + dy * dy <= reach * reach) inRange.push(e);
    }
    // 끌려온 적이 쌓이는 더미의 반경 (원 n개를 빽빽하게 쌓은 크기). 더미 안에 든 적은 더 끌지 않는다.
    // 이게 없으면 끄는 속도가 겹침 해소를 이겨 적이 한 점으로 압축된다 (야간 점검에서 발견).
    const pile = Math.max(18, 14 * Math.sqrt(inRange.length / 0.85));
    for (const e of inRange) {
      const dx = t.x - e.x;
      const dy = t.y - e.y;
      const d = Math.hypot(dx, dy);
      if (!t.pulled.has(e.id)) {
        t.pulled.add(e.id);
        if (t.weapon) t.weapon.hits++;
      }
      if (d < pile) {
        e.vx = 0;
        e.vy = 0;
      } else {
        e.vx = (dx / d) * t.pullSpeed;
        e.vy = (dy / d) * t.pullSpeed;
      }
    }
  }
  g.totems = g.totems.filter((t) => t.t > 0);
}
