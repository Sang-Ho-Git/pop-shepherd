import { DT, RULES } from "./rules.ts";
import { Rng } from "./rng.ts";
import type { CharacterDef, Color, EnemyDef, Game, Input, StageDef, WeaponInstance } from "./types.ts";
import { SpatialHash } from "../world/spatialHash.ts";
import { collideRocks, integrate, MAX_ENEMY_RADIUS, separate } from "../world/physics.ts";
import { resolveImpacts } from "../combat/impacts.ts";
import { detonateBomb, shockwave } from "../combat/pops.ts";
import { hurtPlayer } from "../combat/hurt.ts";
import { tickSpawner } from "../combat/spawner.ts";
import { fireWeapons, tickEffects, tickTotems, tickWalls } from "../weapons/weapons.ts";
import { spawnScheduled, tickBosses, tickHazards } from "../combat/bosses.ts";
import { openChest } from "../progression/chest.ts";
import { initBall, tickBallThrow, tickBalls } from "../combat/ball.ts";
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
  /** 색 공 규칙 (실험) */
  ballMode?: boolean;
  /** 화면용: 레벨업·상자 선택을 사람에게 맡긴다 */
  manualChoices?: boolean;
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
    walls: [],
    view: { w: RULES.view.w, h: RULES.view.h },
    wind: { dx: 0, dy: 0, t: 0, cd: cfg.stage?.wind?.every ?? 0 },
    ballMode: cfg.ballMode ?? false,
    ball: null,
    balls: [],
    golds: [],
    hazards: [],
    shots: [],
    wrapUpAt: 0,
    stage: cfg.stage,
    phase: "play",
    spawnTimer: 0,
    enemyDefs: cfg.enemyDefs,
    grid: new SpatialHash(arena.w, arena.h, 64),
    chooseCard: null,
    chooseBranch: null,
    manualChoices: cfg.manualChoices ?? false,
    choices: [],
    leveling: cfg.leveling ?? false,
    events: [],
    stats: {
      pops: 0,
      rootPops: 0,
      bombPops: 0,
      bombDrops: 0,
      wrapUpPopped: 0,
      bladeVanished: 0,
      clearXp: 0,
      vanished: 0,
      elitesSpawned: 0,
      elitesKilled: 0,
      bossSpawned: 0,
      bossKilled: 0,
      bossKilledAt: 0,
      chestsOpened: 0,
      ballsThrown: 0,
      ballPops: 0,
      cushionPops: 0,
      threeCushions: 0,
      popsBy: {},
      damageTaken: 0,
      damageFromSpecial: 0,
      damageFromAttacks: 0,
      weakHits: 0,
      groggies: 0,
      evolutions: 0,
      specialDamage: 0,
      specialHits: 0,
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
/** 맵 기믹 개울 안인지 (y만 본다: 가로 띠) */
export function inStream(g: Game, y: number): boolean {
  const st = g.stage?.streams;
  return !!st && st.some((s) => y >= s.y && y <= s.y + s.h);
}

/**
 * 맵 기믹 돌풍: 걷는 적과 플레이어는 windWalk(px/s)만큼 밀리고, 날아가는 적과 색 공은 windLaunch(px/s²)로 휜다.
 * 추적 뒤, 적분 전에 돈다 (추적이 정한 속도에 더한다).
 */
function tickWind(g: Game): void {
  const w = g.stage?.wind;
  if (!w) return;
  const s = g.wind;
  if (s.t > 0) {
    s.t -= DT;
    for (const e of g.enemies) {
      if (e.dead) continue;
      if (e.state === "walk") {
        e.vx += s.dx * RULES.terrain.windWalk;
        e.vy += s.dy * RULES.terrain.windWalk;
      } else if (e.state === "launched") {
        e.vx += s.dx * RULES.terrain.windLaunch * DT;
        e.vy += s.dy * RULES.terrain.windLaunch * DT;
      }
    }
    for (const b of g.balls) {
      b.vx += s.dx * RULES.terrain.windLaunch * DT;
      b.vy += s.dy * RULES.terrain.windLaunch * DT;
    }
    const p = g.player;
    p.x = Math.min(g.arena.w - p.radius, Math.max(p.radius, p.x + s.dx * RULES.terrain.windWalk * DT));
    p.y = Math.min(g.arena.h - p.radius, Math.max(p.radius, p.y + s.dy * RULES.terrain.windWalk * DT));
    return;
  }
  s.cd -= DT;
  if (s.cd <= 0) {
    const a = g.rng.next() * Math.PI * 2;
    s.dx = Math.cos(a);
    s.dy = Math.sin(a);
    s.t = w.duration;
    s.cd = w.every;
    g.events.push({ type: "wind-start", dx: s.dx, dy: s.dy });
  }
}

function movePlayer(g: Game, input: Input): void {
  const p = g.player;
  const len = Math.hypot(input.moveX, input.moveY);
  if (len > 1e-9) {
    const ux = input.moveX / len;
    const uy = input.moveY / len;
    const slow = inStream(g, p.y) ? RULES.terrain.streamSlow : 1;
    p.x += ux * p.speed * slow * DT;
    p.y += uy * p.speed * slow * DT;
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
  const { radius: cr, mode } = RULES.cohesion;
  const flock = mode === "flock";
  const cs = flock ? 0 : RULES.cohesion.speed;
  const groups = flock ? flockCenters(g) : null;
  const buf: number[] = [];
  if (cs > 0) rebuildGrid(g);
  for (const e of g.enemies) {
    if (e.slowT !== undefined && e.slowT > 0) e.slowT = Math.max(0, e.slowT - DT);
    if (e.dead || e.state !== "walk") continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    // 겁쟁이 양: 가까우면 도망간다
    const away = e.trait === "runner" && d < RULES.traits.runnerFlee ? -1 : 1;
    const slowK = e.slowT ? 1 - (e.slowMul ?? 0) : 1;
    const sp = e.speed * (inStream(g, e.y) ? RULES.terrain.streamSlow : 1) * slowK;
    // 무리로 걷기: 무리 중심에서 플레이어 쪽 방향을 다 같이 쓴다 (대형이 그대로 옮겨 간다)
    const gc = groups && e.groupId !== undefined ? groups.get(e.groupId) : undefined;
    if (gc && gc.n > 1) {
      const gx = p.x - gc.x;
      const gy = p.y - gc.y;
      const gd = Math.hypot(gx, gy);
      e.vx = gd < 1e-9 ? 0 : ((away * gx) / gd) * sp;
      e.vy = gd < 1e-9 ? 0 : ((away * gy) / gd) * sp;
      continue;
    }
    e.vx = d < 1e-9 ? 0 : ((away * dx) / d) * sp;
    e.vy = d < 1e-9 ? 0 : ((away * dy) / d) * sp;
    if (cs <= 0 || e.speed <= 0 || e.color === "gray" || e.rank !== "normal") continue;
    const coh = RULES.cohesion;
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
      if (coh.smooth) {
        // 닿은 거리(두 반지름 + 여유)에서 ramp에 걸쳐 0 → 1로 세지는 거리 가중
        const reach = e.radius + o.radius + RULES.physics.contactSlack;
        if (od <= reach) continue; // 이미 닿은 이웃은 끌지 않는다 (붙은 뒤 비비는 움직임 제거)
        const w = Math.min(1, (od - reach) / coh.ramp);
        sx += (ox / od) * w;
        sy += (oy / od) * w;
      } else {
        sx += ox / od;
        sy += oy / od;
      }
    }
    if (!coh.smooth) {
      const sl = Math.hypot(sx, sy);
      if (sl > 1e-9) {
        e.vx += (sx / sl) * cs * slowK;
        e.vy += (sy / sl) * cs * slowK;
      }
      continue;
    }
    // 닿지 않은 이웃들의 가중 합 (세기 최대 1)을 목표로
    let tx = 0;
    let ty = 0;
    const sl = Math.hypot(sx, sy);
    if (sl > 1e-9) {
      const k = Math.min(1, sl) / sl;
      tx = sx * k * cs;
      ty = sy * k * cs;
    }
    const cx = (e.cohX ?? 0) + (tx - (e.cohX ?? 0)) * coh.blend;
    const cy = (e.cohY ?? 0) + (ty - (e.cohY ?? 0)) * coh.blend;
    e.cohX = cx;
    e.cohY = cy;
    e.vx += cx * slowK;
    e.vy += cy * slowK;
  }
}

/**
 * 무리로 걷기(cohesion.mode "flock")용 무리 중심. 걷는 중이고 무리 색(첫 마리 색)과 같은 적만 센다.
 * 중심에서 flockLeave보다 멀거나 색이 바뀐 적은 무리를 떠난다 (groupId를 지운다).
 */
function flockCenters(g: Game): Map<number, { x: number; y: number; n: number }> {
  const acc = new Map<number, { x: number; y: number; n: number; color: Color }>();
  for (const e of g.enemies) {
    if (e.dead || e.state !== "walk" || e.groupId === undefined) continue;
    const a = acc.get(e.groupId);
    if (!a) acc.set(e.groupId, { x: e.x, y: e.y, n: 1, color: e.color });
    else if (a.color === e.color) {
      a.x += e.x;
      a.y += e.y;
      a.n++;
    } else e.groupId = undefined;
  }
  for (const a of acc.values()) {
    a.x /= a.n;
    a.y /= a.n;
  }
  const leave = RULES.cohesion.flockLeave;
  for (const e of g.enemies) {
    if (e.dead || e.state !== "walk" || e.groupId === undefined) continue;
    const a = acc.get(e.groupId)!;
    if ((e.x - a.x) ** 2 + (e.y - a.y) ** 2 > leave * leave) e.groupId = undefined;
  }
  return acc;
}

/** 1.1 휘슬: 대형 충격파. 연쇄 단계 0, 직접 피해 없음. */
function useWhistle(g: Game): void {
  const p = g.player;
  if (p.whistleCd > 0) return;
  const hits = shockwave(g, p.x, p.y, RULES.whistle.radius * p.stats.area, RULES.whistle.knock * p.stats.knock_power, {
    by: "whistle",
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
  // 가장 큰 적(보스 반지름 48)까지 닿을 수 있게 찾는다. 예전에는 +40이라 보스 접촉이 빠질 수 있었다.
  g.grid.query(p.x, p.y, p.radius + MAX_ENEMY_RADIUS + 2, buf);
  const mul = g.stage?.contactMul ?? 1;
  let worst = 0;
  let sum = 0;
  let fromSpecial = 0;
  for (const j of buf) {
    const e = g.enemies[j];
    // 그로기인 엘리트·보스는 닿아도 아프지 않다 (때릴 틈)
    if (!e || e.dead || e.state !== "walk" || (e.boss && e.boss.groggy > 0)) continue;
    const reach = p.radius + e.radius + 2;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    if (dx * dx + dy * dy > reach * reach) continue;
    worst = Math.max(worst, e.contactDamage * mul);
    const d = Math.max(1, e.contactDamage * mul - p.stats.armor);
    sum += d;
    if (e.rank !== "normal") fromSpecial += d;
  }
  if (worst <= 0) return;
  // "worst": 닿은 적 중 가장 센 한 마리 피해. "sum": 닿은 적마다 피해 (포위가 위험해진다).
  const dmg = RULES.player.contactMode === "sum" ? sum : Math.max(1, worst - p.stats.armor);
  g.stats.damageFromSpecial += RULES.player.contactMode === "sum" ? fromSpecial : 0;
  hurtPlayer(g, dmg);
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
  const hw = g.view.w / 2;
  const hh = g.view.h / 2;
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
 *  9 접촉 피해·보스 공격 판정  10 폭탄  11 막힘  12 죽은 적 제거
 */
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

/**
 * 목표를 이루면 클리어. 11/24: 생존형도 처치형도 마무리 시간 없이 바로 끝난다
 * (피드백: 팝 목표가 없는 시간제한 스테이지에서 추가 시간은 플레이만 늘렸다). wrapUpSeconds를 0보다 크게 하면 예전 마무리 시간이 돌아온다.
 * 클리어할 때 남은 적은 사라지고, 그 적들 경험치의 clearXpRatio만큼을 받는다 (마무리 시간 팝 경험치를 대신한다).
 * 남은 골드 주머니·상자·우유병은 자동으로 줍는다.
 */
function advancePhase(g: Game): void {
  const st = g.stage;
  if (!st) return;
  if (g.phase === "play" && goalMet(g)) {
    g.phase = "wrapup";
    g.hazards = [];
    g.shots = [];
    g.wrapUpAt = g.time;
    if (RULES.stage.wrapUpSeconds > 0) g.events.push({ type: "wrapup-start" });
  }
  if (g.phase === "wrapup" && g.time >= g.wrapUpAt + RULES.stage.wrapUpSeconds) {
    for (const gp of g.golds) collectGold(g, gp.amount);
    g.golds = [];
    for (const c of g.chests) openChest(g, c);
    g.chests = [];
    // 바닥에 남은 우유병도 마신다 (마무리 시간이 있을 때는 주울 틈이 있었다)
    for (const m of g.milks) {
      const heal = Math.min(g.player.maxHp - g.player.hp, g.player.maxHp * RULES.heal.healFrac);
      g.player.hp += heal;
      g.stats.milkPicked++;
      g.stats.healed += heal;
    }
    g.milks = [];
    const vanished = g.enemies.length;
    let xp = 0;
    for (const e of g.enemies) if (!e.dead && e.rank === "normal") xp += e.xp * RULES.stage.clearXpRatio;
    g.stats.xp += xp;
    g.stats.clearXp += xp;
    g.enemies = [];
    g.totems = [];
    g.stats.vanished = vanished;
    g.phase = "cleared";
    g.events.push({ type: "stage-clear", vanished, xp });
    // 클리어 경험치·보스 경험치로 오른 레벨업을 지금 처리한다 (예전에는 다음 스테이지 시작 직후에 창이 떴다)
    if (g.leveling) checkLevelUp(g);
  }
}

export function step(g: Game, input: Input): void {
  g.events = [];
  if (g.player.dead || g.phase === "failed") return;
  // 클리어한 뒤에도 쌓인 레벨업은 처리한다 (클리어 경험치로 오른 레벨을 상점 전에 고르게. 화면 모드는 한 장씩)
  if (g.phase === "cleared") {
    if (g.leveling && g.choices.length === 0) checkLevelUp(g);
    return;
  }
  // 사람이 고를 선택지가 남아 있으면 멈춘다 (화면 모드)
  if (g.choices.length > 0) return;

  movePlayer(g, input);
  if (g.ballMode) {
    if (!g.ball) initBall(g);
    tickBallThrow(g, input);
  }
  tickSpawner(g, DT);
  spawnScheduled(g);
  chase(g);
  tickBosses(g);
  tickWind(g);
  tickTotems(g);
  integrate(g);
  tickWalls(g);
  collideRocks(g);
  rebuildGrid(g);
  tickBalls(g);
  fireWeapons(g);
  tickEffects(g);
  if (input.whistle) useWhistle(g);
  resolveImpacts(g);
  separate(g, []);
  // 큰 무리(100마리 이상)는 한 번으로 겹침이 다 풀리지 않는다 (야간 점검: 160마리에서 깊은 겹침). 한 번 더 돈다.
  if (g.enemies.length >= 100) separate(g, []);
  contactDamage(g);
  tickHazards(g);
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
