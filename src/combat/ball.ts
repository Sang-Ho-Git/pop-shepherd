import { DT, RULES } from "../core/rules.ts";
import { MATCH_COLORS } from "../core/types.ts";
import type { Enemy, Game, Input, MatchColor } from "../core/types.ts";
import { MAX_ENEMY_RADIUS } from "../world/physics.ts";
import { spawnEnemy } from "./spawner.ts";
import { findCluster, touching } from "./match.ts";
import { popCluster } from "./pops.ts";

/**
 * 색 공 던지기 (실험 규칙, g.ballMode).
 * 플레이어는 색 공 하나(current)를 들고, 다음 공(next)이 보인다. 조준한 곳으로 던진다.
 * - 같은 색(또는 무지개)에 맞으면: 맞은 적과 닿아 이어진 같은 색 무리 + 공이 3 이상이면 팝.
 *   모자라면 공이 그 자리에서 같은 색 젤리가 되어 무리에 붙는다 (다음 공으로 터뜨릴 수 있다).
 * - 회색에 맞으면 회색이 공 색으로 물들고 공은 사라진다.
 * - 다른 색·엘리트·보스에 맞으면 당구공처럼 맞고 튕긴다 (적은 살짝 밀리기만, 공은 느려진다).
 * - 공은 굴러가며 느려지고, 울타리·바위·반사벽(쿠션)에서 튕긴다. 너무 느려지면 멈춰 사라진다.
 * - 쿠션을 많이 거친 팝일수록 경험치·골드를 더 준다 (3쿠션 이상이 가장 크다).
 * 길잡이 별(aim_assist)이 있으면 던질 때 조준 방향 둘레의 같은 색 무리 쪽으로 꺾어 준다.
 */

/** 공 색 고르기: 플레이어 근처(600px) 색마다, 같은 색끼리 닿은 짝이 많을수록 더 자주 */
export function rollBallColor(g: Game): MatchColor {
  const colors: MatchColor[] = g.stage?.colors.length ? [...g.stage.colors] : [...MATCH_COLORS];
  const p = g.player;
  const near = g.enemies.filter((e) => !e.dead && e.rank === "normal" && Math.hypot(e.x - p.x, e.y - p.y) < 600);
  const w = colors.map((c) => {
    const mine = near.filter((e) => e.color === c);
    let pairs = 0;
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) if (touching(mine[i]!, mine[j]!)) pairs++;
    return 1 + mine.length + pairs * RULES.ball.pairWeight;
  });
  return g.rng.weighted(colors, w);
}

export function initBall(g: Game): void {
  g.ball = { current: rollBallColor(g), next: rollBallColor(g), cd: 0 };
}

/**
 * 같은 색 무리(minSize마리 이상 닿은) 중심들: 조준 보정과 화면 반짝임에 쓴다.
 * 공간 해시를 쓰지 않는다: 화면 그리기·던지기는 해시를 다시 채우기 전에 불리므로, 적 목록을 직접 훑는다.
 */
export function readyClusters(g: Game, color: MatchColor, minSize = 2): { x: number; y: number; ids: number[] }[] {
  const list = g.enemies.filter((e) => !e.dead && e.rank === "normal" && (e.color === color || e.color === "rainbow"));
  const out: { x: number; y: number; ids: number[] }[] = [];
  const seen = new Set<Enemy>();
  for (const start of list) {
    if (seen.has(start)) continue;
    const group = [start];
    seen.add(start);
    for (let k = 0; k < group.length; k++) {
      const a = group[k]!;
      for (const o of list) {
        if (seen.has(o) || !touching(a, o)) continue;
        seen.add(o);
        group.push(o);
      }
    }
    if (group.length < minSize) continue;
    out.push({ x: group.reduce((t, e) => t + e.x, 0) / group.length, y: group.reduce((t, e) => t + e.y, 0) / group.length, ids: group.map((e) => e.id) });
  }
  return out;
}

/** 던지기: 쿨다운이 끝났고 throwBall이면 조준점 쪽으로 */
export function tickBallThrow(g: Game, input: Input): void {
  const b = g.ball;
  if (!b) return;
  b.cd = Math.max(0, b.cd - DT);
  if (input.swapBall) {
    [b.current, b.next] = [b.next, b.current];
    g.events.push({ type: "ball-swap" });
  }
  if (!input.throwBall || b.cd > 0) return;
  const p = g.player;
  let dx = (input.aimX ?? p.x + p.faceX) - p.x;
  let dy = (input.aimY ?? p.y + p.faceY) - p.y;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    dx = p.faceX;
    dy = p.faceY;
    d = 1;
  }
  let ang = Math.atan2(dy, dx);
  // 길잡이 별: 조준 방향 ±assist° 안의 같은 색 무리 중 가장 가까운 쪽으로 꺾는다 (180° 이상이면 완전 자동)
  const assist = p.stats.aim_assist;
  if (assist > 0) {
    let best: { a: number; dist: number } | null = null;
    for (const c of readyClusters(g, b.current, 1)) {
      const dist = Math.hypot(c.x - p.x, c.y - p.y);
      if (dist > RULES.ball.range) continue;
      const a = Math.atan2(c.y - p.y, c.x - p.x);
      let diff = a - ang;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      if (Math.abs(diff) > (assist * Math.PI) / 180) continue;
      if (!best || dist < best.dist) best = { a, dist };
    }
    if (best) ang = best.a;
  }
  g.balls.push({
    x: p.x + Math.cos(ang) * (p.radius + RULES.ball.radius),
    y: p.y + Math.sin(ang) * (p.radius + RULES.ball.radius),
    vx: Math.cos(ang) * RULES.ball.speed,
    vy: Math.sin(ang) * RULES.ball.speed,
    color: b.current,
    travel: 0,
    bounces: 0,
    lastHit: -1,
  });
  b.current = b.next;
  b.next = rollBallColor(g);
  b.cd = RULES.ball.cooldown * (1 - p.stats.cooldown);
  g.stats.ballsThrown++;
  g.events.push({ type: "ball-throw", color: g.balls[g.balls.length - 1]!.color });
}

type FlyingBall = { x: number; y: number; vx: number; vy: number };

/** 굴러가는 공의 감속 계수 (1/s): 쿠션 없이 range만큼 가서 minSpeed가 된다 */
export function ballDrag(): number {
  return (RULES.ball.speed - RULES.ball.minSpeed) / RULES.ball.range;
}

function railKeep(g: Game): number {
  return g.player.trait === "three_cushion" ? RULES.ball.cueRailKeep : RULES.ball.railKeep;
}

/** 공이 바위에 닿았으면 바깥으로 밀어내고 반사한다. 닿은 바위 (없으면 null) */
function hitRock(g: Game, ball: FlyingBall): { bumper: boolean } | null {
  for (const rk of g.stage?.rocks ?? []) {
    const dx = ball.x - rk.x;
    const dy = ball.y - rk.y;
    const d = Math.hypot(dx, dy);
    const reach = rk.r + RULES.ball.radius;
    if (d >= reach || d < 1e-9) continue;
    const nx = dx / d;
    const ny = dy / d;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= 2 * vn * nx;
      ball.vy -= 2 * vn * ny;
    }
    ball.x = rk.x + nx * reach;
    ball.y = rk.y + ny * reach;
    return { bumper: !!rk.bumper };
  }
  return null;
}

/** 공이 반사벽(무기)에 닿고 벽 쪽으로 움직이면 거울 반사. 닿은 벽 (없으면 null) */
function hitWall(g: Game, ball: FlyingBall): Game["walls"][number] | null {
  const r = RULES.ball.radius;
  for (const wl of g.walls) {
    const vx = wl.x2 - wl.x1;
    const vy = wl.y2 - wl.y1;
    const l2 = vx * vx + vy * vy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((ball.x - wl.x1) * vx + (ball.y - wl.y1) * vy) / l2)) : 0;
    const qx = wl.x1 + vx * u;
    const qy = wl.y1 + vy * u;
    const dx = ball.x - qx;
    const dy = ball.y - qy;
    const d = Math.hypot(dx, dy);
    if (d > r || d < 1e-9) continue;
    const nx = dx / d;
    const ny = dy / d;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn >= 0) continue;
    // 자기 벽은 자기 공을 막지 않는다: 벽을 세운 자리(플레이어 쪽)에서 나가는 공은 지나가고,
    // 바깥에서 들어오는 공만 튕긴다 (만화경 삼각형 안에 공이 갇히고, 앞에 세운 벽이 던진 공을 돌려보내던 문제)
    if (wl.ox !== undefined && wl.oy !== undefined) {
      const side = (px: number, py: number): number => Math.sign(vx * (py - wl.y1) - vy * (px - wl.x1));
      if (side(ball.x, ball.y) === side(wl.ox, wl.oy)) continue;
    }
    ball.vx -= 2 * vn * nx;
    ball.vy -= 2 * vn * ny;
    ball.x = qx + nx * (r + 0.5);
    ball.y = qy + ny * (r + 0.5);
    return wl;
  }
  return null;
}

/**
 * 공을 dt만큼 움직이고 쿠션(울타리·바위·반사벽)에 닿으면 튕긴다. 튕긴 쿠션 종류 (없으면 null).
 * 날아가는 공과 조준선 미리보기가 같이 쓴다 (적은 보지 않는다). 속도 손실은 부른 쪽이 정한다.
 */
export function moveBall(g: Game, ball: FlyingBall, dt: number): "fence" | "rock" | "bumper" | "wall" | null {
  const r = RULES.ball.radius;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  let fence = false;
  if (ball.x < r || ball.x > g.arena.w - r) {
    ball.vx = ball.x < r ? Math.abs(ball.vx) : -Math.abs(ball.vx);
    fence = true;
  }
  if (ball.y < r || ball.y > g.arena.h - r) {
    ball.vy = ball.y < r ? Math.abs(ball.vy) : -Math.abs(ball.vy);
    fence = true;
  }
  if (fence) {
    ball.x = Math.min(g.arena.w - r, Math.max(r, ball.x));
    ball.y = Math.min(g.arena.h - r, Math.max(r, ball.y));
    return "fence";
  }
  const rock = hitRock(g, ball);
  if (rock) return rock.bumper ? "bumper" : "rock";
  return hitWall(g, ball) ? "wall" : null;
}

/** 쿠션에서 튕긴 뒤 속도: 울타리·바위·벽은 조금 잃고, 범퍼는 빨라진다 (던질 때 속도를 넘지 않음) */
function afterCushion(g: Game, ball: FlyingBall, kind: "fence" | "rock" | "bumper" | "wall"): void {
  const k = kind === "bumper" ? RULES.ball.bumperBoost : railKeep(g);
  const sp = Math.hypot(ball.vx, ball.vy);
  const want = Math.min(RULES.ball.speed, sp * k);
  if (sp > 1e-9) {
    ball.vx *= want / sp;
    ball.vy *= want / sp;
  }
}

/**
 * 조준선 미리보기: 지금 자리에서 ang 방향으로 던지면 공이 지나갈 꺾은선 (쿠션마다 점 하나).
 * 적은 보지 않는다. maxCushions번 튕기거나 멈추면 끝.
 */
export function predictBallPath(g: Game, ang: number, maxCushions: number): { x: number; y: number }[] {
  const p = g.player;
  const ball = {
    x: p.x + Math.cos(ang) * (p.radius + RULES.ball.radius),
    y: p.y + Math.sin(ang) * (p.radius + RULES.ball.radius),
    vx: Math.cos(ang) * RULES.ball.speed,
    vy: Math.sin(ang) * RULES.ball.speed,
  };
  const pts = [{ x: ball.x, y: ball.y }];
  const dt = 1 / 240;
  const keep = Math.exp(-ballDrag() * dt);
  let n = 0;
  for (let i = 0; i < 240 * 3; i++) {
    const kind = moveBall(g, ball, dt);
    ball.vx *= keep;
    ball.vy *= keep;
    if (kind) {
      afterCushion(g, ball, kind);
      pts.push({ x: ball.x, y: ball.y });
      if (++n >= maxCushions) break;
    }
    if (Math.hypot(ball.vx, ball.vy) < RULES.ball.minSpeed) break;
  }
  if (n < maxCushions) pts.push({ x: ball.x, y: ball.y });
  return pts;
}

/** 굴러가는 공: 한 틱을 두 번에 나눠 움직인다 (빠른 공이 얇은 반사벽을 뚫지 않게) */
const BALL_SUBSTEPS = 2;

/** 날아가는 공: 이동, 쿠션에서 튕김, 감속, 적에 맞으면 판정 */
export function tickBalls(g: Game): void {
  if (g.balls.length === 0) return;
  const keep = [];
  const buf: number[] = [];
  const r = RULES.ball.radius;
  const sub = DT / BALL_SUBSTEPS;
  const drag = Math.exp(-ballDrag() * DT);
  for (const ball of g.balls) {
    let hitIdx = -1;
    for (let s = 0; s < BALL_SUBSTEPS && hitIdx < 0; s++) {
      const kind = moveBall(g, ball, sub);
      if (kind) {
        afterCushion(g, ball, kind);
        ball.bounces++;
        g.events.push({ type: "ball-cushion", x: ball.x, y: ball.y, n: ball.bounces });
      }
      g.grid.query(ball.x, ball.y, r + MAX_ENEMY_RADIUS, buf);
      let hitD = Infinity;
      for (const j of buf) {
        const e = g.enemies[j] as Enemy;
        if (e.dead || e.id === ball.lastHit) continue;
        const d = Math.hypot(e.x - ball.x, e.y - ball.y);
        if (d <= e.radius + r && d < hitD) {
          hitIdx = j;
          hitD = d;
        }
      }
    }
    ball.vx *= drag;
    ball.vy *= drag;
    ball.travel += Math.hypot(ball.vx, ball.vy) * DT;
    if (hitIdx >= 0 && !resolveBallHit(g, ball, hitIdx)) continue;
    if (Math.hypot(ball.vx, ball.vy) < RULES.ball.minSpeed) {
      g.events.push({ type: "ball-miss", x: ball.x, y: ball.y });
      continue;
    }
    keep.push(ball);
  }
  g.balls = keep;
}

/** 공이 적에 맞았을 때. 공이 계속 굴러가면 true (당구처럼 맞고 튕김), 끝나면 false */
function resolveBallHit(g: Game, ball: Game["balls"][number], hitIdx: number): boolean {
  const e = g.enemies[hitIdx] as Enemy;
  const same = e.rank === "normal" && (e.color === ball.color || e.color === "rainbow");
  if (e.color === "gray" && e.rank === "normal") {
    // 회색: 공 색으로 물든다 (매치가 안 되던 회색이 쓸모가 생긴다). 공은 사라진다
    e.color = ball.color;
    g.events.push({ type: "ball-stick", id: e.id, x: e.x, y: e.y });
    return false;
  }
  if (!same) {
    // 다른 색: 적은 살짝 밀기만 한다 (날리지 않는다: 날아간 적이 뒤의 같은 색에 부딪혀 터지는 일이 없게)
    const sp = Math.max(1e-6, Math.hypot(ball.vx, ball.vy));
    e.x += (ball.vx / sp) * RULES.ball.nudge;
    e.y += (ball.vy / sp) * RULES.ball.nudge;
    g.events.push({ type: "ball-bounce", id: e.id, x: ball.x, y: ball.y });
    if (!RULES.ball.carom) return false;
    // 당구: 공은 맞은 적의 표면에서 반사되어 느려진 채 계속 굴러간다 (같은 적에 바로 또 맞지 않게 기억)
    const dx = ball.x - e.x;
    const dy = ball.y - e.y;
    const d = Math.max(1e-6, Math.hypot(dx, dy));
    const nx = dx / d;
    const ny = dy / d;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= 2 * vn * nx;
      ball.vy -= 2 * vn * ny;
    }
    ball.vx *= RULES.ball.caromKeep;
    ball.vy *= RULES.ball.caromKeep;
    ball.x = e.x + nx * (e.radius + RULES.ball.radius + 0.5);
    ball.y = e.y + ny * (e.radius + RULES.ball.radius + 0.5);
    ball.lastHit = e.id;
    // 큐(당구사): 공끼리 맞은 것도 쿠션으로 센다
    if (RULES.ball.cueCaromCushion && g.player.trait === "three_cushion") {
      ball.bounces++;
      g.events.push({ type: "ball-cushion", x: ball.x, y: ball.y, n: ball.bounces });
    }
    return true;
  }
  const group = findCluster(g, hitIdx, hitIdx, ball.color).slice(1);
  if (group.length + 1 >= RULES.match.minSize) {
    g.stats.ballPops++;
    popCluster(g, group, e, ball.color, { by: "ball", cushion: ball.bounces > 0, cushions: ball.bounces });
    return false;
  }
  // 모자람: 공이 그 자리에서 같은 색 젤리가 되어 붙는다 (맞은 적 쪽으로 반지름만큼 붙여 놓는다)
  const d = Math.max(1e-6, Math.hypot(ball.x - e.x, ball.y - e.y));
  const gap = e.radius + 14;
  const j = spawnEnemy(g, "jelly", ball.color, e.x + ((ball.x - e.x) / d) * gap, e.y + ((ball.y - e.y) / d) * gap);
  j.state = "stunned";
  j.stunT = RULES.ball.stickStun;
  g.stats.spawned--; // 소환 통계에는 넣지 않는다
  g.events.push({ type: "ball-stick", id: j.id, x: j.x, y: j.y });
  return false;
}
