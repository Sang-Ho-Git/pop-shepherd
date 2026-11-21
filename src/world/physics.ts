import { DAMP_PER_TICK, DT, RULES } from "../core/rules.ts";
import type { Enemy, Game, LaunchFx } from "../core/types.ts";

/** 이 게임에서 가장 큰 적 반지름. 이웃 질의 반경을 정할 때 쓴다. */
export const MAX_ENEMY_RADIUS = 48;

/** 발사의 출처. 연쇄 단계와 연쇄 인정 시간을 함께 넘긴다. */
export interface LaunchSource {
  chainDepth: number;
  chainT: number;
  /** 플레이어 무기의 발사인지 */
  weapon?: boolean;
  /** 무기 갈래 효과 */
  fx?: LaunchFx | null;
}

/** 휘슬 등: 연쇄 단계 0 */
export const PLAIN_LAUNCH: LaunchSource = { chainDepth: 0, chainT: 0 };

/** 플레이어 무기 발사: 연쇄 단계 0, 쓰리쿠션 대상 */
export const WEAPON_LAUNCH: LaunchSource = { chainDepth: 0, chainT: 0, weapon: true };

export function speedOf(e: { vx: number; vy: number }): number {
  return Math.hypot(e.vx, e.vy);
}

/**
 * 1.2 발사: 발사 순간 속도 = 날리는 힘 ÷ 질량, 방향은 (dx, dy).
 * 이미 날아가는 중이어도 새 발사가 속도를 덮어쓴다.
 */
export function launch(e: Enemy, dx: number, dy: number, knock: number, src: LaunchSource = PLAIN_LAUNCH): void {
  // 가시 젤리: 플레이어 무기로는 밀리지 않는다 (팝 충격파·휘슬은 밀린다)
  if (e.trait === "spiky" && src.weapon) return;
  let len = Math.hypot(dx, dy);
  let ux = 1;
  let uy = 0;
  if (len > 1e-9) {
    ux = dx / len;
    uy = dy / len;
  }
  len = knock / e.mass;
  e.vx = ux * len;
  e.vy = uy * len;
  e.state = "launched";
  e.stunT = 0;
  e.chainDepth = src.chainDepth;
  e.chainT = src.chainT;
  e.wallBounces = 0;
  e.shot = src.weapon === true;
  e.fx = src.fx ?? null;
}

/** 발사 상태를 끝내고 평소 상태로 */
export function land(e: Enemy): void {
  e.fx = null;
  e.state = "walk";
  e.chainDepth = 0;
  e.chainT = 0;
  e.wallBounces = 0;
}

export function stun(e: Enemy): void {
  e.fx = null;
  e.state = "stunned";
  e.stunT = RULES.physics.stunTime;
  e.chainDepth = 0;
  e.chainT = 0;
  e.wallBounces = 0;
}

/**
 * 위치 적분. 발사·기절 상태는 지수 감속, 평소 상태는 AI가 정한 속도 그대로.
 * 발사된 적은 울타리에 튕기고(쿠션), 나머지는 울타리 안쪽에 붙잡힌다.
 */
/** 핀볼: 가장 가까운 같은 색(450px 안) 쪽으로 진행 방향을 초당 turn 라디안까지 돌린다. 속력은 그대로. */
function home(g: Game, e: Enemy, turn: number): void {
  let best: Enemy | null = null;
  let bestD = 450 * 450;
  for (const o of g.enemies) {
    if (o === e || o.dead || o.rank !== "normal" || (o.color !== e.color && o.color !== "rainbow")) continue;
    const d = (o.x - e.x) ** 2 + (o.y - e.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  if (!best) return;
  const sp = Math.hypot(e.vx, e.vy);
  if (sp < 1e-6) return;
  const cur = Math.atan2(e.vy, e.vx);
  const want = Math.atan2(best.y - e.y, best.x - e.x);
  let diff = want - cur;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const step = Math.max(-turn * DT, Math.min(turn * DT, diff));
  e.vx = Math.cos(cur + step) * sp;
  e.vy = Math.sin(cur + step) * sp;
}

/**
 * 맵 기믹 바위: 적과 플레이어를 밀어낸다. 날아가던 적은 울타리처럼 튕기고 쿠션 1회로 센다.
 */
export function collideRocks(g: Game): void {
  const rocks = g.stage?.rocks;
  if (!rocks || rocks.length === 0) return;
  const wallE = RULES.physics.wallRestitution;
  const push = (o: { x: number; y: number }, r: number, rk: { x: number; y: number; r: number }): { nx: number; ny: number } | null => {
    const dx = o.x - rk.x;
    const dy = o.y - rk.y;
    const d = Math.hypot(dx, dy);
    if (d >= rk.r + r || d < 1e-9) return null;
    const nx = dx / d;
    const ny = dy / d;
    o.x = rk.x + nx * (rk.r + r);
    o.y = rk.y + ny * (rk.r + r);
    return { nx, ny };
  };
  const T = RULES.terrain;
  for (const rk of rocks) {
    push(g.player, g.player.radius, rk);
    for (const e of g.enemies) {
      if (e.dead) continue;
      const n = push(e, e.radius, rk);
      if (!n) continue;
      if (e.state !== "launched") {
        // 꽃 범퍼: 걸어서 닿은 적도 바깥으로 튕겨 낸다 (무기 발사가 아니다: 가시 젤리도 튕긴다)
        if (rk.bumper && e.rank === "normal") launch(e, n.nx, n.ny, T.bumperKick * e.mass, PLAIN_LAUNCH);
        continue;
      }
      const vn = e.vx * n.nx + e.vy * n.ny;
      if (vn >= 0) continue;
      const k = rk.bumper ? T.bumperBoost : wallE;
      e.vx = (e.vx - 2 * vn * n.nx) * k;
      e.vy = (e.vy - 2 * vn * n.ny) * k;
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > T.bumperMax) {
        e.vx *= T.bumperMax / sp;
        e.vy *= T.bumperMax / sp;
      }
      e.wallBounces++;
    }
  }
}

export function integrate(g: Game): void {
  const { w, h } = g.arena;
  const endSpeed = RULES.physics.launchEndSpeed;
  const wallE0 = RULES.physics.wallRestitution;
  const bounce = g.player.stats.bounce;
  for (const e of g.enemies) {
    if (e.dead) continue;
    if (e.wetT > 0) e.wetT = Math.max(0, e.wetT - DT);
    if (e.state !== "walk") {
      const k = e.fx?.dampMul !== undefined ? Math.pow(DAMP_PER_TICK, e.fx.dampMul) : DAMP_PER_TICK;
      e.vx *= k;
      e.vy *= k;
    }
    e.x += e.vx * DT;
    e.y += e.vy * DT;

    const r = e.radius;
    if (e.state === "launched") {
      if (e.fx?.homing) home(g, e, e.fx.homing);
      // 탄성: 무기로 날린 적은 처음 몇 번은 울타리에서 속도를 잃지 않는다. 핀볼은 늘.
      const wallE = e.shot && (e.wallBounces < bounce || e.fx?.homing) ? 1 : wallE0;
      let bounced = false;
      if (e.x < r) {
        e.x = r + (r - e.x);
        e.vx = -e.vx * wallE;
        e.vy *= wallE;
        bounced = true;
      } else if (e.x > w - r) {
        e.x = w - r - (e.x - (w - r));
        e.vx = -e.vx * wallE;
        e.vy *= wallE;
        bounced = true;
      }
      if (e.y < r) {
        e.y = r + (r - e.y);
        e.vy = -e.vy * wallE;
        e.vx *= wallE;
        bounced = true;
      } else if (e.y > h - r) {
        e.y = h - r - (e.y - (h - r));
        e.vy = -e.vy * wallE;
        e.vx *= wallE;
        bounced = true;
      }
      if (bounced) e.wallBounces++;

      if (e.chainT > 0) {
        e.chainT -= DT;
        if (e.chainT <= 0) {
          e.chainT = 0;
          e.chainDepth = 0;
        }
      }
      if (speedOf(e) < endSpeed) {
        if (e.fx?.landShock) g.effects.push({ kind: "shock", t: 0, x: e.x, y: e.y, radius: e.fx.landShock, knock: RULES.match.shockKnock * 0.6 });
        land(e);
      }
    } else {
      e.x = Math.min(w - r, Math.max(r, e.x));
      e.y = Math.min(h - r, Math.max(r, e.y));
      if (e.state === "stunned") {
        e.stunT -= DT;
        if (e.stunT <= 0) {
          e.stunT = 0;
          e.state = "walk";
        }
      }
    }
  }
}

/**
 * 다른 색 충돌: 법선 방향 충격량 교환 (반발 계수 RULES.physics.restitution).
 * 무거운 적(돌덩이)은 덜 밀리고, 무거운 적이 부딪치면 상대를 더 멀리 보낸다.
 */
export function impulse(a: Enemy, b: Enemy, nx: number, ny: number): void {
  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (closing <= 0) return;
  const j = ((1 + RULES.physics.restitution) * closing) / (1 / a.mass + 1 / b.mass);
  a.vx -= (j / a.mass) * nx;
  a.vy -= (j / a.mass) * ny;
  b.vx += (j / b.mass) * nx;
  b.vy += (j / b.mass) * ny;
}

/** 겹친 두 적을 정확히 맞닿는 위치까지 떼어 놓는다 (질량 반비례). */
export function pushApart(a: Enemy, b: Enemy, ratio: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const overlap = a.radius + b.radius - d;
  if (overlap <= 0) return;
  let nx = 1;
  let ny = 0;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  } else if (b.id < a.id) {
    nx = -1;
  }
  const total = a.mass + b.mass;
  const move = overlap * ratio;
  a.x -= nx * move * (b.mass / total);
  a.y -= ny * move * (b.mass / total);
  b.x += nx * move * (a.mass / total);
  b.y += ny * move * (a.mass / total);
}

/**
 * 1.2 평소 적끼리: 겹친 만큼만 밀어낸다. 그래서 무리는 서로 닿아 있지만(접촉 판정 안) 겹치지 않는다.
 * 닿아 있다는 것만으로는 터지지 않는다. 매치는 발사된 적이 부딪칠 때만 판정한다.
 */
export function separate(g: Game, buf: number[]): void {
  const { enemies, grid } = g;
  const ratio = RULES.physics.separation;

  // 순서: 플레이어 밖으로 밀기 → 울타리 → 적끼리 떼기 → 울타리.
  // 적끼리 먼저 떼고 플레이어·울타리를 나중에 처리하면, 벽에 몰린 플레이어 주변에서 적이 플레이어와 벽 사이에
  // 끼어 서로 깊게 겹친 채 남았다 (접촉 피해 합산에서 실제보다 많이 닿는다).
  pushOutOfPlayer(g, buf);
  clampToArena(g);

  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i] as Enemy;
    if (a.dead) continue;
    grid.query(a.x, a.y, a.radius + MAX_ENEMY_RADIUS, buf);
    for (const j of buf) {
      if (j <= i) continue;
      const b = enemies[j] as Enemy;
      if (b.dead) continue;
      pushApart(a, b, ratio);
    }
  }

  clampToArena(g);
}

/** 플레이어와 겹친 적은 플레이어 밖으로 완전히 밀어낸다 (플레이어는 밀리지 않는다). */
function pushOutOfPlayer(g: Game, buf: number[]): void {
  const p = g.player;
  g.grid.query(p.x, p.y, p.radius + MAX_ENEMY_RADIUS, buf);
  for (const j of buf) {
    const e = g.enemies[j] as Enemy;
    if (e.dead) continue;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.hypot(dx, dy);
    const min = p.radius + e.radius;
    if (d >= min) continue;
    const nx = d > 1e-9 ? dx / d : 1;
    const ny = d > 1e-9 ? dy / d : 0;
    e.x = p.x + nx * min;
    e.y = p.y + ny * min;
  }
}

/** 모든 적을 울타리 안쪽(반지름만큼)으로 붙잡는다. */
export function clampToArena(g: Game): void {
  const { w, h } = g.arena;
  for (const e of g.enemies) {
    if (e.dead) continue;
    const r = e.radius;
    if (e.x < r) e.x = r;
    else if (e.x > w - r) e.x = w - r;
    if (e.y < r) e.y = r;
    else if (e.y > h - r) e.y = h - r;
  }
}
