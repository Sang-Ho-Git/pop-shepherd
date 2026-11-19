import type { Enemy, Game, Input } from "../core/types.ts";

/**
 * 자동 플레이 봇. 사람보다 서툴지만 매번 같은 방식으로 움직여서 수치 비교의 기준선이 된다.
 * 1) 킥이 준비됐고, 적 E 뒤로 같은 색 2마리 이상이 일직선에 있으면 E를 향해 걸어가 킥으로 그 줄에 날린다.
 *    줄 중간에 다른 색이 먼저 있으면 막힌 줄로 보고 노리지 않는다.
 * 2) 아니면 가까운 적을 피하면서 적 무리 둘레를 돈다 (카이팅).
 * 3) 둘러싸이거나 체력이 35% 아래면 휘슬.
 * 4) 450px 안에 색 폭탄이 있고 둘러싸여 있지 않으면 킥보다 먼저 주우러 간다.
 * 봇은 난수를 쓰지 않는다. 공간 해시는 지난 틱 기준이라 적 목록을 직접 훑는다.
 */
export function botInput(g: Game): Input {
  const p = g.player;
  let ax = 0;
  let ay = 0;
  let surrounded = 0;
  let cx = 0;
  let cy = 0;
  let cn = 0;
  for (const e of g.enemies) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 600) {
      cx += e.x;
      cy += e.y;
      cn++;
    }
    if (e.state !== "walk" || d < 1e-6) continue;
    if (d < 220) {
      const w = (1 - d / 220) ** 2;
      ax += (dx / d) * w;
      ay += (dy / d) * w;
    }
    if (d < 60) surrounded++;
  }

  const whistle = p.whistleCd <= 0 && (surrounded >= 6 || p.hp < p.maxHp * 0.35);

  // 근처에 색 폭탄이 있고 둘러싸여 있지 않으면 주우러 간다 (사람이라면 당연히 줍는다).
  if (surrounded < 4) {
    let best: { x: number; y: number } | null = null;
    let bestD = 450;
    for (const b of g.bombs) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    if (best) return { moveX: best.x - p.x, moveY: best.y - p.y, whistle };
  }

  const kick = g.weapons.find((w) => w.def.behavior === "directional");
  if (kick && kick.cd <= 0.15 && surrounded < 4) {
    const target = bestKickTarget(g);
    if (target) return { moveX: target.x - p.x, moveY: target.y - p.y, whistle };
  }

  // 울타리 피하기
  const margin = 220;
  let wx = 0;
  let wy = 0;
  if (p.x < margin) wx += (margin - p.x) / margin;
  if (p.x > g.arena.w - margin) wx -= (p.x - (g.arena.w - margin)) / margin;
  if (p.y < margin) wy += (margin - p.y) / margin;
  if (p.y > g.arena.h - margin) wy -= (p.y - (g.arena.h - margin)) / margin;

  let tx = 0;
  let ty = 0;
  if (cn > 0) {
    cx /= cn;
    cy /= cn;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      // 무리 둘레를 시계 방향으로 돈다
      tx = -dy / d;
      ty = dx / d;
      // 멀리 있으면 다가가서 무기 사거리에 넣는다
      if (d > 260 && Math.hypot(ax, ay) < 0.05) return { moveX: -dx + wx * 400, moveY: -dy + wy * 400, whistle };
    }
  }
  return { moveX: ax * 1.5 + tx * 0.7 + wx * 2, moveY: ay * 1.5 + ty * 0.7 + wy * 2, whistle };
}

/** 킥으로 날렸을 때 같은 색 줄에 꽂힐 적 (줄에 같은 색이 가장 많은 것, 동률이면 가까운 것) */
export function bestKickTarget(g: Game): Enemy | null {
  const p = g.player;
  const near = g.enemies
    .filter((e) => e.state !== "launched" && e.color !== "gray")
    .map((e) => ({ e, d: Math.hypot(e.x - p.x, e.y - p.y) }))
    .filter((c) => c.d < 160 && c.d > 1e-6)
    .sort((a, b) => a.d - b.d || a.e.id - b.e.id)
    .slice(0, 12);

  let best: Enemy | null = null;
  let bestScore = 1;
  for (const { e, d } of near) {
    const ux = (e.x - p.x) / d;
    const uy = (e.y - p.y) / d;
    // 줄 위의 적을 가까운 순으로 본다. 다른 색이 먼저 나오면 그 줄은 막혀 있다.
    let score = 0;
    let firstSame = Infinity;
    let firstBlocker = Infinity;
    for (const o of g.enemies) {
      if (o === e) continue;
      const ox = o.x - e.x;
      const oy = o.y - e.y;
      const along = ox * ux + oy * uy;
      if (along < 20 || along > 200) continue;
      if (Math.abs(ox * uy - oy * ux) > 24) continue;
      const same = o.color === e.color || o.color === "rainbow" || e.color === "rainbow";
      if (same) {
        score++;
        firstSame = Math.min(firstSame, along);
      } else {
        firstBlocker = Math.min(firstBlocker, along);
      }
    }
    if (firstBlocker < firstSame) score = 0;
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}
