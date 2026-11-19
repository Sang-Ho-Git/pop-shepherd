import { DT, RULES } from "./rules.ts";
import { Rng } from "./rng.ts";
import type { CharacterDef, EnemyDef, Game, Input, StageDef, WeaponInstance } from "./types.ts";
import { SpatialHash } from "../world/spatialHash.ts";
import { integrate, separate } from "../world/physics.ts";
import { resolveImpacts } from "../combat/impacts.ts";
import { detonateBomb, shockwave } from "../combat/pops.ts";
import { tickSpawner } from "../combat/spawner.ts";
import { fireWeapons, tickTotems } from "../weapons/weapons.ts";

export interface GameConfig {
  seed: number;
  character: CharacterDef;
  enemyDefs: Record<string, EnemyDef>;
  /** null이면 아무것도 소환하지 않는다 (테스트용 빈 아레나) */
  stage: StageDef | null;
  weapons?: WeaponInstance[];
  arena?: { w: number; h: number };
}

export function createGame(cfg: GameConfig): Game {
  const arena = cfg.arena ?? { w: RULES.arena.w, h: RULES.arena.h };
  const s = cfg.character.stats;
  return {
    rng: new Rng(cfg.seed),
    tick: 0,
    time: 0,
    arena,
    player: {
      x: arena.w / 2,
      y: arena.h / 2,
      radius: RULES.player.radius,
      hp: s.max_hp,
      maxHp: s.max_hp,
      speed: RULES.player.baseSpeed * s.move_speed,
      faceX: 1,
      faceY: 0,
      iframes: 0,
      whistleCd: 0,
      stats: s,
      dead: false,
    },
    enemies: [],
    nextId: 1,
    weapons: cfg.weapons ?? [],
    totems: [],
    bombs: [],
    stage: cfg.stage,
    spawnTimer: 0,
    enemyDefs: cfg.enemyDefs,
    grid: new SpatialHash(arena.w, arena.h, 64),
    events: [],
    stats: {
      pops: 0,
      rootPops: 0,
      poppedEnemies: 0,
      killedEnemies: 0,
      maxChain: 0,
      xp: 0,
      spawned: 0,
      alivePeak: 0,
      stalls: 0,
      stallTimer: 0,
      directHits: 0,
    },
  };
}

export function rebuildGrid(g: Game): void {
  g.grid.clear();
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i];
    if (e && !e.dead) g.grid.insert(i, e.x, e.y);
  }
}

/** 1.1 이동: 8방향 입력을 정규화. 움직이면 바라보는 방향이 바뀐다. */
function movePlayer(g: Game, input: Input): void {
  const p = g.player;
  const len = Math.hypot(input.moveX, input.moveY);
  if (len > 1e-9) {
    const ux = input.moveX / len;
    const uy = input.moveY / len;
    p.x += ux * p.speed * DT;
    p.y += uy * p.speed * DT;
    p.faceX = ux;
    p.faceY = uy;
  }
  p.x = Math.min(g.arena.w - p.radius, Math.max(p.radius, p.x));
  p.y = Math.min(g.arena.h - p.radius, Math.max(p.radius, p.y));
  p.iframes = Math.max(0, p.iframes - DT);
  p.whistleCd = Math.max(0, p.whistleCd - DT);
  if (p.stats.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * DT);
}

/** 평소 상태 적: 플레이어를 향해 걷는다. */
function chase(g: Game): void {
  const p = g.player;
  for (const e of g.enemies) {
    if (e.dead || e.state !== "walk") continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) {
      e.vx = 0;
      e.vy = 0;
      continue;
    }
    e.vx = (dx / d) * e.speed;
    e.vy = (dy / d) * e.speed;
  }
}

/** 1.1 휘슬: 대형 충격파. 연쇄 단계 0, 직접 피해 없음. */
function useWhistle(g: Game): void {
  const p = g.player;
  if (p.whistleCd > 0) return;
  const hits = shockwave(g, p.x, p.y, RULES.whistle.radius * p.stats.area, RULES.whistle.knock * p.stats.knock_power, {
    chainDepth: 0,
    chainT: 0,
  });
  p.whistleCd = RULES.whistle.cooldown * (1 - p.stats.cooldown);
  g.events.push({ type: "whistle", hits });
}

/** 접촉 피해: 평소 상태 적만 아프다 (날아가는 적·기절한 적은 피해가 없다). */
function contactDamage(g: Game): void {
  const p = g.player;
  if (p.iframes > 0 || p.dead) return;
  const buf: number[] = [];
  g.grid.query(p.x, p.y, p.radius + 40, buf);
  let worst = 0;
  for (const j of buf) {
    const e = g.enemies[j];
    if (!e || e.dead || e.state !== "walk") continue;
    const reach = p.radius + e.radius + 2;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    if (dx * dx + dy * dy <= reach * reach) worst = Math.max(worst, e.contactDamage);
  }
  if (worst <= 0) return;
  const dmg = Math.max(1, worst - p.stats.armor);
  p.hp -= dmg;
  p.iframes = RULES.player.iframes;
  g.events.push({ type: "player-hit", damage: dmg, hp: p.hp });
  if (p.hp <= 0) {
    p.hp = 0;
    p.dead = true;
    g.events.push({ type: "player-dead" });
  }
}

function pickupBombs(g: Game): void {
  const p = g.player;
  const range = RULES.match.bombPickupRange * p.stats.pickup;
  const keep = [];
  for (const b of g.bombs) {
    if (Math.hypot(b.x - p.x, b.y - p.y) <= range) detonateBomb(g, b.color);
    else keep.push(b);
  }
  g.bombs = keep;
}

/** 1.6 막힘 감지: 터뜨릴 적이 3마리 이상 있는데 10초 동안 팝이 없으면 막힘 1회 */
function trackStall(g: Game, alive: number): void {
  const s = g.stats;
  if (alive < RULES.match.minSize) return;
  s.stallTimer += DT;
  if (s.stallTimer >= RULES.antiStall.stallSeconds) {
    s.stalls++;
    s.stallTimer = 0;
    g.events.push({ type: "stall" });
  }
}

/**
 * 고정 틱 한 번. 순서가 결과를 정하므로 바꾸면 테스트의 재현 해시도 바뀐다.
 *  1 이동  2 소환  3 추적·토템  4 적분  5 공간 해시  6 무기·휘슬  7 충돌 매치  8 겹침 해소
 *  9 접촉 피해  10 폭탄  11 막힘  12 죽은 적 제거
 */
export function step(g: Game, input: Input): void {
  g.events = [];
  if (g.player.dead) return;

  movePlayer(g, input);
  tickSpawner(g, DT);
  chase(g);
  tickTotems(g);
  integrate(g);
  rebuildGrid(g);
  fireWeapons(g);
  if (input.whistle) useWhistle(g);
  resolveImpacts(g);
  separate(g, []);
  contactDamage(g);
  pickupBombs(g);

  g.enemies = g.enemies.filter((e) => !e.dead);
  const alive = g.enemies.length;
  trackStall(g, alive);
  g.stats.alivePeak = Math.max(g.stats.alivePeak, alive);
  g.tick++;
  g.time = g.tick * DT;
}

/** 상태 해시 (FNV-1a, 위치·속도 비트 단위). 재현성 테스트용. */
export function stateHash(g: Game): string {
  const f = new Float64Array(1);
  const u = new Uint32Array(f.buffer);
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    f[0] = n;
    for (const word of u) {
      h ^= word;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  mix(g.tick);
  mix(g.player.x);
  mix(g.player.y);
  mix(g.player.hp);
  for (const e of g.enemies) {
    mix(e.id);
    mix(e.x);
    mix(e.y);
    mix(e.vx);
    mix(e.vy);
    mix(e.hp);
  }
  mix(g.stats.xp);
  return h.toString(16).padStart(8, "0");
}
