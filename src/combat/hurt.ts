import { RULES } from "../core/rules.ts";
import type { Game } from "../core/types.ts";
import { shockwave } from "./pops.ts";

/**
 * 플레이어가 피해를 입는다 (접촉·보스 공격 공통). 무적 시간을 주고, 쓰러지면 두 번째 기회를 쓰거나 실패.
 * dmg는 방어력을 뺀 뒤의 값이다.
 */
export function hurtPlayer(g: Game, dmg: number): void {
  const p = g.player;
  p.hp -= dmg;
  g.stats.damageTaken += dmg;
  p.iframes = RULES.player.iframes;
  g.events.push({ type: "player-hit", damage: dmg, hp: p.hp });
  if (p.hp <= 0 && p.revives > 0) {
    // 두 번째 기회: 체력 절반으로 일어나며 주변 적을 밀어낸다
    p.revives--;
    p.hp = p.maxHp * RULES.player.reviveHpFrac;
    p.iframes = RULES.player.reviveIframes;
    shockwave(g, p.x, p.y, RULES.whistle.radius, RULES.whistle.knock, { chainDepth: 0, chainT: 0 });
    g.events.push({ type: "player-revive" });
    return;
  }
  if (p.hp <= 0) {
    p.hp = 0;
    p.dead = true;
    g.phase = "failed";
    g.events.push({ type: "player-dead" });
  }
}
