/**
 * 코어 규칙 명세 v1 (구조 트리 1.x, 5.3).
 * 설계 문서 "팝 셰퍼드 구조 트리와 로드맵"의 "코어 규칙 명세" 탭과 같은 값이다.
 * 값을 바꾸면 문서도 함께 고친다.
 */
export const RULES = {
  /** 5.3 고정 틱: 초당 60틱. 렌더링 속도와 무관하게 시뮬레이션은 이 간격으로만 진행한다. */
  tickHz: 60,

  /** 기준 화면과 아레나 크기 (px). 아레나는 울타리로 둘러싸인 직사각형. */
  view: { w: 1280, h: 720 },
  arena: { w: 2560, h: 1440 },

  /** 1.1 조작 */
  player: {
    radius: 16,
    /** 이동속도 160px/s × 캐릭터 move_speed */
    baseSpeed: 160,
    /** 접촉 피해를 받은 뒤 무적 시간 (s) */
    iframes: 0.5,
    /** 부활할 때 체력 비율과 무적 시간 */
    reviveHpFrac: 0.5,
    reviveIframes: 2,
    /**
     * 접촉 피해 방식: "worst" = 닿은 적 중 가장 센 한 마리, "sum" = 닿은 적마다 (방어는 마리마다 적용).
     * "sum"은 평균 체력은 거의 바꾸지 않고 포위됐을 때만 치명적이 된다 (시뮬: 사망 0 → 3/30, 체력 57 → 56%).
     */
    contactMode: "sum" as "worst" | "sum",
  },

  /** 1.1 액티브 버튼 "휘슬": 대형 충격파. 직접 피해 없음, 연쇄 단계 0. */
  whistle: { radius: 360, knock: 500, cooldown: 60 },

  /** 1.2 물리 */
  physics: {
    /** 발사 상태 지수 감속 계수 (1/s). 비행 거리 = (v0 - launchEndSpeed) / damping */
    damping: 2.5,
    /** 이 속도 아래로 떨어지면 발사 상태가 끝난다 (px/s) */
    launchEndSpeed: 120,
    /** 접촉 판정 여유: 두 원 사이 거리 ≤ 반지름 합 + contactSlack */
    contactSlack: 4,
    /** "부딪침"으로 인정하는 최소 접근 속도 (px/s). 이미 붙어 있는 적끼리 함께 밀릴 때는 매치가 일어나지 않는다. */
    impactSpeed: 60,
    /** 다른 색 충돌의 반발 계수 (0 = 완전 비탄성, 1 = 완전 탄성) */
    restitution: 0.3,
    /** 발사된 적이 울타리에 튕길 때 남는 속도 비율 */
    wallRestitution: 0.8,
    /** 평소 상태 적끼리 겹침 해소 비율 (틱당) */
    separation: 0.5,
    /** 다른 색 충돌로 멈춘 적의 기절 시간 (s) */
    stunTime: 0.5,
  },

  /**
   * 1.3 같은 색 응집: 평소 상태 적은 radius 안의 같은 색 쪽으로 speed만큼 끌린다 (추적 속도에 더해짐).
   * 뒤섞인 덩어리가 시간이 지나며 색 조각으로 나뉘어, 날려서 맞출 목표가 생긴다. 0이면 끈다.
   */
  cohesion: { radius: 130, speed: 35 },

  /**
   * 큐 고유 특성 "쓰리쿠션": 큐의 무기로 날린 적에 맞아 날아간 적(캐롬)도 쿠션을 거친 샷으로 친다.
   * 울타리 쿠션과 함께, 쿠션을 거친 팝은 경험치 +50%, 팝 충격파 반경 +30% (쿠션 마스터).
   * 다른 색을 벽처럼 반사하는 안은 쿠션 팝이 판당 1.9회뿐이라 버렸다. 캐롬은 판당 약 20회.
   */
  threeCushion: { xpBonus: 0.5, shockBonus: 0.3 },

  /** 1.4 충돌 매치, 1.5 매치 보상 */
  match: {
    minSize: 3,
    /** 이 크기 이상이면 팝 충격파. 4에서 3으로 내려 연쇄 기회를 늘렸다 (막힘 조정, 시뮬 확인). */
    shockwaveMin: 3,
    /** 이 크기 이상이면 색 폭탄 드롭 */
    bombMin: 5,
    /** 팝 충격파 반경 = base + perExtra × (크기 - shockwaveMin), 캐릭터 chain_radius 배율 적용 */
    shockRadiusBase: 90,
    shockRadiusPerExtra: 15,
    /** 450에서 800으로 올림: 무기 충격파를 세게 하면 색 조각이 흩어져 연쇄가 줄어서, 연쇄를 일으키는 쪽을 함께 올렸다 (시뮬 확인). */
    shockKnock: 800,
    /**
     * 색 폭탄은 레어 아이템이다 (판당 20~30개가 떨어지던 것을 스테이지당 1~3개로).
     * 5마리 매치 8%, 6마리 이상 15%, 연쇄 2단계 이상이면 2배, 행운 1당 +100%. 스테이지당 최대 2개.
     * 드물어진 만큼 효과는 주운 자리 기준 화면 전체 (흔할 때는 다음 매치 재료까지 쓸어 버려 연쇄를 망쳤다).
     */
    bombChance5: 0.08,
    bombChance6: 0.15,
    bombChainMul: 2,
    bombMaxPerStage: 2,
    /** 플레이어가 폭탄을 줍는 거리 (중심 간) */
    bombPickupRange: 40,
  },

  /** 1.5 연쇄 */
  chain: {
    /** 팝 충격파에 날아간 적이 이 시간 안에 일으킨 팝만 연쇄로 인정 (s) */
    window: 1.0,
    /** 연쇄 단계마다 경험치 배율 ×1.5 */
    xpPerStep: 1.5,
  },

  /**
   * 스테이지 안 회복: 연쇄 2번째 팝부터(단계 1 이상) 우유병이 떨어진다. 잘 플레이한 보상으로만 회복된다.
   * 확률 × (1 + heal_find). 주우면 최대 체력의 healFrac 회복, lifetime초 뒤 사라짐.
   */
  heal: { minChainDepth: 1, dropChance: 0.15, healFrac: 0.08, lifetime: 20, pickupRange: 40 },

  /**
   * 스테이지 클리어 (생존형): duration이 끝나면 wrapUpSeconds 동안 소환이 멈춘 "마무리 시간".
   * 그사이 팝의 경험치는 +wrapUpXpBonus. 마무리 시간이 끝나면 남은 적은 사라지고 클리어.
   * 남은 적은 벌이 아니라 놓친 보상이다 (짝 안 맞는 잔챙이 때문에 막히지 않는다).
   */
  stage: { wrapUpSeconds: 15, wrapUpXpBonus: 0.5, betweenHeal: 0 },

  /**
   * 2.1 런 안 성장. 레벨 L에서 L+1까지 필요한 경험치 = base + growth × (L - 1).
   * 카드 3장 중 1장. 가중치는 기획서 v2 (보유 무기 강화 35, 보유 패시브 강화 25, 새 무기 20, 새 패시브 20).
   * 고를 것이 없으면 채움 카드 (체력 회복).
   */
  xp: { base: 160, growth: 8 },
  cards: {
    count: 3,
    weaponSlots: 6,
    passiveSlots: 6,
    weights: { weaponUp: 35, passiveUp: 25, newWeapon: 20, newPassive: 20 },
    fillerHealFrac: 0.3,
    /** Lv5 이상 무기의 진화 짝 패시브 카드 가중치 배율 */
    partnerMul: 2,
  },

  /** 1.6 막힘 방지 */
  antiStall: {
    /** 직접 피해로 처치하면 매치 처치 경험치의 20% */
    directKillXpRatio: 0.2,
    /** 이 시간 동안 팝이 없으면 "막힘" 1회 (s) */
    stallSeconds: 10,
  },

  /** 1.7 출현 보정 */
  spawn: {
    /** 플레이어 기준 소환 고리 반경 (화면 밖) */
    ringMin: 760,
    ringMax: 860,
    /**
     * 한 번에 소환하는 짝의 수. 짝 = 같은 색 2마리. 한 웨이브 안의 짝들은 가능한 한 서로 다른 색.
     * 같은 색 3마리 이상으로 소환하면 소환되자마자 완성된 매치 대상이 되어 몰이 퍼즐이 사라진다 (시뮬 확인).
     */
    pairsMin: 2,
    pairsMax: 3,
    pairSize: 2,
    /** 필드에 1~2마리만 남은 색 (짝이 안 맞는 색)의 선택 가중치. 나머지 색은 1. */
    orphanWeight: 3,
    /** 웨이브 중심에서 짝까지의 거리 */
    waveRadius: 45,
    /** 웨이브 중심을 아레나 가장자리에서 띄우는 여유 (웨이브 반경 45 + 짝 반폭 14 + 젤리 반지름 14 + 여유) */
    edgeMargin: 80,
  },
} as const;

export const DT = 1 / RULES.tickHz;

/** 발사 상태 틱당 감속 배율 */
export const DAMP_PER_TICK = Math.exp(-RULES.physics.damping * DT);
