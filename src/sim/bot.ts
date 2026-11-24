import type { Enemy, Game, Input, MatchColor } from "../core/types.ts";
import { RULES } from "../core/rules.ts";
import { readyClusters } from "../combat/ball.ts";
import { inHazard } from "../combat/bosses.ts";

/**
 * 자동 플레이 봇. 사람보다 서툴지만 매번 같은 방식으로 움직여서 수치 비교의 기준선이 된다.
 * 1) 킥이 준비됐고, 적 E 뒤로 같은 색 2마리 이상이 일직선에 있으면 E를 향해 걸어가 킥으로 그 줄에 날린다.
 *    줄 중간에 다른 색이 먼저 있으면 막힌 줄로 보고 노리지 않는다.
 * 2) 아니면 가까운 적을 피하면서 적 무리 둘레를 돈다 (카이팅).
 * 3) 둘러싸이거나 체력이 35% 아래면 휘슬.
 * 4) 450px 안의 색 폭탄(과 체력이 90% 아래면 우유병)은, 가까이 위협이 없고 폭탄 주변이 한산할 때만 킥보다 먼저 주우러 간다.
 * 5) 보스·엘리트 공격: 바닥 경고·돌진 경로·날아오는 탄을 무엇보다 먼저 피한다 (dodge).
 * 6) 색 공: 약점 색 공이면 보스에 바로 던지고, 보호막이면 울타리 쿠션으로 맞힌다 (bossShot).
 * 봇은 난수를 쓰지 않는다. 공간 해시는 지난 틱 기준이라 적 목록을 직접 훑는다.
 */
export function botInput(g: Game): Input {
  let move = botMove(g);
  const d = dodge(g);
  if (d) move = { ...move, moveX: d.x, moveY: d.y };
  return g.ballMode ? { ...move, ...botBall(g) } : move;
}

/**
 * 피할 방향: 플레이어가 경고 안(여유 30px)이면 바깥으로, 돌진하는 몸의 길 위면 옆으로, 탄이 0.7초 안에 닿을 길이면 옆으로.
 * 위험이 없으면 null.
 */
export function dodge(g: Game): { x: number; y: number } | null {
  const p = g.player;
  const pad = p.radius + 30;
  let x = 0;
  let y = 0;
  const side = (ax: number, ay: number, ux: number, uy: number): void => {
    // (ax, ay)를 지나는 u 방향 직선에서 플레이어가 있는 쪽 수직으로
    const cross = (p.x - ax) * uy - (p.y - ay) * ux;
    const s = cross >= 0 ? 1 : -1;
    x += uy * s;
    y += -ux * s;
  };
  for (const h of g.hazards) {
    if (!inHazard(h, p.x, p.y, pad)) continue;
    if (h.kind === "circle") {
      const dx = p.x - h.x;
      const dy = p.y - h.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) x += 1;
      else {
        x += dx / d;
        y += dy / d;
      }
    } else side(h.x, h.y, Math.cos(h.ang), Math.sin(h.ang));
  }
  for (const e of g.enemies) {
    const b = e.boss;
    if (!b || e.dead || b.dashLeft <= 0) continue;
    const v = Math.hypot(b.dashX, b.dashY) || 1;
    const ux = b.dashX / v;
    const uy = b.dashY / v;
    const along = (p.x - e.x) * ux + (p.y - e.y) * uy;
    if (along < -pad || along > b.dashLeft + pad) continue;
    if (Math.abs((p.x - e.x) * uy - (p.y - e.y) * ux) > e.radius + pad) continue;
    side(e.x, e.y, ux, uy);
  }
  for (const s of g.shots) {
    const v = Math.hypot(s.vx, s.vy) || 1;
    const ux = s.vx / v;
    const uy = s.vy / v;
    const along = (p.x - s.x) * ux + (p.y - s.y) * uy;
    if (along < 0 || along > v * 0.7) continue;
    if (Math.abs((p.x - s.x) * uy - (p.y - s.y) * ux) > s.r + p.radius + 12) continue;
    side(s.x, s.y, ux, uy);
  }
  if (Math.abs(x) + Math.abs(y) < 1e-6) return null;
  // 울타리에 막히지 않게: 벽 쪽으로 가는 성분은 반대로
  const m = p.radius + 40;
  if ((p.x < m && x < 0) || (p.x > g.arena.w - m && x > 0)) x = -x;
  if ((p.y < m && y < 0) || (p.y > g.arena.h - m && y > 0)) y = -y;
  return { x, y };
}

/**
 * 엘리트·보스 노리기: 보호막이면 울타리 쿠션으로 몸을 맞힌다 (어느 색이든).
 * 약점 색 공을 들었거나 그로기면 몸에 바로 던진다. 다음 공이 약점 색이면 바꾼다.
 */
function bossShot(g: Game): Pick<Input, "aimX" | "aimY" | "throwBall" | "swapBall"> | null {
  const b = g.ball!;
  const p = g.player;
  const range = RULES.ball.range * 0.9;
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const e of g.enemies) {
    if (e.dead || !e.boss) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  if (!best) return null;
  const bs = best.boss!;
  if (bs.shield > 0) {
    const mirrors = [
      { x: -best.x, y: best.y },
      { x: 2 * g.arena.w - best.x, y: best.y },
      { x: best.x, y: -best.y },
      { x: best.x, y: 2 * g.arena.h - best.y },
    ];
    let m: { x: number; y: number } | null = null;
    let md = RULES.ball.range * 0.8;
    for (const c of mirrors) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < md) {
        m = c;
        md = d;
      }
    }
    return m ? { aimX: m.x, aimY: m.y, throwBall: true } : null;
  }
  if (bestD > range) return null;
  if (bs.groggy > 0 || b.current === bs.weak) return { aimX: best.x, aimY: best.y, throwBall: true };
  if (b.next === bs.weak) return { throwBall: false, swapBall: true };
  return null;
}

/**
 * 색 공 규칙의 봇 조준: 들고 있는 공과 같은 색으로 2마리 이상 닿은 무리 중 가장 가까운 곳(사거리 안).
 * 없으면 같은 색 1마리에 던져 짝을 만든다. 그것도 없으면 던지지 않는다 (쿨다운을 아낀다).
 */
export function botBall(g: Game): Pick<Input, "aimX" | "aimY" | "throwBall" | "swapBall"> {
  const b = g.ball;
  if (!b || b.cd > 0) return { throwBall: false };
  const p = g.player;
  const range = RULES.ball.range * 0.9;
  const shot = bossShot(g);
  if (shot) return shot;
  const pick = (minSize: number): { x: number; y: number } | null => {
    let best: { x: number; y: number } | null = null;
    let bestD = range;
    for (const c of readyClusters(g, b.current, minSize)) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  };
  const t = pick(2);
  if (t) return { aimX: t.x, aimY: t.y, throwBall: true };
  // 울타리 쿠션: 무리를 울타리에 비친 자리로 노린다 (한 번 튕겨 맞힌다). 반사한 거리가 사거리 안일 때만.
  const bank = bankShot(g, b.current, RULES.ball.range * 0.8);
  if (bank) return { aimX: bank.x, aimY: bank.y, throwBall: true };
  // 지금 공으로 터뜨릴 무리가 없고 다음 공으로는 있으면 바꾼다 (다음 틱에 던진다)
  const nextReady = readyClusters(g, b.next, 2).some((c) => Math.hypot(c.x - p.x, c.y - p.y) < range);
  if (nextReady) return { throwBall: false, swapBall: true };
  const one = pick(1);
  return one ? { aimX: one.x, aimY: one.y, throwBall: true } : { throwBall: false };
}

/** 울타리 쿠션 조준점: 같은 색 무리(2마리 이상)를 네 울타리에 비친 위치 중 가장 가까운 곳 */
export function bankShot(g: Game, color: MatchColor, range: number): { x: number; y: number } | null {
  const p = g.player;
  let best: { x: number; y: number } | null = null;
  let bestD = range;
  for (const c of readyClusters(g, color, 2)) {
    const mirrors = [
      { x: -c.x, y: c.y },
      { x: 2 * g.arena.w - c.x, y: c.y },
      { x: c.x, y: -c.y },
      { x: c.x, y: 2 * g.arena.h - c.y },
    ];
    for (const m of mirrors) {
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
  }
  return best;
}

function botMove(g: Game): Input {
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

  // 색 폭탄: 가까이 위협이 없고, 폭탄 주변 100px 안에 평소 상태 적이 2마리 미만일 때만 주우러 간다.
  // 무작정 주우러 가면 팝이 난 자리(적이 몰린 곳)로 걸어 들어가 체력을 잃는다 (야간 점검: 사망 0/40 → 6/40).
  const calm = Math.hypot(ax, ay) < 0.3;
  if (calm) {
    let best: { x: number; y: number } | null = null;
    let bestD = 450;
    // 우유병은 체력이 90% 아래일 때만 (가득 차 있으면 주워도 소용없다). 골드 주머니도 같은 조건으로 줍는다.
    const items: { x: number; y: number; crowdOk?: number }[] = [...g.bombs, ...g.golds, ...(p.hp < p.maxHp * 0.9 ? g.milks : [])];
    // 보물 상자는 조금 붐벼도 주우러 간다 (진화가 걸려 있다)
    for (const c of g.chests) items.push({ x: c.x, y: c.y, crowdOk: 4 });
    for (const b of items) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d >= (b.crowdOk ? 900 : bestD)) continue;
      let crowd = 0;
      for (const e of g.enemies) if (e.state === "walk" && Math.hypot(e.x - b.x, e.y - b.y) < 100) crowd++;
      if (crowd >= (b.crowdOk ?? 2)) continue;
      best = b;
      bestD = d;
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
  // 엘리트·보스가 있으면 그 둘레를 돈다: 몰고 다니는 적이 보스 곁에서 터져야 팝 피해가 들어간다.
  // 너무 붙으면 접촉 피해, 너무 멀면 팝이 닿지 않으므로 반지름 + 150px 근처를 유지한다.
  let boss: Enemy | null = null;
  let bossD = 1200;
  for (const e of g.enemies) {
    if (e.rank === "normal" || e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bossD) {
      boss = e;
      bossD = d;
    }
  }
  if (boss) {
    const dx = p.x - boss.x;
    const dy = p.y - boss.y;
    const d = Math.max(1e-6, Math.hypot(dx, dy));
    const want = boss.radius + 150;
    // 둘레 방향 + 원하는 거리로 당기거나 밀기
    const radial = (want - d) / want;
    return {
      moveX: (-dy / d) * 0.8 + (dx / d) * radial * 2 + ax * 1.2 + wx * 2,
      moveY: (dx / d) * 0.8 + (dy / d) * radial * 2 + ay * 1.2 + wy * 2,
      whistle,
    };
  }
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
