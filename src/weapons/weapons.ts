import { DT, RULES } from "../core/rules.ts";
import { MATCH_COLORS } from "../core/types.ts";
import type { Enemy, Game, LaunchFx, MatchColor, WeaponDef, WeaponInstance, WeaponLevel } from "../core/types.ts";
import { damage, popCluster, shockwave } from "../combat/pops.ts";
import { launch, MAX_ENEMY_RADIUS, WEAPON_LAUNCH } from "../world/physics.ts";

/**
 * 무기 정의에서 레벨 한 줄을 찾는다. Lv1~3은 branch 없음, Lv4~7은 "A"/"B".
 * 진화는 갈래를 유지한다 (기획: 진화해도 고른 갈래의 Lv7 완성 효과를 그대로 가진다, 최종 14형태).
 * 그래서 갈래를 주면 진화 줄의 수치에 그 갈래 Lv7의 동작 파라미터를 깔고 진화 파라미터를 덮어쓴다.
 */
export function weaponLevel(def: WeaponDef, lv: number | "evo", branch: string | null = null): WeaponLevel {
  if (lv === "evo") {
    const evo = def.levels.find((l) => l.lv === "evo");
    if (!evo) throw new Error(`${def.id}: 진화 없음`);
    if (branch === null) return evo;
    const top = weaponLevel(def, MAX_LEVEL, branch);
    return { ...evo, branch, params: { ...top.params, ...evo.params } };
  }
  const row = def.levels.find((l) => l.lv === lv && (lv <= 3 ? true : l.branch === branch));
  if (!row) throw new Error(`${def.id}: Lv${lv}${branch ?? ""} 없음`);
  return row;
}

/** 무기 최고 레벨 (그다음은 진화). Lv4에서 갈래 A/B를 고른다. */
export const MAX_LEVEL = 7;
export const BRANCH_LEVEL = 4;

export function makeWeapon(def: WeaponDef, lv: number | "evo", branch: string | null = null): WeaponInstance {
  if (!def.implemented) throw new Error(`${def.id}: 동작 모듈(${def.behavior})이 아직 없음`);
  if (typeof lv === "number" && lv >= BRANCH_LEVEL && branch === null) throw new Error(`${def.id}: Lv${lv}은 갈래(A/B)가 필요함`);
  return { def, level: weaponLevel(def, lv, branch), cd: 0, fires: 0, hits: 0 };
}

/** 같은 레벨 줄의 갈래 효과 (없으면 null) */
function launchFx(level: WeaponLevel): LaunchFx | null {
  const p = level.params;
  const fx: LaunchFx = {};
  if (p.stunOnImpact) fx.stunOnHit = p.stunOnImpact;
  if (p.landingShockRadius) fx.landShock = p.landingShockRadius;
  if (p.flightMul) fx.dampMul = 1 / p.flightMul;
  if (p.pierce && level.knock > 0) fx.pierce = p.pierce;
  return Object.keys(fx).length > 0 ? fx : null;
}

/** 이 무기 발사의 LaunchSource (발사마다 새 효과 객체: 관통 횟수가 적마다 따로 줄어야 한다) */
function src(level: WeaponLevel) {
  return { ...WEAPON_LAUNCH, fx: launchFx(level) };
}

/** 같은 색이 서로 닿아 이어진 무리 (목록 안에서만, 반지름 합 + slack) */
function touchingGroup(list: Enemy[], seed: Enemy[], slack: number): Enemy[] {
  const out = [...seed];
  const seen = new Set(out);
  for (let k = 0; k < out.length; k++) {
    const a = out[k] as Enemy;
    for (const b of list) {
      if (seen.has(b) || b.dead || b.color !== a.color) continue;
      const reach = a.radius + b.radius + slack;
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= reach * reach) {
        seen.add(b);
        out.push(b);
      }
    }
  }
  return out;
}

/** 적 목록을 그 자리에서 바로 터뜨린다 (갈래 완성 효과: 즉시 팝). 2마리 이상이어야 한다. */
function popNow(g: Game, group: Enemy[], trigger: Enemy, opts: { shock?: boolean } = {}): boolean {
  const live = group.filter((e) => !e.dead);
  if (live.length < 2 || trigger.color === "gray" || trigger.color === "rainbow") return false;
  popCluster(g, live.map((e) => g.enemies.indexOf(e)), trigger, trigger.color as MatchColor, opts);
  return true;
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

function inCone(g: Game, e: Enemy, coneDeg: number | null): boolean {
  if (coneDeg === null) return true;
  const p = g.player;
  const dx = e.x - p.x;
  const dy = e.y - p.y;
  const d = Math.hypot(dx, dy);
  return d < 1e-9 || (dx * p.faceX + dy * p.faceY) / d >= Math.cos((coneDeg * Math.PI) / 180);
}

/** 플레이어 자리에서 충격파 한 번. 맞힌 적 목록 */
function pulseOnce(g: Game, w: WeaponInstance, radius: number, knock: number, coneDeg: number | null, buf: number[]): Enemy[] {
  const p = g.player;
  const targets = enemiesWithin(g, p.x, p.y, radius, buf).filter((e) => inCone(g, e, coneDeg));
  for (const e of targets) {
    launch(e, e.x - p.x, e.y - p.y, knock, src(w.level));
    damage(g, e, w.level.damage);
  }
  return targets;
}

/**
 * Lv4A 집중파: 이동 방향 부채꼴(coneDeg는 반각)로만. Lv7A 완성: 맞은 적이 더 멀리 난다 (flightMul).
 * Lv4B 이중파: secondDelay 뒤 secondKnock으로 한 번 더, Lv7B는 세 번 (waves).
 */
function firePulse(g: Game, w: WeaponInstance, buf: number[]): number {
  const p = g.player;
  const radius = param(w.level, "radius") * p.stats.area;
  const coneDeg = w.level.params.coneDeg ?? null;
  const ready = enemiesWithin(g, p.x, p.y, radius, buf).filter((e) => inCone(g, e, coneDeg));
  if (ready.length === 0 || ready.length < param(w.level, "minTargets", 1)) return -1;
  const targets = pulseOnce(g, w, radius, knockOf(g, w.level), coneDeg, buf);
  const second = w.level.params.secondKnock;
  if (second) {
    const waves = param(w.level, "waves", 2);
    const delay = param(w.level, "secondDelay", 0.4);
    for (let k = 1; k < waves; k++) {
      g.effects.push({ kind: "pulse", t: delay * k, weapon: w, radius, knock: second * p.stats.knock_power, coneDeg });
    }
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
    launch(c.e, p.faceX, p.faceY, knock, src(w.level));
    damage(g, c.e, w.level.damage);
  }
  firedIds = candidates.map((c) => c.e.id);
  // Lv7A 완성: 한 번에 찬 적 중 같은 색은 (닿아 있는 같은 색까지) 즉시 팝
  if (w.level.params.samePop) {
    for (const c of MATCH_COLORS) {
      const same = candidates.map((x) => x.e).filter((e) => e.color === c && !e.dead);
      if (same.length >= 2) popNow(g, touchingGroup(g.enemies, same, RULES.physics.contactSlack), same[0] as Enemy);
    }
  }
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
/**
 * Lv4A 쌍둥이 토템: totems개를 각각 다른 색으로, 그 색 무리의 한가운데에 세운다.
 * Lv4B 압축: 끌려와 맞닿은 같은 색 3마리는 발사 없이도 팝 (Lv7B부터 그 팝이 충격파를 일으킨다).
 * 진화 프리즘 코어: 범위 안의 모든 색을 끌어오며 가장 많은 색으로 칠한다.
 */
function fireZone(g: Game, w: WeaponInstance, buf: number[]): number {
  const p = g.player;
  const prm = w.level.params;
  const radius = param(w.level, "radius") * p.stats.area;
  const inRange = enemiesWithin(g, p.x, p.y, radius, buf).filter((e) => e.rank === "normal");
  const minN = Math.max(2, param(w.level, "minTargets", 2));
  const counts = MATCH_COLORS.map((c) => ({ c, n: inRange.filter((e) => e.color === c).length }))
    .filter((x) => x.n >= minN)
    .sort((a, b) => b.n - a.n);
  if (counts.length === 0) return -1;
  const n = param(w.level, "totems", 1);
  const chosen = counts.slice(0, n);
  let hits = 0;
  const ids: number[] = [];
  for (const { c } of chosen) {
    const mine = inRange.filter((e) => e.color === c || (prm.prism && e.color !== "rainbow"));
    // 토템이 하나면 플레이어 자리, 여럿이면 그 색 무리의 한가운데
    const own = inRange.filter((e) => e.color === c);
    const at = n === 1 ? { x: p.x, y: p.y } : { x: own.reduce((a, e) => a + e.x, 0) / own.length, y: own.reduce((a, e) => a + e.y, 0) / own.length };
    g.totems.push({
      x: at.x,
      y: at.y,
      radius,
      color: c,
      t: param(w.level, "duration"),
      pullSpeed: param(w.level, "pullSpeed", 110),
      pulled: new Set(mine.map((e) => e.id)),
      weapon: w,
      contact: !!prm.contactMatch,
      popShock: !!prm.popShock,
      prism: !!prm.prism,
    });
    for (const e of mine) {
      if (prm.prism) e.color = c;
      damage(g, e, w.level.damage);
      ids.push(e.id);
    }
    hits += mine.length;
  }
  // 타격 수 = 지속 시간 동안 끌어온 서로 다른 적 수. 세운 순간의 수만 먼저 세고, 나머지는 tickTotems가 더한다.
  firedIds = ids;
  return hits;
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
  const inRange = enemiesWithin(g, p.x, p.y, range, buf).filter((e) => e.state === "walk" && e.rank === "normal" && e.color !== "gray" && e.color !== "rainbow");
  let best: { t: Enemy; b: Enemy; cluster: number; d: number; bp: number } | null = null;
  for (const t of inRange) {
    for (const b of inRange) {
      if (b === t || b.color !== t.color) continue;
      const d = Math.hypot(b.x - t.x, b.y - t.y) - t.radius - b.radius;
      if (d < TOUCH_SLACK) continue;
      const cluster = sameColorCluster(inRange, b);
      // 짝은 같은 색이 많이 붙은 쪽, 같으면 플레이어에게 가까운 쪽 (먼 적을 끌어온다), 그다음 끄는 거리가 짧은 쪽
      const bp = Math.hypot(b.x - p.x, b.y - p.y);
      if (!best || cluster > best.cluster || (cluster === best.cluster && (bp < best.bp - 1e-9 || (Math.abs(bp - best.bp) <= 1e-9 && d < best.d)))) {
        best = { t, b, cluster, d, bp };
      }
    }
  }
  if (!best) return -1;
  const { b } = best;
  const pulled = inRange
    .filter((e) => e !== b && e.color === b.color && Math.hypot(b.x - e.x, b.y - e.y) - e.radius - b.radius >= TOUCH_SLACK)
    .sort((x, y) => Math.hypot(b.x - x.x, b.y - x.y) - Math.hypot(b.x - y.x, b.y - y.y) || x.id - y.id);
  // 가장 좋은 대상은 꼭 넣고, 나머지는 짝에 가까운 순서
  const targets = [best.t, ...pulled.filter((e) => e !== best.t)].slice(0, maxTargets);
  firedIds = targets.map((e) => e.id);
  for (const e of targets) damage(g, e, w.level.damage);
  // Lv7A 완성·진화: 끌어온 적과 짝 무리를 그 자리에서 바로 터뜨린다
  if (w.level.params.instantPop) {
    const group = touchingGroup(inRange, [b], TOUCH_SLACK);
    if (popNow(g, [...group, ...targets.filter((e) => !group.includes(e))], targets[0] as Enemy)) return targets.length;
  }
  for (const e of targets) {
    if (e.dead) continue;
    if (w.level.knock > 0) {
      // Lv4B 투척: 짝에 knock 속도로 닿도록 세게 던진다 (끌기는 220). Lv7B는 다른 색을 뚫고 지나감
      const d = Math.hypot(b.x - e.x, b.y - e.y) - e.radius - b.radius;
      launch(e, b.x - e.x, b.y - e.y, speedToArrive(d, knockOf(g, w.level)) * e.mass, src(w.level));
    } else {
      const d = Math.hypot(b.x - e.x, b.y - e.y) - e.radius - b.radius;
      const v = Math.min(w.level.support, speedToArrive(d, LASSO_ARRIVE_SPEED));
      launch(e, b.x - e.x, b.y - e.y, v * e.mass, WEAPON_LAUNCH);
    }
  }
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
  const inRange = enemiesWithin(g, p.x, p.y, range, buf).filter((e) => e.state === "walk" && e.rank === "normal");
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
  const prm = w.level.params;
  const targets = options.slice(0, shots);
  const knock = knockOf(g, w.level);
  const hit = new Set<Enemy>();
  for (const o of targets) {
    if (hit.has(o.e)) continue;
    o.e.color = o.color;
    launch(o.e, o.cx - o.e.x, o.cy - o.e.y, knock, WEAPON_LAUNCH);
    damage(g, o.e, w.level.damage);
    hit.add(o.e);
    // Lv7A 웅덩이 / 진화 스플래시: 맞은 자리 주변을 같은 색으로
    const splash = prm.splashRadius ?? prm.puddleRadius;
    if (splash) {
      for (const e of inRange) {
        if (hit.has(e) || e.color === "rainbow" || Math.hypot(e.x - o.e.x, e.y - o.e.y) > splash + e.radius) continue;
        e.color = o.color;
        hit.add(e);
      }
    }
    // Lv4B 저격: 같은 선 위 뒤쪽 적을 pierce마리까지 뚫는다. 칠하면 짝이 생기는 적만 칠하고, Lv7B는 첫 적의 색으로 통일.
    if (prm.pierce) {
      const ux = (o.e.x - p.x) / Math.max(1e-9, o.d);
      const uy = (o.e.y - p.y) / Math.max(1e-9, o.d);
      const behind = inRange
        .filter((e) => !hit.has(e) && e.color !== "rainbow")
        .map((e) => ({ e, t: (e.x - p.x) * ux + (e.y - p.y) * uy, off: Math.abs(-(e.x - p.x) * uy + (e.y - p.y) * ux) }))
        .filter((x) => x.t > o.d && x.off <= x.e.radius + 12)
        .sort((a, b) => a.t - b.t)
        .slice(0, prm.pierce);
      for (const { e } of behind) {
        const own = options.find((x) => x.e === e);
        if (prm.unify) e.color = o.color;
        else if (own) e.color = own.color;
        if (own) launch(e, own.cx - e.x, own.cy - e.y, knock, WEAPON_LAUNCH);
        damage(g, e, w.level.damage);
        hit.add(e);
      }
    }
  }
  firedIds = [...hit].map((e) => e.id);
  return hit.size;
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
      if (e.dead || e.state !== "walk" || e.color !== t.color || e.rank !== "normal") continue;
      const dx = t.x - e.x;
      const dy = t.y - e.y;
      const reach = t.radius + e.radius;
      if (dx * dx + dy * dy <= reach * reach) inRange.push(e);
    }
    if (t.prism) {
      for (const e of g.enemies) {
        if (e.dead || e.state !== "walk" || e.color === t.color || e.color === "rainbow" || e.rank !== "normal") continue;
        const reach = t.radius + e.radius;
        if ((t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= reach * reach) {
          e.color = t.color;
          inRange.push(e);
        }
      }
    }
    // 끌려온 적이 쌓이는 더미의 반경 (원 n개를 빽빽하게 쌓은 크기). 더미 안에 든 적은 더 끌지 않는다.
    // 이게 없으면 끄는 속도가 겹침 해소를 이겨 적이 한 점으로 압축된다 (야간 점검에서 발견).
    const pile = pileRadius(inRange.length);
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
  // 압축: 끌려와 서로 닿은 같은 색 3마리 이상은 발사 없이 팝
  for (const t of g.totems) {
    if (!t.contact) continue;
    // 토템 더미(끌려온 적이 쌓이는 반경) 안에 같은 색이 3마리 이상 모이면 한 무리로 본다
    const pulledHere = g.enemies.filter((e) => !e.dead && e.rank === "normal" && e.color === t.color && t.pulled.has(e.id));
    const pile = pileRadius(pulledHere.length) + MAX_ENEMY_RADIUS;
    const group = pulledHere.filter((e) => (t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= pile * pile);
    if (group.length >= RULES.match.minSize) popNow(g, group, group[0] as Enemy, { shock: t.popShock });
  }
  g.totems = g.totems.filter((t) => t.t > 0);
}

/** 끌려온 적 n마리가 쌓이는 더미의 반경 (원 n개를 빽빽하게 쌓은 크기) */
function pileRadius(n: number): number {
  return Math.max(18, 14 * Math.sqrt(n / 0.85));
}

/** 지연 효과: 이중파의 다음 파동, 착지 충격파 */
export function tickEffects(g: Game): void {
  if (g.effects.length === 0) return;
  const buf: number[] = [];
  const due = g.effects.filter((f) => (f.t -= DT) <= 0);
  g.effects = g.effects.filter((f) => f.t > 0);
  for (const f of due) {
    if (f.kind === "pulse") {
      const hit = pulseOnce(g, f.weapon, f.radius, f.knock, f.coneDeg, buf);
      f.weapon.hits += hit.length;
    } else {
      shockwave(g, f.x, f.y, f.radius, f.knock, { chainDepth: 0, chainT: 0 });
    }
  }
}
