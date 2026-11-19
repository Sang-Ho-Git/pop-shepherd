import type { Rng } from "./rng.ts";
import type { SpatialHash } from "../world/spatialHash.ts";

/** 젤리 4색 + 무지개(모든 색과 이어짐) + 회색(매치 불가) */
export type Color = "red" | "blue" | "yellow" | "green" | "rainbow" | "gray";
export const MATCH_COLORS = ["red", "blue", "yellow", "green"] as const;
export type MatchColor = (typeof MATCH_COLORS)[number];

/** 1.3 적 상태: 평소 → 발사 → 기절 → (팝 / 처치는 dead 플래그로 표시하고 그 틱에 제거) */
export type EnemyState = "walk" | "launched" | "stunned";

export interface EnemyDef {
  id: string;
  name: string;
  radius: number;
  /** 날리는 힘 ÷ 질량 = 발사 속도 */
  mass: number;
  hp: number;
  /** 평소 상태 추적 속도 (px/s) */
  speed: number;
  contactDamage: number;
  /** 매치로 터뜨렸을 때 경험치 */
  xp: number;
}

export interface Enemy {
  id: number;
  kind: string;
  color: Color;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  hp: number;
  speed: number;
  contactDamage: number;
  xp: number;
  state: EnemyState;
  /** 기절 남은 시간 */
  stunT: number;
  /** 연쇄 단계 (팝 충격파로 날아간 적만 1 이상) */
  chainDepth: number;
  /** 연쇄 인정 남은 시간. 0이 되면 chainDepth도 0 */
  chainT: number;
  /** 이번 발사에서 울타리에 튕긴 횟수 (쿠션샷 판정) */
  wallBounces: number;
  dead: boolean;
}

/** 캐릭터 능력치 (기획서 v2 3. 능력치 체계) */
export interface CharacterStats {
  max_hp: number;
  move_speed: number;
  knock_power: number;
  cooldown: number;
  area: number;
  chain_radius: number;
  direct_dmg: number;
  pickup: number;
  armor: number;
  regen: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  startWeapon: string;
  stats: CharacterStats;
}

export interface Player {
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  /** 마지막 이동 방향 (단위 벡터). 처음에는 오른쪽. */
  faceX: number;
  faceY: number;
  iframes: number;
  whistleCd: number;
  stats: CharacterStats;
  dead: boolean;
}

/** 무기 동작 모듈 */
export type WeaponBehavior = "pulse" | "directional" | "zone" | "pull" | "projectile" | "orbit" | "wall";

/** 밸런스 시트 한 줄 (LP 계산용 값 + 동작 파라미터) */
export interface WeaponLevel {
  lv: number | "evo";
  branch: string | null;
  knock: number;
  /** 보조 가치 (날리는 힘 등가) */
  support: number;
  /** 시트의 타격 수 가정값. 시뮬은 실측값을 따로 잰다. */
  targets: number;
  aim: number;
  cooldown: number;
  damage: number;
  /** 동작 모듈이 쓰는 값 (반경, 사거리, 지속 시간 등) */
  params: Record<string, number>;
  note: string;
}

export interface WeaponDef {
  id: string;
  name: string;
  behavior: WeaponBehavior;
  tags: string[];
  /** 이 무기의 동작 모듈이 구현되어 시뮬에 쓸 수 있는지 */
  implemented: boolean;
  levels: WeaponLevel[];
}

export interface SpawnPhase {
  from: number;
  to: number;
  /** 무리 하나를 소환하는 간격 (s) */
  interval: number;
  /** 이 구간에 나오는 색. 없으면 스테이지 colors 전체. 초반에 색 수를 줄여 짝이 맞을 기회를 늘린다. */
  colors?: MatchColor[];
}

export interface StageDef {
  id: string;
  name: string;
  duration: number;
  colors: MatchColor[];
  /** 무리 대신 회색 1마리가 나올 확률 */
  grayRatio: number;
  maxAlive: number;
  enemyHpMul: number;
  spawn: SpawnPhase[];
}

export interface Input {
  moveX: number;
  moveY: number;
  whistle: boolean;
}

export const NO_INPUT: Input = { moveX: 0, moveY: 0, whistle: false };

export interface WeaponInstance {
  def: WeaponDef;
  level: WeaponLevel;
  cd: number;
  fires: number;
  /** 발사로 맞힌 적 수 합계 (실측 타격 수 = hits / fires) */
  hits: number;
}

export interface Totem {
  x: number;
  y: number;
  radius: number;
  color: Color;
  t: number;
  pullSpeed: number;
}

export interface Bomb {
  x: number;
  y: number;
  color: MatchColor;
}

export type GameEvent =
  | { type: "pop"; ids: number[]; size: number; color: Color; chainDepth: number; xp: number; cushion: boolean; x: number; y: number }
  | { type: "kill"; id: number; xp: number }
  | { type: "bounce"; a: number; b: number }
  | { type: "stick"; a: number; b: number }
  | { type: "bomb-drop"; color: MatchColor; x: number; y: number }
  | { type: "bomb-pickup"; color: MatchColor; count: number }
  | { type: "fire"; weapon: string; hits: number }
  | { type: "whistle"; hits: number }
  | { type: "player-hit"; damage: number; hp: number }
  | { type: "player-dead" }
  | { type: "stall" };

export interface Stats {
  /** 팝 이벤트 수 */
  pops: number;
  /** 연쇄의 시작이 된 팝 (chainDepth 0) 수 */
  rootPops: number;
  poppedEnemies: number;
  killedEnemies: number;
  maxChain: number;
  xp: number;
  spawned: number;
  alivePeak: number;
  stalls: number;
  /** 팝 없이 지난 시간. 터뜨릴 적이 3마리 이상 있을 때만 흐른다. */
  stallTimer: number;
  /** 무기 발사로 직접 피해를 준 횟수 */
  directHits: number;
}

export interface Game {
  rng: Rng;
  tick: number;
  time: number;
  arena: { w: number; h: number };
  player: Player;
  enemies: Enemy[];
  nextId: number;
  weapons: WeaponInstance[];
  totems: Totem[];
  bombs: Bomb[];
  stage: StageDef | null;
  spawnTimer: number;
  enemyDefs: Record<string, EnemyDef>;
  grid: SpatialHash;
  events: GameEvent[];
  stats: Stats;
}
