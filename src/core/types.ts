import type { Rng } from "./rng.ts";
import type { SpatialHash } from "../world/spatialHash.ts";

/** 젤리 4색 + 무지개(모든 색과 이어짐) + 회색(매치 불가) */
export type Color = "red" | "blue" | "yellow" | "green" | "rainbow" | "gray";
export const MATCH_COLORS = ["red", "blue", "yellow", "green"] as const;
export type MatchColor = (typeof MATCH_COLORS)[number];

/** 1.3 적 상태: 평소 → 발사 → 기절 → (팝 / 처치는 dead 플래그로 표시하고 그 틱에 제거) */
export type EnemyState = "walk" | "launched" | "stunned";

export type EnemyRank = "normal" | "elite" | "boss";

/** 엘리트·보스의 행동 상태 */
export interface BossState {
  ai: string;
  params: Record<string, number>;
  /** 1단계 / 2단계 (체력 절반 아래) */
  phase: 1 | 2;
  summonT: number;
  shiftT: number;
  /** 돌진 속도 (px/s) */
  dashX: number;
  dashY: number;
  /** 약점 색: 이 색 공을 직접 맞히면 큰 피해 (null이면 약점 공 없음, 돌갑옷) */
  weak: MatchColor | null;
  /** 그로기 남은 시간: 멈추고 패턴을 쓰지 않으며 받는 피해 ×RULES.boss.groggyMul */
  groggy: number;
  /** 보호막: 남은 쿠션 수 (0이면 없음). 공이 거친 쿠션 수만큼 깎인다 */
  shield: number;
  /** 다음 공격 패턴까지 남은 시간, 지금까지 쓴 패턴 수 (순서대로 돌린다) */
  atkCd: number;
  atkN: number;
  /** 돌진 남은 거리 (px), 돌진 중 몸통 피해 */
  dashLeft: number;
  dashDmg: number;
  /** 보호막 저절로 풀리기까지 남은 시간, 지금까지 친 보호막 수 */
  shieldT: number;
  shields: number;
}

/**
 * 바닥 경고 (보스·엘리트 공격 예고). t초 동안 경고만 보이고, 0이 되는 틱에 판정한다.
 * - circle: (x, y) 반지름 r 안이면 맞는다
 * - line: (x, y)에서 ang 방향 len 길이, 폭 2r (돌진 경로. 판정은 돌진하는 몸으로 한다)
 * - cone: (x, y)에서 ang ± spread, 길이 len (부채꼴 탄막 예고. 판정은 탄으로 한다)
 */
export interface Hazard {
  kind: "circle" | "line" | "cone";
  /** 무엇의 예고인지: slam(내려찍기), dash(돌진), fan(탄막), splash(물감 웅덩이), tongue(혀) */
  act: string;
  owner: number;
  x: number;
  y: number;
  r: number;
  ang: number;
  len: number;
  spread: number;
  t: number;
  total: number;
  dmg: number;
}

/** 보스 탄 (털뭉치·물감): 곧게 날아가 플레이어에 닿으면 피해, 울타리·바위에 닿으면 사라진다 */
export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  dmg: number;
  color: Color;
}

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
  /** 일반 / 엘리트 / 보스. 엘리트·보스는 매치로 터지지 않고 곁의 팝에 피해를 입는다 */
  rank?: EnemyRank;
  /** 일반 적의 기믹: spiky(무기로 밀리지 않음), runner(가까이 오면 도망) */
  trait?: string;
  /** 엘리트·보스의 행동 (summoner, chameleon, armored, wool_giant, rainbow) */
  ai?: string;
  params?: Record<string, number>;
}

/** 무기 Lv4 이후 갈래가 날린 적에 붙이는 효과 */
export interface LaunchFx {
  /** 이 적에 부딪힌 다른 색 적을 기절시키는 시간 (s). 킥 강타 */
  stunOnHit?: number;
  /** 착지할 때 일으키는 작은 충격파 반경. 킥 강타 완성 */
  landShock?: number;
  /** 감속 계수 배율 (1보다 작으면 더 멀리 난다). 집중파 완성 */
  dampMul?: number;
  /** 다른 색 적을 뚫고 지나가는 남은 횟수. 올가미 투척 완성 */
  pierce?: number;
  /** 같은 색을 찾아가는 회전 속도 (rad/s). 킥 진화 핀볼 */
  homing?: number;
  /** 이미 뚫고 지나간 적 id (같은 적에 다시 부딪히지 않게) */
  pierced?: number[];
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
  /** 같이 소환된 짝의 무리 번호 (첫 마리 id). RULES.cohesion.mode가 "flock"일 때 같이 걷는다 */
  groupId?: number;
  /** 플레이어 무기로 날린 적인지 (큐의 쓰리쿠션 판정용). 팝 충격파·휘슬·당구로 날아간 적은 false */
  shot: boolean;
  /** 무기 갈래가 이번 발사에 붙인 효과. 착지·기절하면 사라진다. */
  fx: LaunchFx | null;
  rank: EnemyRank;
  /** 일반 적의 기믹 (EnemyDef.trait) */
  trait: string | null;
  /** 마지막으로 이 적을 움직이거나 칠한 것 (무기 id, ball, whistle, chain:무기 …). 팝을 누가 일으켰는지 세는 데 쓴다 */
  cause: string | null;
  maxHp: number;
  /** 칠한 물감이 마르는 남은 시간 (s). 0보다 크면 매치에 끼지 않는다 */
  wetT: number;
  /** 회오리(색 공 규칙) 둔화: 남은 시간 (s)과 줄이는 비율 (0.4 = 40% 느리게, 1 = 멈춤) */
  slowT?: number;
  slowMul?: number;
  /** 같은 색 응집 끌림 벡터 (px/s, 틱마다 목표로 보간해 급하게 꺾이지 않게). RULES.cohesion.smooth일 때만 쓴다 */
  cohX?: number;
  cohY?: number;
  /** 회오리 칼날에 맞은 횟수 (색 공 규칙: strikes번이면 사라진다) */
  bladeHits?: number;
  boss: BossState | null;
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
  /** 레어 드롭(색 폭탄) 확률 배율 가산: 확률 × (1 + luck) */
  luck: number;
  /** 우유병 드롭 확률 가산: 확률 × (1 + heal_find) */
  heal_find: number;
  /** 골드 획득 배율 증가 (영구 강화 알뜰) */
  gold_find: number;
  /** 무기로 날린 적이 울타리에서 속도를 덜 잃고(RULES.physics.elasticKeep) 튕기는 횟수 (패시브 탄성) */
  bounce: number;
  /** 짝마다 무지개 젤리가 함께 나올 확률 (패시브 무지개 잉크) */
  rainbow: number;
  /** 색 공 조준 보정 각도 (도). 180 이상이면 완전 자동 (패시브 길잡이 별) */
  aim_assist: number;
}

export interface PassiveDef {
  id: string;
  name: string;
  maxLevel: number;
  implemented: boolean;
  /** 색 공 규칙에서만 카드로 나온다 */
  ballOnly?: boolean;
  /** 레벨마다 더해지는 능력치 */
  perLevel: Partial<CharacterStats>;
  note: string;
}

export interface CharacterDef {
  id: string;
  name: string;
  startWeapon: string;
  /** 고유 특성 id (예: three_cushion) */
  trait?: string;
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
  /** 캐릭터 기본 능력치 (패시브를 더하기 전) */
  baseStats: CharacterStats;
  /** 런 레벨 (경험치로 오름) */
  level: number;
  /** 보유 패시브와 레벨 */
  passives: Record<string, number>;
  /** 캐릭터 고유 특성 id */
  trait: string | null;
  /** 정비 상점에 쓰는 골드 (스테이지를 넘어 이어진다) */
  gold: number;
  /** 이번 런에 상점에서 산 횟수 (가격 인상) */
  purchases: number;
  /** 남은 부활 횟수 (영구 강화 두 번째 기회) */
  revives: number;
  /** 영구 강화 당구 가지: 색 공 쿨다운 감소 비율 (0~1), 쿠션 보너스 배율 증가 (0이면 기본) */
  ballCooldownCut?: number;
  cushionBonusUp?: number;
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
  /** 진화에 필요한 패시브 (Lv7에서 이 패시브를 가지고 있으면 진화 카드가 나온다) */
  evolvesWith?: string;
  implemented: boolean;
  levels: WeaponLevel[];
}

export interface SpawnPhase {
  from: number;
  to: number;
  /** 무리 하나를 소환하는 간격 (s) */
  interval: number;
  /** 이 구간에 소환되는 적의 추적 속도 배율 (기본 1) */
  speedMul?: number;
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
  /** 접촉 피해 배율 (기본 1). 방어는 배율을 곱한 뒤에 빼므로, 배율이 오를수록 방어의 비중이 줄어든다. */
  contactMul?: number;
  /**
   * 클리어 조건. "survive"(기본): duration 동안 버틴 뒤 마무리 시간을 지나면 클리어.
   * "elites", "boss"는 엘리트·보스가 구현되면 쓴다.
   */
  clear?: "survive" | "elites" | "boss";
  /** 엘리트 체력 배율 (기본 1). 후반 스테이지 엘리트가 바로 녹지 않게 */
  eliteHpMul?: number;
  /** 짝으로 나오는 적 종류의 가중치 (젤리는 1). 예: { spiky: 0.15 } */
  mix?: Record<string, number>;
  /** 맵 기믹: 개울 (가로 띠, y부터 h 높이). 안에서는 걷는 속도가 느려진다 */
  streams?: { y: number; h: number }[];
  /** 맵 기믹: 돌풍. every초마다 duration초 동안 한 방향으로 분다 */
  wind?: { every: number; duration: number };
  /** 맵 기믹: 안개 (화면 전용. 플레이어 둘레만 보인다) */
  fog?: boolean;
  /** 맵 기믹: 바위 (길을 막고, 날아간 적은 울타리처럼 튕긴다) */
  rocks?: { x: number; y: number; r: number; bumper?: boolean }[];
  /** 무리 하나에 나오는 짝 수 [최소, 최대] (기본 RULES.spawn) */
  pairs?: number[];
  /** 정해진 시각에 나오는 엘리트 (시각 순) */
  elites?: { at: number; kind: string }[];
  /** 보스 (처치형 스테이지) */
  boss?: { at: number; kind: string };
  spawn: SpawnPhase[];
}

/** 한 판의 진행 상태: 진행 중 → 마무리 시간(소환 멈춤) → 클리어, 또는 사망으로 실패 */
export type StagePhase = "play" | "wrapup" | "cleared" | "failed";

/** 레벨업 카드 */
export type Card =
  | { kind: "weaponUp"; id: string; /** Lv3 → Lv4에서 고르는 갈래 */ branch?: string }
  | { kind: "evolve"; id: string }
  | { kind: "gold" }
  | { kind: "newWeapon"; id: string }
  | { kind: "passiveUp"; id: string }
  | { kind: "newPassive"; id: string }
  | { kind: "heal" };

export interface Input {
  moveX: number;
  moveY: number;
  whistle: boolean;
  /** 색 공 조준점 (월드 좌표). 없으면 바라보는 방향 */
  aimX?: number;
  aimY?: number;
  /** 색 공 던지기 (색 공 규칙일 때만) */
  throwBall?: boolean;
  /** 지금 공과 다음 공 바꾸기 (누르는 순간 한 번) */
  swapBall?: boolean;
}

export const NO_INPUT: Input = { moveX: 0, moveY: 0, whistle: false };

export interface WeaponInstance {
  def: WeaponDef;
  level: WeaponLevel;
  cd: number;
  fires: number;
  /** 발사로 맞힌 적 수 합계 (실측 타격 수 = hits / fires) */
  hits: number;
  /** 회오리: 칼날 각도, 이번 회전에 흐른 시간, 적마다 마지막으로 맞은 시각 */
  angle?: number;
  spin?: number;
  lastHit?: Map<number, number>;
  /** 회오리(색 공 규칙): 이번 바퀴에 친 적 수 (cap까지) */
  bite?: number;
}

/** 반사벽 한 장 (선분) */
export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
  weapon: WeaponInstance;
  /** 튕길 때 속도 배율 (가속 벽) */
  boost: number;
  /** 튕긴 방향을 가장 가까운 같은 색 쪽으로 보정 (7A, 진화) */
  aimAssist: boolean;
  /** 벽에 부딪힐 때 작은 충격파 반경 (7B) */
  shock: number;
}

export type DelayedEffect =
  /** 플레이어 자리에서 다시 나가는 충격파 (이중파) */
  | { kind: "pulse"; t: number; weapon: WeaponInstance; radius: number; knock: number; coneDeg: number | null }
  /** 고정 지점의 작은 충격파 (착지 충격파) */
  | { kind: "shock"; t: number; x: number; y: number; radius: number; knock: number };

export interface Totem {
  x: number;
  y: number;
  radius: number;
  color: Color;
  t: number;
  pullSpeed: number;
  /** 지속 시간 동안 한 번이라도 끌어당긴 적 id (실측 타격 수) */
  pulled: Set<number>;
  /** 이 토템을 세운 무기. 새로 끌린 적마다 hits를 올린다. */
  weapon: WeaponInstance | null;
  /** 압축 매치 (Lv4B) */
  contact?: boolean;
  /** 압축 팝이 충격파를 일으킴 (Lv7B) */
  popShock?: boolean;
  /** 모든 색을 끌어와 이 색으로 칠함 (진화) */
  prism?: boolean;
}

export interface Milk {
  x: number;
  y: number;
  /** 남은 시간 (s) */
  t: number;
}

export interface Bomb {
  x: number;
  y: number;
  color: MatchColor;
}

export type GameEvent =
  | { type: "pop"; ids: number[]; size: number; color: Color; chainDepth: number; xp: number; cushion: boolean; cushions: number; x: number; y: number; by?: string }
  | { type: "kill"; id: number; xp: number }
  | { type: "bounce"; a: number; b: number }
  | { type: "stick"; a: number; b: number }
  | { type: "bomb-drop"; color: MatchColor; x: number; y: number }
  | { type: "bomb-pickup"; color: MatchColor; count: number }
  | { type: "milk-drop"; x: number; y: number }
  | { type: "milk-pickup"; heal: number; hp: number }
  | { type: "elite-spawn"; kind: string; id: number }
  | { type: "boss-spawn"; kind: string; id: number }
  | { type: "boss-phase"; id: number; phase: 2 }
  | { type: "special-hit"; id: number; damage: number; hp: number }
  /** 약점 색 공 직격 (cushions: 공이 거친 쿠션 수) */
  | { type: "weak-hit"; id: number; damage: number; cushions: number; x: number; y: number }
  | { type: "groggy"; id: number; why: "crash" | "shield" }
  | { type: "shield-up"; id: number; need: number }
  | { type: "shield-chip"; id: number; left: number }
  | { type: "telegraph"; act: string; id: number }
  | { type: "hazard-hit"; act: string; damage: number }
  | { type: "special-killed"; id: number; kind: string; rank: EnemyRank }
  | { type: "chest-drop"; kind: "elite" | "boss"; x: number; y: number }
  | { type: "chest-open"; kind: "elite" | "boss"; evolved: string[]; picked: string[] }
  | { type: "gold-pickup"; amount: number }
  | { type: "ball-throw"; color: MatchColor }
  | { type: "ball-miss"; x: number; y: number }
  | { type: "ball-cushion"; x: number; y: number; n: number }
  | { type: "ball-swap" }
  | { type: "wind-start"; dx: number; dy: number }
  | { type: "ball-bounce"; id: number; x: number; y: number }
  | { type: "ball-stick"; id: number; x: number; y: number }
  /** ids: 이번 발사로 맞힌(날리거나 끌어당긴) 적 */
  | { type: "fire"; weapon: string; hits: number; ids: number[] }
  | { type: "whistle"; hits: number }
  | { type: "player-hit"; damage: number; hp: number }
  | { type: "player-dead" }
  | { type: "player-revive" }
  | { type: "evolve"; weapon: string }
  | { type: "wrapup-start" }
  /** 회오리 칼날에 strikes번 맞아 사라진 적 (점수 없음) */
  | { type: "blade-vanish"; id: number; x: number; y: number; color: Color }
  | { type: "level-up"; level: number; picked: string }
  | { type: "stage-clear"; vanished: number; xp: number }
  | { type: "stall" };

export interface Chest {
  x: number;
  y: number;
  kind: "elite" | "boss";
}

export interface GoldPouch {
  x: number;
  y: number;
  amount: number;
  t: number;
}

export interface Stats {
  /** 팝 이벤트 수 */
  pops: number;
  /** 연쇄의 시작이 된 팝 (chainDepth 0) 수 */
  rootPops: number;
  /** 색 폭탄으로 일어난 팝 (매치가 아니며 rootPops에도 들어 있다) */
  bombPops: number;
  /** 이번 스테이지에 떨어진 색 폭탄 수 (스테이지당 상한) */
  bombDrops: number;
  /** 마무리 시간에 터뜨린 적 수 */
  wrapUpPopped: number;
  /** 회오리 칼날에 지워진 적 수 (색 공 규칙, 점수 없음) */
  bladeVanished: number;
  /** 클리어할 때 남은 적에게서 받은 경험치 */
  clearXp: number;
  /** 마무리 시간이 끝날 때 남아서 사라진 적 수 */
  vanished: number;
  elitesSpawned: number;
  elitesKilled: number;
  bossSpawned: number;
  bossKilled: number;
  /** 보스를 쓰러뜨린 시각 (s). 없으면 0 */
  bossKilledAt: number;
  chestsOpened: number;
  ballsThrown: number;
  ballPops: number;
  /** 쿠션을 한 번 이상 거친 색 공 팝, 세 번 이상 거친 팝 (쓰리쿠션) */
  cushionPops: number;
  threeCushions: number;
  /** 터진 적 수를 일으킨 쪽별로 (연쇄는 처음 일으킨 쪽 몫) */
  popsBy: Record<string, number>;
  /** 받은 접촉 피해 합계, 그중 엘리트·보스에게 받은 것 */
  damageTaken: number;
  damageFromSpecial: number;
  /** 보스·엘리트 공격(경고 판정·탄·돌진)으로 받은 피해, 약점 공 직격 수, 그로기 수 */
  damageFromAttacks: number;
  weakHits: number;
  groggies: number;
  /** 진화한 무기 수 */
  evolutions: number;
  /** 엘리트·보스가 팝으로 입은 피해 합계, 그런 팝의 수 */
  specialDamage: number;
  specialHits: number;
  /** 보스가 입은 피해의 출처 (11/26): 약점 색 공 직격, 곁의 팝, 그로기 중(직격·팝 모두) */
  bossDmgWeak: number;
  bossDmgPop: number;
  bossDmgGroggy: number;
  goldDropped: number;
  goldPicked: number;
  milkDrops: number;
  milkPicked: number;
  /** 우유로 회복한 체력 합 */
  healed: number;
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

/** 화면에서 사람이 고를 선택지: 레벨업 카드 또는 보물 상자 강화 */
export interface PendingChoice {
  kind: "levelup" | "chest";
  cards: Card[];
  /** 레벨업이면 오른 레벨 */
  level?: number;
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
  milks: Milk[];
  /** 반사벽 */
  walls: Wall[];
  /** 화면에 보이는 월드 크기. 화면판이 매 프레임 넣는다 (세로 화면 등). 시뮬은 RULES.view 그대로 */
  view: { w: number; h: number };
  /** 돌풍 상태: 지금 부는 방향(단위 벡터), 남은 시간, 다음 돌풍까지 */
  wind: { dx: number; dy: number; t: number; cd: number };
  /** 색 공 규칙 (실험). 켜져 있으면 ball이 있다 */
  ballMode: boolean;
  ball: { current: MatchColor; next: MatchColor; cd: number } | null;
  /** 날아가는 색 공 */
  /** 굴러가는 색 공. bounces = 거친 쿠션 수, lastHit = 마지막으로 맞고 튕긴 적 (바로 또 맞지 않게) */
  balls: { x: number; y: number; vx: number; vy: number; color: MatchColor; travel: number; bounces: number; lastHit: number }[];
  /** 엘리트·보스가 떨어뜨린 보물 상자 */
  chests: Chest[];
  /** 팝 자리에 떨어진 골드 주머니 */
  golds: GoldPouch[];
  /** 보스·엘리트 공격 예고와 탄 */
  hazards: Hazard[];
  shots: Shot[];
  /** 마무리 시간이 시작된 시각 */
  wrapUpAt: number;
  stage: StageDef | null;
  phase: StagePhase;
  spawnTimer: number;
  enemyDefs: Record<string, EnemyDef>;
  grid: SpatialHash;
  /** 레벨업 카드 고르기 (없으면 기본 봇 규칙) */
  chooseCard: ((cards: Card[], g: Game) => number) | null;
  /** true면 레벨업·상자 선택을 choices에 쌓고 멈춘다 (화면에서 사람이 고른다). false면 봇 규칙으로 바로 고른다 */
  manualChoices: boolean;
  /** 사람이 골라야 할 선택지 (앞에서부터). 비어 있지 않으면 진행을 멈춘다 */
  choices: PendingChoice[];
  /** Lv4 갈래 선택 창 (null이면 봇 규칙) */
  chooseBranch: ((w: WeaponInstance, g: Game) => "A" | "B") | null;
  /** 레벨업 사용 여부. 무기 구성을 고정해 재는 측정(M1 시뮬, 보정)에서는 끈다. */
  leveling: boolean;
  events: GameEvent[];
  stats: Stats;
  /** 지연 효과 (이중파, 착지 충격파) */
  effects: DelayedEffect[];
}
