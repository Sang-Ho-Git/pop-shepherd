import { DT, RULES } from "../core/rules.ts";
import { MATCH_COLORS } from "../core/types.ts";
import type { Enemy, Game, Hazard, MatchColor } from "../core/types.ts";
import { spawnEnemy, spawnPoint } from "./spawner.ts";
import { hurtPlayer } from "./hurt.ts";
import { killSpecial } from "./pops.ts";

/**
 * 엘리트·보스 (기획: 로드맵 문서 "보스·엘리트·드롭" 탭, 11/24 패턴 개편: docs/2026-11-24-보스.md).
 * 매치로 터지지 않는다. 피해는 셋으로 들어간다.
 *  - 곁의 팝 (pops.ts hitSpecials): 몸 색(약점 색)과 같은 팝은 ×2
 *  - 약점 공 직격 (weakBallHit): 머리 위 약점 색 공을 몸에 바로 맞히면 최대 체력의 weakFrac, 쿠션을 거치면 더 크다
 *  - 그로기: 돌진하다 바위·울타리에 부딪히거나 보호막이 깨지면 멈추고 받는 피해 ×groggyMul (어느 색 공이든 직격)
 * 공격은 모두 바닥 경고(g.hazards)로 먼저 보여 준 뒤 판정한다: 읽고 피하는 패턴.
 */

function stageColors(g: Game): MatchColor[] {
  return g.stage?.colors.length ? g.stage.colors : [...MATCH_COLORS];
}

function otherColor(g: Game, not: string): MatchColor {
  const list = stageColors(g).filter((c) => c !== not);
  return list.length ? (list[g.rng.int(0, list.length - 1)] as MatchColor) : (stageColors(g)[0] as MatchColor);
}

/** 몸 색과 약점 색을 함께 바꾼다 (회색 돌갑옷은 그대로) */
function shiftColor(g: Game, e: Enemy): void {
  if (e.color === "gray" || !e.boss) return;
  e.color = otherColor(g, e.color);
  e.boss.weak = e.color;
}

/** 공격 피해: 적 params.hit × 스테이지 접촉 배율 × 공격 종류 배율 */
function attackDamage(g: Game, e: Enemy, act: string): number {
  const base = e.boss?.params.hit ?? e.contactDamage;
  return base * (g.stage?.contactMul ?? 1) * (RULES.boss.attackMul[act] ?? 1);
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

/** (x, y) 둘레에 졸개를 고르게 세운다. colors를 차례로 돌려 쓴다. */
function summonRing(g: Game, x: number, y: number, r: number, count: number, colors: MatchColor[]): void {
  const max = g.stage?.maxAlive ?? Infinity;
  const base = g.rng.next() * Math.PI * 2;
  for (let i = 0; i < count && g.enemies.length < max; i++) {
    const a = base + (i / count) * Math.PI * 2;
    const sx = Math.min(g.arena.w - 20, Math.max(20, x + Math.cos(a) * r));
    const sy = Math.min(g.arena.h - 20, Math.max(20, y + Math.sin(a) * r));
    spawnEnemy(g, "jelly", colors[i % colors.length] as MatchColor, sx, sy);
  }
}

/** 공격 순서 (ai별). 차례로 돌려 쓴다 */
const PATTERNS: Record<string, string[]> = {
  summoner: ["slam"],
  chameleon: ["tongue"],
  armored: ["dash"],
  wool_giant: ["slam", "fan", "dash"],
  rainbow: ["splash", "fan", "splash", "dash"],
};

/** 다음에 쓸 공격 (없으면 null). 봇이 돌진을 바위로 유인할 때 본다 */
export function nextAttack(e: Enemy): string | null {
  const b = e.boss;
  const list = b ? PATTERNS[b.ai] : undefined;
  if (!b || !list || !b.params.atkEvery) return null;
  return list[b.atkN % list.length] ?? null;
}

/** 지금 공격 중인지 (예고·돌진): 이때는 걷지 않는다 */
function busy(g: Game, e: Enemy): boolean {
  const b = e.boss!;
  return b.dashLeft > 0 || g.hazards.some((h) => h.owner === e.id);
}

/**
 * 엘리트·보스 행동. 추적(chase) 뒤, 적분 전에 돈다 (속도를 덮어쓸 수 있도록).
 * - 그로기: 멈춰 선다. 패턴·소환이 멈춘다
 * - 공격: atkEvery초마다 PATTERNS 차례대로 예고를 깐다 (예고 중에는 멈춰 선다)
 * - summoner (대장 젤리): summonEvery초마다 자기 색 summonCount마리. 공격: 내려찍기
 * - chameleon: shiftEvery초마다 몸 색(약점)이 바뀐다. 공격: 혀 (직선)
 * - armored (돌갑옷): 앞쪽 팝 피해 절반 (hitSpecials). 공격: 돌진 (바위·울타리에 박으면 그로기)
 * - wool_giant (양털 거인): 내려찍기 → 털뭉치 부채꼴 → 돌진. 내려찍은 자리에 약점 색 졸개 3마리 (약점 팝 재료)
 * - rainbow (무지개 양치기): 약점 색이 바뀐다. 물감 웅덩이 → 부채꼴 → 웅덩이 → 돌진.
 *   체력 2/3, 1/3에서 보호막: 쿠션 shieldNeed개를 모아야 깨진다 (공이 거친 쿠션 수만큼 깎인다) → 그로기
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
    // 보호막: 체력 비율 shieldAt1·shieldAt2 아래로 처음 내려가면
    // 그로기 동안에는 치지 않는다 (그로기 보상을 지우지 않게, 그로기가 끝나면 친다)
    if (p.shieldNeed && b.shield <= 0 && b.groggy <= 0) {
      const crossed = [p.shieldAt1, p.shieldAt2].filter((m) => m !== undefined && e.hp < e.maxHp * m).length;
      if (crossed > b.shields) {
        b.shields = crossed;
        b.shield = p.shieldNeed;
        b.shieldT = RULES.boss.shieldTimeout;
        g.events.push({ type: "shield-up", id: e.id, need: p.shieldNeed });
      }
    }
    if (b.shield > 0) {
      b.shieldT -= DT;
      // 못 깨면 저절로 풀린다 (그로기 없이)
      if (b.shieldT <= 0) b.shield = 0;
    }
    if (b.groggy > 0) {
      b.groggy -= DT;
      e.vx = 0;
      e.vy = 0;
      continue;
    }
    if (e.state !== "walk") continue;
    const two = b.phase === 2;
    b.summonT += DT;
    b.shiftT += DT;
    // 색 바꾸기 (카멜레온, 무지개 양치기)
    const shiftEvery = two ? (p.shiftEvery2 ?? p.shiftEvery) : p.shiftEvery;
    if (shiftEvery && b.shiftT >= shiftEvery) {
      b.shiftT = 0;
      shiftColor(g, e);
    }
    // 졸개: 약점 색 (대장 젤리는 자기 색 = 약점 색)
    const summonEvery = two ? (p.summonEvery2 ?? p.summonEvery) : p.summonEvery;
    if (summonEvery && b.summonT >= summonEvery) {
      b.summonT = 0;
      const c = (b.weak ?? stageColors(g)[0]) as MatchColor;
      summonRing(g, e.x, e.y, e.radius + RULES.boss.summonGap, p.summonCount ?? 2, [c]);
    }
    if (b.dashLeft > 0) {
      dashStep(g, e);
      continue;
    }
    if (busy(g, e)) {
      e.vx = 0;
      e.vy = 0;
      continue;
    }
    const list = PATTERNS[b.ai];
    if (!list || !p.atkEvery) continue;
    b.atkCd -= DT;
    if (b.atkCd > 0) continue;
    b.atkCd = two ? (p.atkEvery2 ?? p.atkEvery) : p.atkEvery;
    const act = list[b.atkN % list.length] as string;
    b.atkN++;
    startAttack(g, e, act);
    e.vx = 0;
    e.vy = 0;
  }
}

function hazard(g: Game, e: Enemy, h: Partial<Hazard> & Pick<Hazard, "kind" | "act" | "x" | "y" | "t">): void {
  g.hazards.push({ owner: e.id, r: 0, ang: 0, len: 0, spread: 0, total: h.t, dmg: attackDamage(g, e, h.act), ...h });
}

/** 공격 예고를 깐다 */
function startAttack(g: Game, e: Enemy, act: string): void {
  const b = e.boss!;
  const p = b.params;
  const pl = g.player;
  const ang = Math.atan2(pl.y - e.y, pl.x - e.x);
  const two = b.phase === 2;
  const windup = p.windup ?? 1;
  switch (act) {
    case "slam":
      // 내려찍기: 플레이어가 서 있던 자리
      hazard(g, e, { kind: "circle", act, x: pl.x, y: pl.y, r: p.slamR ?? 110, t: windup });
      break;
    case "splash": {
      // 물감 웅덩이: 플레이어 자리 + 양옆 둘 (피할 틈은 남긴다)
      const r = p.splashR ?? 90;
      const side = ang + Math.PI / 2;
      const gap = r * 2.3;
      for (const k of two ? [-1, 0, 1, 2] : [-1, 0, 1]) {
        const off = k === 2 ? 0 : k * gap;
        const fwd = k === 2 ? r * 2.3 : 0;
        hazard(g, e, { kind: "circle", act, x: pl.x + Math.cos(side) * off + Math.cos(ang) * fwd, y: pl.y + Math.sin(side) * off + Math.sin(ang) * fwd, r, t: windup });
      }
      break;
    }
    case "fan":
      hazard(g, e, { kind: "cone", act, x: e.x, y: e.y, ang, len: p.fanLen ?? 560, spread: ((p.fanSpread ?? 35) * Math.PI) / 180, r: two ? (p.fanN2 ?? p.fanN ?? 7) : (p.fanN ?? 7), t: windup * 0.9 });
      break;
    case "tongue":
      hazard(g, e, { kind: "line", act, x: e.x, y: e.y, ang, len: p.tongueLen ?? 340, r: p.tongueW ?? 20, t: windup * 0.85 });
      break;
    case "dash":
      hazard(g, e, { kind: "line", act, x: e.x, y: e.y, ang, len: p.dashLen ?? 600, r: e.radius, t: windup });
      break;
  }
  g.events.push({ type: "telegraph", act, id: e.id });
}

/** 점 (x, y)가 경고 영역 안인지 (pad: 여유 반지름) */
export function inHazard(h: Hazard, x: number, y: number, pad = 0): boolean {
  const dx = x - h.x;
  const dy = y - h.y;
  if (h.kind === "circle") return dx * dx + dy * dy <= (h.r + pad) ** 2;
  const ux = Math.cos(h.ang);
  const uy = Math.sin(h.ang);
  const along = dx * ux + dy * uy;
  if (h.kind === "line") return along >= -pad && along <= h.len + pad && Math.abs(dx * uy - dy * ux) <= h.r + pad;
  // cone
  const d = Math.hypot(dx, dy);
  if (d > h.len + pad || d < 1e-6) return d < 1e-6;
  let diff = Math.atan2(dy, dx) - h.ang;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff) <= h.spread + Math.asin(Math.min(1, pad / d));
}

/** 공격으로 플레이어를 친다 (무적 시간이면 빗나간다) */
function strike(g: Game, dmg: number, act: string): void {
  const p = g.player;
  if (p.iframes > 0 || p.dead) return;
  const d = Math.max(1, dmg - p.stats.armor);
  g.stats.damageFromAttacks += d;
  g.stats.damageFromSpecial += d;
  g.events.push({ type: "hazard-hit", act, damage: d });
  hurtPlayer(g, d);
}

/**
 * 예고 시간이 끝난 경고를 판정하고, 탄을 움직인다. 보스 행동 뒤에 돈다.
 * 주인이 쓰러지면 남은 예고는 사라진다 (탄은 계속 날아간다).
 */
export function tickHazards(g: Game): void {
  if (g.hazards.length === 0 && g.shots.length === 0) return;
  const byId = new Map<number, Enemy>();
  for (const e of g.enemies) if (e.boss && !e.dead) byId.set(e.id, e);
  const keep: Hazard[] = [];
  const pl = g.player;
  for (const h of g.hazards) {
    const e = byId.get(h.owner);
    // 주인이 쓰러졌거나 그로기면 깔아 둔 예고는 취소된다 (그로기가 공격을 끊는다)
    if (!e || g.phase !== "play" || e.boss!.groggy > 0) continue;
    h.t -= DT;
    if (h.t > 0) {
      keep.push(h);
      continue;
    }
    switch (h.act) {
      case "slam":
      case "splash":
      case "tongue":
        if (inHazard(h, pl.x, pl.y, pl.radius)) strike(g, h.dmg, h.act);
        if (h.act === "slam" && e.boss!.params.slamSummon) {
          // 털이 떨어져 약점 색 양이 된다: 보스 곁에서 터뜨리면 약점 팝
          const c = (e.boss!.weak ?? stageColors(g)[0]) as MatchColor;
          summonRing(g, h.x, h.y, h.r * 0.6, e.boss!.params.slamSummon, [c]);
        }
        break;
      case "fan": {
        const n = Math.max(1, Math.round(h.r));
        const sp = RULES.boss.shotSpeed * (e.boss!.params.shotSpeedMul ?? 1);
        for (let i = 0; i < n; i++) {
          const a = h.ang + (n === 1 ? 0 : -h.spread + (2 * h.spread * i) / (n - 1));
          g.shots.push({ x: e.x + Math.cos(a) * e.radius, y: e.y + Math.sin(a) * e.radius, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: RULES.boss.shotRadius, t: RULES.boss.shotLife, dmg: h.dmg, color: e.color });
        }
        break;
      }
      case "dash": {
        const b = e.boss!;
        b.dashLeft = h.len;
        const v = e.boss!.params.dashSpeed ?? 800;
        b.dashX = Math.cos(h.ang) * v;
        b.dashY = Math.sin(h.ang) * v;
        b.dashDmg = h.dmg;
        break;
      }
    }
  }
  g.hazards = keep;
  if (g.shots.length > 0) {
    const rocks = g.stage?.rocks ?? [];
    const out = [];
    for (const s of g.shots) {
      s.x += s.vx * DT;
      s.y += s.vy * DT;
      s.t -= DT;
      if (s.t <= 0 || s.x < 0 || s.y < 0 || s.x > g.arena.w || s.y > g.arena.h) continue;
      if (rocks.some((rk) => Math.hypot(s.x - rk.x, s.y - rk.y) < rk.r + s.r)) continue;
      if (Math.hypot(s.x - pl.x, s.y - pl.y) < s.r + pl.radius && pl.iframes <= 0) {
        strike(g, s.dmg, "fan");
        continue;
      }
      out.push(s);
    }
    g.shots = out;
  }
}

/** 돌진 한 틱: 바위·울타리에 박으면 그로기. 플레이어에 닿으면 피해 */
function dashStep(g: Game, e: Enemy): void {
  const b = e.boss!;
  const step = Math.hypot(b.dashX, b.dashY) * DT;
  const nx = e.x + b.dashX * DT;
  const ny = e.y + b.dashY * DT;
  const r = e.radius;
  const crashRock = (g.stage?.rocks ?? []).some((rk) => Math.hypot(nx - rk.x, ny - rk.y) < rk.r + r);
  const crashFence = nx < r || ny < r || nx > g.arena.w - r || ny > g.arena.h - r;
  if (crashRock || crashFence) {
    b.dashLeft = 0;
    e.vx = 0;
    e.vy = 0;
    b.groggy = b.params.groggyTime ?? 3;
    g.stats.groggies++;
    g.events.push({ type: "groggy", id: e.id, why: "crash" });
    return;
  }
  b.dashLeft -= step;
  e.vx = b.dashX;
  e.vy = b.dashY;
  const pl = g.player;
  if (Math.hypot(pl.x - nx, pl.y - ny) < pl.radius + r) strike(g, b.dashDmg, "dash");
  if (b.dashLeft <= 0) {
    b.dashLeft = 0;
    e.vx = 0;
    e.vy = 0;
  }
}

/** 그로기·보호막을 반영한 피해 배율 (보호막이면 0) */
export function specialDamageMul(e: Enemy): number {
  const b = e.boss;
  if (!b) return 1;
  if (b.shield > 0) return 0;
  return b.groggy > 0 ? RULES.boss.groggyMul : 1;
}

/**
 * 색 공이 엘리트·보스 몸에 맞았을 때. 공을 써 버렸으면 true (튕기지 않는다).
 * - 보호막: 공이 거친 쿠션 수만큼 깎는다 (쿠션 없는 공은 튕겨 나간다). 다 깎이면 그로기
 * - 약점 색 공 (그로기 중이면 어느 색이든): 최대 체력 × weakFrac × 쿠션 보너스 × 그로기 배율. 맞히면 약점 색이 바뀐다
 */
export function weakBallHit(g: Game, e: Enemy, color: MatchColor, cushions: number, x: number, y: number): boolean {
  const b = e.boss;
  if (!b) return false;
  if (b.shield > 0) {
    if (cushions <= 0) return false;
    b.shield = Math.max(0, b.shield - cushions);
    g.events.push({ type: "shield-chip", id: e.id, left: b.shield });
    if (b.shield === 0) {
      b.groggy = b.params.groggyTime ?? 4;
      b.dashLeft = 0;
      g.stats.groggies++;
      g.events.push({ type: "groggy", id: e.id, why: "shield" });
    }
    return true;
  }
  const groggy = b.groggy > 0;
  if (!groggy && (b.weak === null || color !== b.weak)) return false;
  const frac = b.params.weakFrac ?? 0.05;
  const dmg = e.maxHp * frac * (1 + Math.min(3, cushions) * RULES.boss.weakCushionBonus) * (groggy ? RULES.boss.groggyMul : 1);
  e.hp -= dmg;
  g.stats.specialDamage += dmg;
  g.stats.weakHits++;
  g.events.push({ type: "weak-hit", id: e.id, damage: dmg, cushions, x, y });
  if (!groggy) shiftColor(g, e);
  if (e.hp <= 0) killSpecial(g, e);
  return true;
}
