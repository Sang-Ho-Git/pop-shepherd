import { DT, RULES } from "../core/rules.ts";
import { MATCH_COLORS } from "../core/types.ts";
import type { Enemy, Game, MatchColor } from "../core/types.ts";
import { spawnEnemy, spawnPoint } from "./spawner.ts";

/**
 * 엘리트·보스 (기획: 로드맵 문서 "보스·엘리트·드롭" 탭).
 * 매치로 터지지 않고 곁의 팝에 피해를 입는다 (pops.ts hitSpecials). 여기서는 등장과 행동만 다룬다.
 */

function stageColors(g: Game): MatchColor[] {
  return g.stage?.colors.length ? g.stage.colors : [...MATCH_COLORS];
}

function otherColor(g: Game, not: string): MatchColor {
  const list = stageColors(g).filter((c) => c !== not);
  return list.length ? (list[g.rng.int(0, list.length - 1)] as MatchColor) : (stageColors(g)[0] as MatchColor);
}

/** 정해진 시각이 된 엘리트·보스를 화면 밖에서 들여보낸다 */
export function spawnScheduled(g: Game): void {
  const st = g.stage;
  if (!st || g.phase !== "play") return;
  const elites = st.elites ?? [];
  while (g.stats.elitesSpawned < elites.length && g.time >= (elites[g.stats.elitesSpawned] as { at: number }).at) {
    const { kind } = elites[g.stats.elitesSpawned] as { kind: string };
    const at = spawnPoint(g);
    const color = kind === "armored" ? "gray" : (stageColors(g)[g.rng.int(0, stageColors(g).length - 1)] as MatchColor);
    const e = spawnEnemy(g, kind, color, at.x, at.y);
    e.hp *= st.eliteHpMul ?? 1;
    e.maxHp = e.hp;
    g.stats.elitesSpawned++;
    g.events.push({ type: "elite-spawn", kind, id: e.id });
  }
  if (st.boss && g.stats.bossSpawned === 0 && g.time >= st.boss.at) {
    const at = spawnPoint(g);
    const color = stageColors(g)[g.rng.int(0, stageColors(g).length - 1)] as MatchColor;
    const e = spawnEnemy(g, st.boss.kind, color, at.x, at.y);
    g.stats.bossSpawned = 1;
    g.events.push({ type: "boss-spawn", kind: st.boss.kind, id: e.id });
  }
}

/** 보스 둘레에 졸개를 고르게 세운다. colors를 차례로 돌려 쓴다. */
function summonRing(g: Game, e: Enemy, count: number, colors: MatchColor[]): void {
  const max = g.stage?.maxAlive ?? Infinity;
  const r = e.radius + RULES.boss.summonGap;
  const base = g.rng.next() * Math.PI * 2;
  for (let i = 0; i < count && g.enemies.length < max; i++) {
    const a = base + (i / count) * Math.PI * 2;
    const x = Math.min(g.arena.w - 20, Math.max(20, e.x + Math.cos(a) * r));
    const y = Math.min(g.arena.h - 20, Math.max(20, e.y + Math.sin(a) * r));
    spawnEnemy(g, "jelly", colors[i % colors.length] as MatchColor, x, y);
  }
}

/** 소환 색: 앞 절반은 a, 뒤 절반은 b (원 위에서 같은 색끼리 이웃하게) */
function halves(count: number, a: MatchColor, b: MatchColor): MatchColor[] {
  return Array.from({ length: count }, (_, i) => (i < count / 2 ? a : b));
}

/**
 * 엘리트·보스 행동. 추적(chase) 뒤, 적분 전에 돈다 (속도를 덮어쓸 수 있도록).
 * - summoner (대장 젤리): summonEvery초마다 자기 색 summonCount마리
 * - chameleon: shiftEvery초마다 몸 색(약점)이 바뀐다
 * - armored (돌갑옷): 행동 없음 (앞쪽 팝 피해 절반은 hitSpecials에서)
 * - wool_giant (양털 거인): 6초마다 두 색 졸개 6마리. 2단계: 5초마다 소환, 8초마다 1초 예고 뒤 1.2초 돌진
 * - rainbow (무지개 양치기): 12초마다 약점 색 바뀜, 5초마다 약점 색 3 + 다른 색 3. 2단계: 8초·4초, 8초마다 물감 폭발
 */
export function tickBosses(g: Game): void {
  for (const e of g.enemies) {
    const b = e.boss;
    if (!b || e.dead) continue;
    const p = b.params;
    if (b.phase === 1 && e.rank === "boss" && e.hp < e.maxHp * 0.5) {
      b.phase = 2;
      g.events.push({ type: "boss-phase", id: e.id, phase: 2 });
    }
    const two = b.phase === 2;
    b.summonT += DT;
    b.shiftT += DT;
    switch (b.ai) {
      case "summoner":
        if (b.summonT >= (p.summonEvery ?? 8)) {
          b.summonT = 0;
          summonRing(g, e, p.summonCount ?? 2, [e.color as MatchColor]);
        }
        break;
      case "chameleon":
        if (b.shiftT >= (p.shiftEvery ?? 10)) {
          b.shiftT = 0;
          e.color = otherColor(g, e.color);
        }
        break;
      case "wool_giant": {
        if (b.summonT >= (two ? (p.summonEvery2 ?? 5) : (p.summonEvery ?? 6))) {
          b.summonT = 0;
          summonRing(g, e, p.summonCount ?? 6, halves(p.summonCount ?? 6, e.color as MatchColor, otherColor(g, e.color)));
        }
        if (two) dash(g, e);
        break;
      }
      case "rainbow": {
        if (b.shiftT >= (two ? (p.shiftEvery2 ?? 8) : (p.shiftEvery ?? 12))) {
          b.shiftT = 0;
          e.color = otherColor(g, e.color);
        }
        if (b.summonT >= (two ? (p.summonEvery2 ?? 4) : (p.summonEvery ?? 5))) {
          b.summonT = 0;
          summonRing(g, e, p.summonCount ?? 6, halves(p.summonCount ?? 6, e.color as MatchColor, otherColor(g, e.color)));
        }
        if (two) {
          b.blastT += DT;
          if (b.blastT >= (p.blastEvery ?? 8)) {
            b.blastT = 0;
            paintBlast(g, e, p.blastRadius ?? 180);
          }
        }
        break;
      }
    }
  }
}

/** 돌진: dashEvery초마다 dashWindup초 멈춰 예고한 뒤, 그때의 플레이어 방향으로 dashTime초 동안 dashMul배 속도 */
function dash(g: Game, e: Enemy): void {
  const b = e.boss!;
  const p = b.params;
  if (b.dashT > 0) {
    b.dashT -= DT;
    e.vx = b.dashX;
    e.vy = b.dashY;
    return;
  }
  if (b.windup > 0) {
    b.windup -= DT;
    e.vx = 0;
    e.vy = 0;
    if (b.windup <= 0) {
      const dx = g.player.x - e.x;
      const dy = g.player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = e.speed * (p.dashMul ?? 3);
      b.dashX = (dx / d) * v;
      b.dashY = (dy / d) * v;
      b.dashT = p.dashTime ?? 1.2;
    }
    return;
  }
  b.dashCd -= DT;
  if (b.dashCd <= 0) {
    b.dashCd = p.dashEvery ?? 8;
    b.windup = p.dashWindup ?? 1;
  }
}

/** 물감 폭발: 반경 안 일반 적의 색을 무작위로 바꿔 무리를 흩뜨린다 */
function paintBlast(g: Game, e: Enemy, radius: number): void {
  const colors = stageColors(g);
  for (const o of g.enemies) {
    if (o.dead || o.rank !== "normal" || o.color === "gray" || o.color === "rainbow") continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) > radius + o.radius) continue;
    o.color = colors[g.rng.int(0, colors.length - 1)] as MatchColor;
  }
}
