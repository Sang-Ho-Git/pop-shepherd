import { DT, RULES } from "./rules.ts";
import { Rng } from "./rng.ts";
import type { CharacterDef, EnemyDef, Game, Input, StageDef, WeaponInstance } from "./types.ts";
import { SpatialHash } from "../world/spatialHash.ts";
import { integrate, separate } from "../world/physics.ts";
import { resolveImpacts } from "../combat/impacts.ts";
import { detonateBomb, shockwave } from "../combat/pops.ts";
import { tickSpawner } from "../combat/spawner.ts";
import { fireWeapons, tickEffects, tickTotems } from "../weapons/weapons.ts";
import { spawnScheduled, tickBosses } from "../combat/bosses.ts";
import { openChest } from "../progression/chest.ts";
import { checkLevelUp } from "../progression/levelup.ts";

export interface GameConfig {
  seed: number;
  character: CharacterDef;
  enemyDefs: Record<string, EnemyDef>;
  /** null이면 아무것도 소환하지 않는다 (테스트용 빈 아레나) */
  stage: StageDef | null;
  weapons?: WeaponInstance[];
  arena?: { w: number; h: number };
  /** 레벨업 사용 (기본 false: 고정 구성 측정). 런 시뮬에서 켠다. */
  leveling?: boolean;
}

export function createGame(cfg: GameConfig): Game {
  if (cfg.stage?.clear === "boss" && !cfg.stage.boss) throw new Error(`${cfg.stage.id}: 보스 처치형인데 보스가 없음`);
  if (cfg.stage?.clear === "elites" && !cfg.stage.elites?.length) throw new Error(`${cfg.stage.id}: 엘리트 처치형인데 엘리트가 없음`);
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
      stats: { ...s },
      baseStats: { ...s },
      level: 1,
      passives: {},
      trait: cfg.character.trait ?? null,
      gold: 0,
      purchases: 0,
      revives: 0,
      dead: false,
    },
    enemies: [],
    nextId: 1,
    weapons: cfg.weapons ?? [],
    totems: [],
    bombs: [],
    milks: [],
    effects: [],
    chests: [],
    golds: [],
    wrapUpAt: 0,
    stage: cfg.stage,
    phase: "play",
    spawnTimer: 0,
    enemyDefs: cfg.enemyDefs,
    grid: new SpatialHash(arena.w, arena.h, 64),
    chooseCard: null,
    chooseBranch: null,
    leveling: cfg.leveling ?? false,
    events: [],
    stats: {
      pops: 0,
      rootPops: 0,
      bombPops: 0,
      bombDrops: 0,
      wrapUpPopped: 0,
      vanished: 0,
      elitesSpawned: 0,
      elitesKilled: 0,
      bossSpawned: 0,
      bossKilled: 0,
      bossKilledAt: 0,
      chestsOpened: 0,
      goldDropped: 0,
      goldPicked: 0,
      milkDrops: 0,
      milkPicked: 0,
      healed: 0,
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

/** 평소 상태 적: 플레이어를 향해 걷고, 근처 같은 색 쪽으로 조금 끌린다 (1.3 같은 색 응집). */
function chase(g: Game): void {
  const p = g.player;
  const { radius: cr, speed: cs } = RULES.cohesion;
  const buf: number[] = [];
  if (cs > 0) rebuildGrid(g);
  for (const e of g.enemies) {
    if (e.dead || e.state !== "walk") continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    e.vx = d < 1e-9 ? 0 : (dx / d) * e.speed;
    e.vy = d < 1e-9 ? 0 : (dy / d) * e.speed;
    if (cs <= 0 || e.speed <= 0 || e.color === "gray" || e.rank !== "normal") continue;
    let sx = 0;
    let sy = 0;
    g.grid.query(e.x, e.y, cr, buf);
    for (const j of buf) {
      const o = g.enemies[j];
      if (!o || o === e || o.dead || o.color !== e.color || o.rank !== "normal") continue;
      const ox = o.x - e.x;
      const oy = o.y - e.y;
      const od = Math.hypot(ox, oy);
      if (od > cr || od < 1e-9) continue;
      sx += ox / od;
      sy += oy / od;
    }
    const sl = Math.hypot(sx, sy);
    if (sl > 1e-9) {
      e.vx += (sx / sl) * cs;
      e.vy += (sy / sl) * cs;
    }
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
  const mul = g.stage?.contactMul ?? 1;
  let worst = 0;
  let sum = 0;
  for (const j of buf) {
    const e = g.enemies[j];
    if (!e || e.dead || e.state !== "walk") continue;
    const reach = p.radius + e.radius + 2;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    if (dx * dx + dy * dy > reach * reach) continue;
    worst = Math.max(worst, e.contactDamage * mul);
    sum += Math.max(1, e.contactDamage * mul - p.stats.armor);
  }
  if (worst <= 0) return;
  // "worst": 닿은 적 중 가장 센 한 마리 피해. "sum": 닿은 적마다 피해 (포위가 위험해진다).
  const dmg = RULES.player.contactMode === "sum" ? sum : Math.max(1, worst - p.stats.armor);
  p.hp -= dmg;
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

/** 우유병: 가까이 가면 최대 체력의 일부를 회복. 오래 두면 사라진다. */
function pickupMilks(g: Game): void {
  const p = g.player;
  const range = RULES.heal.pickupRange * p.stats.pickup;
  const keep = [];
  for (const m of g.milks) {
    m.t -= DT;
    if (Math.hypot(m.x - p.x, m.y - p.y) <= range) {
      const heal = Math.min(p.maxHp - p.hp, p.maxHp * RULES.heal.healFrac);
      p.hp += heal;
      g.stats.milkPicked++;
      g.stats.healed += heal;
      g.events.push({ type: "milk-pickup", heal, hp: p.hp });
    } else if (m.t > 0) keep.push(m);
  }
  g.milks = keep;
}

/** 보물 상자: 가까이 가면 연다 */
function pickupChests(g: Game): void {
  if (g.chests.length === 0) return;
  const p = g.player;
  const range = RULES.drops.pickupRange * p.stats.pickup;
  const keep = [];
  for (const c of g.chests) {
    if (Math.hypot(c.x - p.x, c.y - p.y) <= range) openChest(g, c);
    else keep.push(c);
  }
  g.chests = keep;
}

function collectGold(g: Game, amount: number): void {
  g.player.gold += amount;
  g.stats.goldPicked += amount;
  g.events.push({ type: "gold-pickup", amount });
}

/** 골드 주머니: 가까이 가면 줍는다. 오래 두면 사라진다. */
function pickupGolds(g: Game): void {
  if (g.golds.length === 0) return;
  const p = g.player;
  const range = RULES.drops.pickupRange * p.stats.pickup;
  const keep = [];
  for (const gp of g.golds) {
    gp.t -= DT;
    if (Math.hypot(gp.x - p.x, gp.y - p.y) <= range) collectGold(g, gp.amount);
    else if (gp.t > 0) keep.push(gp);
  }
  g.golds = keep;
}

/** 플레이어 화면(1280×720) 안에 있는 적 수 */
export function onScreenCount(g: Game): number {
  const hw = RULES.view.w / 2;
  const hh = RULES.view.h / 2;
  let n = 0;
  for (const e of g.enemies) if (!e.dead && Math.abs(e.x - g.player.x) <= hw && Math.abs(e.y - g.player.y) <= hh) n++;
  return n;
}

/**
 * 1.6 막힘 감지: 화면 안에 터뜨릴 적이 3마리 이상 있는데 10초 동안 팝이 없으면 막힘 1회.
 * 화면 밖에서 걸어오는 적을 기다리는 시간은 막힘이 아니다 (소환 고리 800px ÷ 추적 70px/s ≈ 11초).
 */
function trackStall(g: Game): void {
  const s = g.stats;
  if (onScreenCount(g) < RULES.match.minSize) return;
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
/** 생존형 클리어: 시간이 끝나면 마무리 시간, 그것도 끝나면 남은 적을 지우고 클리어 */
/** 이 스테이지의 목표를 이뤘는지: 생존형은 시간, 보스형은 보스 처치, 엘리트형은 엘리트 전부 처치 */
export function goalMet(g: Game): boolean {
  const st = g.stage;
  if (!st) return false;
  switch (st.clear ?? "survive") {
    case "survive":
      return g.time >= st.duration;
    case "boss":
      return g.stats.bossKilled > 0;
    case "elites":
      return g.stats.elitesKilled >= (st.elites?.length ?? 0);
  }
}

function advancePhase(g: Game): void {
  const st = g.stage;
  if (!st) return;
  if (g.phase === "play" && goalMet(g)) {
    g.phase = "wrapup";
    g.wrapUpAt = g.time;
    g.events.push({ type: "wrapup-start" });
  }
  if (g.phase === "wrapup" && g.time >= g.wrapUpAt + RULES.stage.wrapUpSeconds) {
    // 마무리 시간이 끝날 때 남은 골드 주머니와 상자는 자동으로 줍는다
    for (const gp of g.golds) collectGold(g, gp.amount);
    g.golds = [];
    for (const c of g.chests) openChest(g, c);
    g.chests = [];
    const vanished = g.enemies.length;
    g.enemies = [];
    g.totems = [];
    g.stats.vanished = vanished;
    g.phase = "cleared";
    g.events.push({ type: "stage-clear", vanished });
  }
}

export function step(g: Game, input: Input): void {
  g.events = [];
  if (g.player.dead || g.phase === "cleared" || g.phase === "failed") return;

  movePlayer(g, input);
  tickSpawner(g, DT);
  spawnScheduled(g);
  chase(g);
  tickBosses(g);
  tickTotems(g);
  integrate(g);
  rebuildGrid(g);
  fireWeapons(g);
  tickEffects(g);
  if (input.whistle) useWhistle(g);
  resolveImpacts(g);
  separate(g, []);
  // 큰 무리(100마리 이상)는 한 번으로 겹침이 다 풀리지 않는다 (야간 점검: 160마리에서 깊은 겹침). 한 번 더 돈다.
  if (g.enemies.length >= 100) separate(g, []);
  contactDamage(g);
  pickupBombs(g);
  pickupMilks(g);
  pickupChests(g);
  pickupGolds(g);

  g.enemies = g.enemies.filter((e) => !e.dead);
  const alive = g.enemies.length;
  trackStall(g);
  g.stats.alivePeak = Math.max(g.stats.alivePeak, alive);
  g.tick++;
  g.time = g.tick * DT;
  if (g.leveling) checkLevelUp(g);
  advancePhase(g);
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
