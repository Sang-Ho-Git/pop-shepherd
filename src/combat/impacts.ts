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
      if (a.fx?.pierced?.includes(b.id) || b.fx?.pierced?.includes(a.id)) continue;
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
    // 엘리트·보스는 매치 무리에 끼지 않는다: 늘 당구처럼 튕긴다
    const res = a.rank !== "normal" || b.rank !== "normal" || a.wetT > 0 || b.wetT > 0 ? ({ kind: "bounce" } as const) : resolveMatchColor(a.color, b.color);
    // 색 공 규칙: 내 공이 일으킨 발사(공 팝의 연쇄 포함)만 터뜨린다. 무기·범퍼가 날린 적은 붙기만 한다.
    const canPop = !g.ballMode || a.cause === "ball";
    if (res.kind === "match" && canPop) {
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
    const fx = a.fx;
    const avx = a.vx;
    const avy = a.vy;
    impulse(a, b, bnx, bny);
    pushApart(a, b, 1);
    if (fx?.pierce && fx.pierce > 0) {
      // 관통: A는 속도를 잃지 않고 지나간다
      a.vx = avx;
      a.vy = avy;
      fx.pierce--;
      (fx.pierced ??= []).push(b.id);
    }
    const end = RULES.physics.launchEndSpeed;
    if (fx?.stunOnHit) {
      // 강타: 부딪힌 적은 날아가지 않고 그 자리에 기절한다
      b.vx = 0;
      b.vy = 0;
      stun(b);
      b.stunT = fx.stunOnHit;
    } else if (speedOf(b) >= end) {
      b.state = "launched";
      b.stunT = 0;
      // 이전 발사의 원인이 남아 있으면 무기가 날린 적이 공 팝으로 오인되어 저절로 터진다. 무기 원인만 물려받는다 (공 원인은 예전처럼 비운다).
      b.cause = a.cause === "ball" ? null : a.cause;
      b.chainDepth = a.chainDepth;
      b.chainT = a.chainT;
      b.wallBounces = 0;
      b.shot = false;
      b.fx = null;
      // 큐의 쓰리쿠션 (캐롬): 큐의 무기로 날린 적에 맞아 날아간 적은 '쿠션을 거친 샷'으로 친다.
      if (a.shot && g.player.trait === "three_cushion") {
        b.shot = true;
        b.wallBounces = 1;
      }
    } else {
      stun(b);
    }
    if (speedOf(a) < end) stun(a);
    g.events.push({ type: "bounce", a: a.id, b: b.id });
  }
}
