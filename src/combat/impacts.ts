import { RULES } from "../core/rules.ts";
import type { Enemy, Game } from "../core/types.ts";
import { impulse, land, MAX_ENEMY_RADIUS, pushApart, speedOf, stun } from "../world/physics.ts";
import { findCluster, resolveMatchColor } from "./match.ts";
import { popCluster } from "./pops.ts";

/**
 * 1.4 충돌 매치 판정. 발사 상태인 적 A마다, 닿아 있고 접근 속도가 impactSpeed 이상인 적 중
 * 가장 세게 부딪친 하나(B)를 고른다.
 *
 * - 같은 색: A·B와 이어진 같은 색 무리가 3마리 이상이면 팝. 아니면 A가 멈춰 B 옆에 붙는다.
 * - 다른 색·회색: 충격량을 주고받는다. B가 발사 기준 속도 이상을 받으면 B도 발사(당구),
 *   아니면 B는 기절. A가 기준 아래로 느려지면 A도 기절.
 */
export function resolveImpacts(g: Game): void {
  const { enemies, grid } = g;
  const slack = RULES.physics.contactSlack;
  const minClosing = RULES.physics.impactSpeed;
  const buf: number[] = [];

  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i] as Enemy;
    if (a.dead || a.state !== "launched") continue;

    grid.query(a.x, a.y, a.radius + MAX_ENEMY_RADIUS + slack, buf);
    let best = -1;
    let bestClosing = 0;
    let bnx = 0;
    let bny = 0;
    for (const j of buf) {
      if (j === i) continue;
      const b = enemies[j] as Enemy;
      if (b.dead) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > a.radius + b.radius + slack) continue;
      const nx = d > 1e-9 ? dx / d : 1;
      const ny = d > 1e-9 ? dy / d : 0;
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (closing < minClosing) continue;
      if (best < 0 || closing > bestClosing || (closing === bestClosing && j < best)) {
        best = j;
        bestClosing = closing;
        bnx = nx;
        bny = ny;
      }
    }
    if (best < 0) continue;

    const b = enemies[best] as Enemy;
    const res = resolveMatchColor(a.color, b.color);
    if (res.kind === "match") {
      const cluster = findCluster(g, best, i, res.color);
      if (cluster.length >= RULES.match.minSize) {
        popCluster(g, cluster, a, res.color);
        continue;
      }
    }
    if (res.kind === "match" || res.kind === "stick") {
      // 같은 색인데 무리가 모자람: A가 멈춰 B 옆에 붙는다. 다음 같은 색 발사를 기다리는 "짝" 상태.
      a.vx = 0;
      a.vy = 0;
      land(a);
      g.events.push({ type: "stick", a: a.id, b: b.id });
      continue;
    }

    // 다른 색: 당구
    impulse(a, b, bnx, bny);
    pushApart(a, b, 1);
    const end = RULES.physics.launchEndSpeed;
    if (speedOf(b) >= end) {
      b.state = "launched";
      b.stunT = 0;
      b.chainDepth = a.chainDepth;
      b.chainT = a.chainT;
      b.wallBounces = 0;
    } else {
      stun(b);
    }
    if (speedOf(a) < end) stun(a);
    g.events.push({ type: "bounce", a: a.id, b: b.id });
  }
}
