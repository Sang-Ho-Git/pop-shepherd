import { RULES } from "../core/rules.ts";
import type { Color, Enemy, Game, MatchColor } from "../core/types.ts";
import { MAX_ENEMY_RADIUS } from "../world/physics.ts";

export type MatchResolution =
  | { kind: "match"; color: MatchColor }
  /** 같은 계열이지만 색을 정할 수 없음 (무지개끼리): 멈춰 붙는다 */
  | { kind: "stick" }
  /** 다른 색 또는 회색: 튕긴다 */
  | { kind: "bounce" };

/**
 * 1.4 부딪친 두 적의 색으로 매치 여부를 정한다.
 * - 회색은 어떤 색과도 매치되지 않는다.
 * - 무지개는 어떤 색과도 이어지지만, 무지개끼리만으로는 매치되지 않는다.
 */
export function resolveMatchColor(a: Color, b: Color): MatchResolution {
  if (a === "gray" || b === "gray") return { kind: "bounce" };
  if (a === "rainbow" && b === "rainbow") return { kind: "stick" };
  if (a === "rainbow") return { kind: "match", color: b as MatchColor };
  if (b === "rainbow") return { kind: "match", color: a as MatchColor };
  if (a === b) return { kind: "match", color: a };
  return { kind: "bounce" };
}

export function touching(a: Enemy, b: Enemy): boolean {
  const reach = a.radius + b.radius + RULES.physics.contactSlack;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy <= reach * reach;
}

function joins(e: Enemy, color: MatchColor): boolean {
  return !e.dead && (e.color === color || e.color === "rainbow");
}

/**
 * 1.4 같은 색 접촉 무리 찾기 (BFS). 상태(평소·발사·기절)와 무관하게 닿아 있으면 이어진다.
 * 결과는 enemies 인덱스 배열이며, 부딪친 적(trigger)과 맞은 적(hit)을 포함한다.
 */
export function findCluster(g: Game, hit: number, trigger: number, color: MatchColor): number[] {
  const { enemies, grid } = g;
  const seen = new Set<number>([hit, trigger]);
  const out = [trigger, hit];
  const queue = [trigger, hit];
  const buf: number[] = [];
  while (queue.length > 0) {
    const idx = queue.pop() as number;
    const e = enemies[idx] as Enemy;
    grid.query(e.x, e.y, e.radius + MAX_ENEMY_RADIUS + RULES.physics.contactSlack, buf);
    for (const j of buf) {
      if (seen.has(j)) continue;
      const o = enemies[j] as Enemy;
      if (!joins(o, color) || !touching(e, o)) continue;
      seen.add(j);
      out.push(j);
      queue.push(j);
    }
  }
  return out;
}
