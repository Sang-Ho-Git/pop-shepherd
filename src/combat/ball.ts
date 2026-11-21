import { DT, RULES } from "../core/rules.ts";
import { MATCH_COLORS } from "../core/types.ts";
import type { Enemy, Game, Input, MatchColor } from "../core/types.ts";
import { launch, MAX_ENEMY_RADIUS, WEAPON_LAUNCH } from "../world/physics.ts";
import { spawnEnemy } from "./spawner.ts";
import { findCluster, touching } from "./match.ts";
import { popCluster } from "./pops.ts";

/**
 * 색 공 던지기 (실험 규칙, g.ballMode).
 * 플레이어는 색 공 하나(current)를 들고, 다음 공(next)이 보인다. 조준한 곳으로 던진다.
 * - 같은 색(또는 무지개)에 맞으면: 맞은 적과 닿아 이어진 같은 색 무리 + 공이 3 이상이면 팝.
 *   모자라면 공이 그 자리에서 같은 색 젤리가 되어 무리에 붙는다 (다음 공으로 터뜨릴 수 있다).
 * - 다른 색·회색·엘리트·보스에 맞으면: 맞은 적을 공 방향으로 밀어내고 공은 사라진다.
 * - 아무것도 못 맞히고 사거리를 다 가면 사라진다.
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
  });
  b.current = b.next;
  b.next = rollBallColor(g);
  b.cd = RULES.ball.cooldown * (1 - p.stats.cooldown);
  g.stats.ballsThrown++;
  g.events.push({ type: "ball-throw", color: g.balls[g.balls.length - 1]!.color });
}

/** 공이 바위에 닿았으면 바깥으로 밀어내고 반사한 뒤 true */
function hitRock(g: Game, ball: { x: number; y: number; vx: number; vy: number }): boolean {
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
    return true;
  }
  return false;
}

/** 날아가는 공: 이동, 울타리에서 사라짐, 적에 맞으면 판정 */
export function tickBalls(g: Game): void {
  if (g.balls.length === 0) return;
  const keep = [];
  const buf: number[] = [];
  const r = RULES.ball.radius;
  for (const ball of g.balls) {
    ball.x += ball.vx * DT;
    ball.y += ball.vy * DT;
    ball.travel += RULES.ball.speed * DT;
    // 울타리 쿠션: 정해진 횟수까지는 튕기고 (사거리는 이어진다), 그 뒤에는 사라진다
    const out = ball.x < r || ball.y < r || ball.x > g.arena.w - r || ball.y > g.arena.h - r;
    const maxCushion = RULES.ball.cushions + (g.player.trait === "three_cushion" ? 1 : 0);
    if (out && ball.bounces < maxCushion && ball.travel <= RULES.ball.range) {
      if (ball.x < r || ball.x > g.arena.w - r) ball.vx = -ball.vx;
      if (ball.y < r || ball.y > g.arena.h - r) ball.vy = -ball.vy;
      ball.x = Math.min(g.arena.w - r, Math.max(r, ball.x));
      ball.y = Math.min(g.arena.h - r, Math.max(r, ball.y));
      ball.bounces++;
      g.events.push({ type: "ball-cushion", x: ball.x, y: ball.y });
    } else if (!out && hitRock(g, ball)) {
      // 바위·범퍼: 울타리처럼 튕긴다 (쿠션 횟수를 쓴다). 다 썼으면 사라진다
      if (ball.bounces >= maxCushion) {
        g.events.push({ type: "ball-miss", x: ball.x, y: ball.y });
        continue;
      }
      ball.bounces++;
      g.events.push({ type: "ball-cushion", x: ball.x, y: ball.y });
    } else if (out || ball.travel > RULES.ball.range) {
      g.events.push({ type: "ball-miss", x: ball.x, y: ball.y });
      continue;
    }
    g.grid.query(ball.x, ball.y, r + MAX_ENEMY_RADIUS, buf);
    let hitIdx = -1;
    let hitD = Infinity;
    for (const j of buf) {
      const e = g.enemies[j] as Enemy;
      if (e.dead) continue;
      const d = Math.hypot(e.x - ball.x, e.y - ball.y);
      if (d <= e.radius + r && d < hitD) {
        hitIdx = j;
        hitD = d;
      }
    }
    if (hitIdx < 0) {
      keep.push(ball);
      continue;
    }
    resolveBallHit(g, ball, hitIdx);
  }
  g.balls = keep;
}

function resolveBallHit(g: Game, ball: { x: number; y: number; vx: number; vy: number; color: MatchColor; bounces: number }, hitIdx: number): void {
  const e = g.enemies[hitIdx] as Enemy;
  const same = e.rank === "normal" && (e.color === ball.color || e.color === "rainbow");
  if (!same) {
    // 다른 색: 공 방향으로 밀어낸다 (무기 발사로 친다: 당구·쿠션이 이어진다)
    launch(e, ball.vx, ball.vy, RULES.ball.knock, WEAPON_LAUNCH);
    e.cause = "ball";
    g.events.push({ type: "ball-bounce", id: e.id, x: ball.x, y: ball.y });
    return;
  }
  const group = findCluster(g, hitIdx, hitIdx, ball.color).slice(1);
  if (group.length + 1 >= RULES.match.minSize) {
    g.stats.ballPops++;
    popCluster(g, group, e, ball.color, { by: "ball", cushion: ball.bounces > 0 });
    return;
  }
  // 모자람: 공이 그 자리에서 같은 색 젤리가 되어 붙는다 (맞은 적 쪽으로 반지름만큼 붙여 놓는다)
  const d = Math.max(1e-6, Math.hypot(ball.x - e.x, ball.y - e.y));
  const gap = e.radius + 14;
  const j = spawnEnemy(g, "jelly", ball.color, e.x + ((ball.x - e.x) / d) * gap, e.y + ((ball.y - e.y) / d) * gap);
  j.state = "stunned";
  j.stunT = RULES.ball.stickStun;
  g.stats.spawned--; // 소환 통계에는 넣지 않는다
  g.events.push({ type: "ball-stick", id: j.id, x: j.x, y: j.y });
}
