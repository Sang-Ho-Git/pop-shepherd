/** 실험 조건: 데이터·규칙을 메모리에서만 바꾼다 (tools/probe.ts에서 쓴다) */
import { RULES } from "../src/core/rules.ts";
import { CHARACTERS, SHOP, STAGES, WEAPONS } from "../src/data/index.ts";

const paint = RULES.paint as { push: boolean; dry: number; toBall: boolean };

/** 페인트 총 모든 레벨 쿨다운 배율 */
function paintCooldown(mul: number): void {
  for (const l of WEAPONS.paint_gun!.levels) l.cooldown = Math.round(l.cooldown * mul * 100) / 100;
}

export const VARIANTS: Record<string, () => void> = {
  base: () => {},
  /** 보스가 살아 있는 동안 일반 소환 3분의 1 (지금 절반) */
  bossSlow3: () => {
    (RULES.boss as { spawnSlowdown: number }).spawnSlowdown = 3;
  },
  /** 상점: 인상률 10% → 6% */
  shopInfl6: () => {
    SHOP.inflation = 0.06;
  },
  /** 상점: 인상률 10% → 4% */
  shopInfl4: () => {
    SHOP.inflation = 0.04;
  },
  /** 상점: 가격 약 25% 내림 */
  shopCheap: () => {
    for (const k of Object.keys(SHOP.prices) as (keyof typeof SHOP.prices)[]) SHOP.prices[k] = Math.round(SHOP.prices[k] * 0.75);
  },
  /** 상점: 팝당 골드 0.27 → 0.45 */
  shopGold45: () => {
    SHOP.goldPerPop = 0.45;
  },
  /** 상점: 팝당 골드 0.27 → 0.6 */
  shopGold60: () => {
    SHOP.goldPerPop = 0.6;
  },
  /** 상점: 팝당 골드 0.45 + 인상률 6% */
  shopGold45i6: () => {
    SHOP.goldPerPop = 0.45;
    SHOP.inflation = 0.06;
  },
  /** 상점: 가격 40% 내림 + 인상률 6% */
  shopHalf: () => {
    for (const k of Object.keys(SHOP.prices) as (keyof typeof SHOP.prices)[]) SHOP.prices[k] = Math.round(SHOP.prices[k] * 0.6);
    SHOP.inflation = 0.06;
  },
  /** 상점: 팝당 골드 0.27 → 0.36 */
  shopGold: () => {
    SHOP.goldPerPop = 0.36;
  },
  /** 경험치 곡선 절반 (레벨업 2배 빠르게) */
  xp2: () => {
    const xp = RULES.xp as { base: number; growth: number };
    xp.base = 80;
    xp.growth = 4;
  },
  /** xp2 + 색 공 쿨다운 0.45초 */
  xp2fast: () => {
    VARIANTS.xp2!();
    (RULES.ball as { cooldown: number }).cooldown = 0.45;
  },
  /** xp2fast + 골드 1.5배 */
  xp2fastGold: () => {
    VARIANTS.xp2fast!();
    SHOP.goldPerPop = 0.27;
  },
  /** 예전 페인트 총 (칠하고 밀어 넣음) */
  oldPaint: () => {
    paint.push = true;
    paint.toBall = false;
  },
  /** 꽃 범퍼를 뺀다 (바위는 남긴다) */
  noBumper: () => {
    for (const st of Object.values(STAGES)) if (st.rocks) st.rocks = st.rocks.filter((r) => !r.bumper);
  },
  /** 돌풍을 뺀다 */
  noWind: () => {
    for (const st of Object.values(STAGES)) delete st.wind;
  },
  /** 기믹 적(가시·겁쟁이)과 바위를 뺀다 */
  noTraits: () => {
    for (const st of Object.values(STAGES)) {
      delete st.mix;
      delete st.rocks;
    }
  },
  /** 페인트 총을 카드에서 뺀다 (팔레는 킥으로 시작) */
  noPaint: () => {
    WEAPONS.paint_gun!.implemented = false;
  },
  /** 칠하고 밀지 않는다 */
  noPush: () => {
    paint.push = false;
  },
  /** 칠한 적은 1초 동안 매치에 끼지 않는다 */
  dry1: () => {
    paint.dry = 1;
  },
  /** 밀지 않고 + 1초 마름 */
  noPushDry: () => {
    paint.push = false;
    paint.dry = 1;
  },
  /** 공 색으로 칠하고 밀지 않는다 (색 공 규칙용) */
  toBall: () => {
    paint.toBall = true;
    paint.push = false;
  },
  /** 쿨다운 1.6배 */
  slow: () => paintCooldown(1.6),
  /** 큐 체력 80 → 100 */
  cueHp100: () => {
    CHARACTERS.cue!.stats.max_hp = 100;
  },
  /** 쓰리쿠션 경험치 +50% → +100% */
  cushionXp100: () => {
    (RULES.threeCushion as { xpBonus: number }).xpBonus = 1;
  },
  /** 양치기 체력 100 → 120 */
  shepHp120: () => {
    CHARACTERS.shepherd!.stats.max_hp = 120;
  },
  /** 큐 체력 80 → 90, 방어 0 → 1 */
  cueHp90Armor1: () => {
    CHARACTERS.cue!.stats.max_hp = 90;
    CHARACTERS.cue!.stats.armor = 1;
  },
  /** 양치기 방어 0 → 1 */
  shepArmor1: () => {
    CHARACTERS.shepherd!.stats.armor = 1;
  },
  /** 쓰리쿠션 경험치 +50% → +75% */
  cushionXp75: () => {
    (RULES.threeCushion as { xpBonus: number }).xpBonus = 0.75;
  },
  /** 양치기 쿨다운 0 → 0.05 (색 공·무기 모두) */
  shepCd05: () => {
    CHARACTERS.shepherd!.stats.cooldown = 0.05;
  },
  /** 양치기 쿨다운 0 → 0.1 */
  shepCd10: () => {
    CHARACTERS.shepherd!.stats.cooldown = 0.1;
  },
  /** 양치기 체력 120 + 쿨다운 0.05 */
  shepHp120Cd05: () => {
    CHARACTERS.shepherd!.stats.max_hp = 120;
    CHARACTERS.shepherd!.stats.cooldown = 0.05;
  },
  /** 진단: 양치기를 올가미로 시작 */
  shepLasso: () => {
    CHARACTERS.shepherd!.startWeapon = "lasso";
  },
  /** 진단: 양치기를 페인트 총으로 시작 */
  shepPaint: () => {
    CHARACTERS.shepherd!.startWeapon = "paint_gun";
  },
  /** 큐를 페인트 총으로 시작 */
  cuePaint: () => {
    CHARACTERS.cue!.startWeapon = "paint_gun";
  },
  /** 큐를 올가미로 시작 */
  cueLasso: () => {
    CHARACTERS.cue!.startWeapon = "lasso";
  },
  /** 쓰리쿠션 경험치 +100% + 큐 체력 100 */
  cueXp100Hp100: () => {
    VARIANTS.cushionXp100!();
    CHARACTERS.cue!.stats.max_hp = 100;
  },
  /** 쓰리쿠션 경험치 +150% */
  cushionXp150: () => {
    (RULES.threeCushion as { xpBonus: number }).xpBonus = 1.5;
  },
  /** cue를 반사벽으로 시작 */
  cueReflect: () => {
    CHARACTERS.cue!.startWeapon = "reflect_wall";
  },
  /** cue를 충격파으로 시작 */
  cueShock: () => {
    CHARACTERS.cue!.startWeapon = "shockwave";
  },
  /** cue를 회오리으로 시작 */
  cueWhirl: () => {
    CHARACTERS.cue!.startWeapon = "whirlwind";
  },
  /** cue를 자석 토템으로 시작 */
  cueMagnet: () => {
    CHARACTERS.cue!.startWeapon = "magnet_totem";
  },
  /** shepherd를 반사벽으로 시작 */
  shepReflect: () => {
    CHARACTERS.shepherd!.startWeapon = "reflect_wall";
  },
  /** shepherd를 충격파으로 시작 */
  shepShock: () => {
    CHARACTERS.shepherd!.startWeapon = "shockwave";
  },
  /** shepherd를 회오리으로 시작 */
  shepWhirl: () => {
    CHARACTERS.shepherd!.startWeapon = "whirlwind";
  },
  /** shepherd를 자석 토템으로 시작 */
  shepMagnet: () => {
    CHARACTERS.shepherd!.startWeapon = "magnet_totem";
  },
  /** 킥 모든 레벨 쿨다운 −30% */
  kickCd70: () => {
    for (const l of WEAPONS.kick!.levels) l.cooldown = Math.round(l.cooldown * 0.7 * 100) / 100;
  },
  /** 킥 모든 레벨 사거리·원뿔 각 +50% (60 → 90) */
  kickRange150: () => {
    for (const l of WEAPONS.kick!.levels) {
      const p = l.params as Record<string, number>;
      p.range = p.range! * 1.5;
      p.coneDeg = p.coneDeg! * 1.5;
    }
  },
  /** 킥 쿨다운 −30% + 사거리 +50% */
  kickCdRange: () => {
    VARIANTS.kickCd70!();
    VARIANTS.kickRange150!();
  },
  /** 킥 Lv1~3에서 2마리, Lv4A부터 관통 수 +1 */
  kickTargets: () => {
    for (const l of WEAPONS.kick!.levels) {
      const p = l.params as Record<string, number>;
      p.maxTargets = p.maxTargets! + 1;
    }
  },
  /** 진단: 킥 쿨다운 +50% (덜 자주 찬다) */
  kickCd150: () => {
    for (const l of WEAPONS.kick!.levels) l.cooldown = Math.round(l.cooldown * 1.5 * 100) / 100;
  },
  /** 진단: 킥 날리는 힘 −30% */
  kickKnock70: () => {
    for (const l of WEAPONS.kick!.levels) l.knock = Math.round(l.knock * 0.7);
  },
};
