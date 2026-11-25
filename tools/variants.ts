/** 실험 조건: 데이터·규칙을 메모리에서만 바꾼다 (tools/probe.ts에서 쓴다) */
import { RULES } from "../src/core/rules.ts";
import { CHARACTERS, ENEMIES, PASSIVES, SHOP, STAGES, WEAPONS } from "../src/data/index.ts";
import { BOT } from "../src/sim/bot.ts";

const paint = RULES.paint as { push: boolean; dry: number; toBall: boolean };

/** 페인트 총 모든 레벨 쿨다운 배율 */
function paintCooldown(mul: number): void {
  for (const l of WEAPONS.paint_gun!.levels) l.cooldown = Math.round(l.cooldown * mul * 100) / 100;
}

/** 아레나 크기 배율 (지금 크기 기준, 11/23부터 1920×1080): 울타리와 지형(바위 자리, 개울 높이)을 같이 줄인다. 바위 크기는 그대로 */
function scaleArena(f: number): void {
  const a = RULES.arena as { w: number; h: number };
  a.w = Math.round(a.w * f);
  a.h = Math.round(a.h * f);
  for (const st of Object.values(STAGES)) {
    for (const r of st.rocks ?? []) {
      r.x = Math.round(r.x * f);
      r.y = Math.round(r.y * f);
    }
    for (const sm of st.streams ?? []) {
      sm.y = Math.round(sm.y * f);
      sm.h = Math.round(sm.h * f);
    }
  }
}

/** 11/24 난이도 실험: 환경 변수 RAMP="spd=0.08,hp=0.3,cap=0.2,int=0.1,from=6,to=14,s15spd=0"
 * 스테이지 from~to에 (k-from+1)/(to-from+1) 비율로 늘려 to에서 1+값이 되게 한다.
 * k13con=-0.1 처럼 k<스테이지><spd|hp|con>으로 한 스테이지만 더 곱할 수 있다.
 * pale.cooldown=0: 캐릭터 능력치, spdFrom=0.45,spdTo=0.3: 속도 램프 바꾸기.
 * kick: 색 공 규칙 킥 쿨다운 배율 (0이면 그대로), con: 접촉 피해 배율, spd: 적 속도, hp: 적 체력, cap: 적 상한, int: 소환 간격을 1/(1+값)으로 줄임 */
function ramp(): void {
  const o: Record<string, number> = { spd: 0, hp: 0, cap: 0, int: 0, from: 6, to: 14, s15spd: 0, s15hp: 0, s15int: 0, con: 0, s15con: 0 };
  for (const kv of (process.env.RAMP ?? "").split(",").filter(Boolean)) {
    const [k, v] = kv.split("=");
    // pale.chain_radius=1 처럼 점이 있으면 캐릭터 능력치
    if (k!.includes(".")) {
      const [c, st] = k!.split(".");
      (CHARACTERS[c!]!.stats as unknown as Record<string, number>)[st!] = Number(v);
    } else o[k!] = Number(v);
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  if (o.kick) (RULES.ball as { kickCooldownMul: number }).kickCooldownMul = o.kick;
  for (let k = o.from!; k <= 15; k++) {
    const st = STAGES[`stage${String(k).padStart(2, "0")}`]!;
    const f = k === 15 ? 1 : Math.min(1, (k - o.from! + 1) / (o.to! - o.from! + 1));
    const spd = k === 15 ? o.s15spd! : o.spd! * f;
    const hp = k === 15 ? o.s15hp! : o.hp! * f;
    const int = k === 15 ? o.s15int! : o.int! * f;
    const cap = k === 15 ? 0 : o.cap! * f;
    const con = k === 15 ? o.s15con! : o.con! * f;
    st.contactMul = r2((st.contactMul ?? 1) * (1 + con));
    const ex = (n: string) => 1 + (o[`k${k}${n}`] ?? 0);
    // spdFrom/spdTo: 지금 데이터의 속도 램프(1+spdFrom·f)를 1+spdTo·f로 바꾼다
    const resc = k < 15 && o.spdFrom ? (1 + o.spdTo! * f) / (1 + o.spdFrom * f) : 1;
    st.contactMul = r2(st.contactMul! * ex("con"));
    st.enemyHpMul = r2(st.enemyHpMul * ex("hp"));
    for (const ph of st.spawn) {
      ph.speedMul = r2((ph.speedMul ?? 1) * (1 + spd) * ex("spd") * resc);
      ph.interval = r2(ph.interval / (1 + int));
    }
    st.enemyHpMul = r2(st.enemyHpMul * (1 + hp));
    st.maxAlive = Math.round(st.maxAlive * (1 + cap));
  }
}

/**
 * 임시 난이도 (영구 강화 트리 작업용, claude/meta-difficulty 결과가 오기 전까지):
 * 모든 스테이지 접촉 피해 × contact, 적 속도 × speed
 */
function harder(contact: number, speed: number): void {
  for (const st of Object.values(STAGES)) {
    st.contactMul = Math.round((st.contactMul ?? 1) * contact * 1000) / 1000;
    for (const ph of st.spawn) ph.speedMul = Math.round((ph.speedMul ?? 1) * speed * 1000) / 1000;
  }
}

export const VARIANTS: Record<string, () => void> = {
  base: () => {},
  /** 11/24 보스: 봇이 돌진을 바위로 유인하지 않게 (유인 전 봇) */
  noLure: () => {
    BOT.lure = false;
  },
  /** 11/25 보스: 그로기를 못 쓰는 사람 (유인 없음 + 그로기 때도 평소처럼 약점 색 공만) */
  noGroggy: () => {
    BOT.lure = false;
    BOT.groggyPunish = false;
  },
  /** 11/24 런 조정 비교: 회오리를 예전처럼 튕기게 */
  legacyOrbit: () => {
    (RULES.ball.orbit as { legacy: boolean }).legacy = true;
  },
  /** 회오리를 아예 뺀다 (카드·상점에 안 나옴) */
  noWhirl: () => {
    WEAPONS.whirlwind!.implemented = false;
  },
  /** 반사벽을 예전처럼 플레이어 앞에 세움 (방어 몫 비교) */
  wallFront: () => {
    (RULES.wall as { front: boolean }).front = true;
  },
  /** 공이 반사벽을 지나감 (벽이 공을 막는 손해 비교) */
  wallBallPass: () => {
    (RULES.wall as { ballPass: boolean }).ballPass = true;
  },
  /** 모든 캐릭터가 반사벽으로 시작 (반사벽 빌드만 따로 보기), 그 위에 front·ballPass */
  allWall: () => {
    for (const c of Object.values(CHARACTERS)) c.startWeapon = "reflect_wall";
  },
  allWallFront: () => {
    for (const c of Object.values(CHARACTERS)) c.startWeapon = "reflect_wall";
    (RULES.wall as { front: boolean }).front = true;
  },
  allWallPass: () => {
    for (const c of Object.values(CHARACTERS)) c.startWeapon = "reflect_wall";
    (RULES.wall as { ballPass: boolean }).ballPass = true;
  },
  /**
   * 스테이지 4 손잡이 (11/24 밤): 환경 변수 ST4="spd=0.94,int=1.1,cap=75,noCham=1,con=1.36"
   * spd: 마지막 구간 속도 배율에 곱, spdAll: 모든 구간, int: 소환 간격에 곱, cap: 적 상한, noCham: 85초 카멜레온 빼기, con: 접촉 배율
   */
  st4: () => {
    const o: Record<string, number> = {};
    for (const kv of (process.env.ST4 ?? "").split(",").filter(Boolean)) {
      const [k, v] = kv.split("=");
      o[k!] = Number(v);
    }
    const st = STAGES.stage04!;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    st.spawn.forEach((ph, i) => {
      const last = i === st.spawn.length - 1;
      ph.speedMul = r2((ph.speedMul ?? 1) * (o.spdAll ?? 1) * (last ? (o.spd ?? 1) : 1));
      ph.interval = r2(ph.interval * (o.int ?? 1));
    });
    if (o.cap) st.maxAlive = o.cap;
    if (o.con) st.contactMul = o.con;
    if (o.noCham) st.elites = (st.elites ?? []).filter((e) => e.kind !== "chameleon");
    if (process.env.RAMP) ramp();
  },
  /** 경험치 곡선: 환경 변수 XPL="from=20,g=20" (lateFrom, lateGrowth) */
  xpLate: () => {
    const o = Object.fromEntries((process.env.XPL ?? "").split(",").filter(Boolean).map((kv) => kv.split("=")));
    const x = RULES.xp as { lateFrom: number; lateGrowth: number };
    if (o.from) x.lateFrom = Number(o.from);
    if (o.g) x.lateGrowth = Number(o.g);
    if (process.env.RAMP) ramp();
  },
  /** 예전 경험치 곡선 (늦은 가파름 없음) */
  xpOld: () => {
    (RULES.xp as { lateGrowth: number }).lateGrowth = 0;
  },
  /** 공 색: 근처에 없는 색도 예전처럼 가중치 1 */
  absentBall1: () => {
    (RULES.ball as { absentWeight: number }).absentWeight = 1;
  },
  /** 반사벽 예전 동작 비교: 벽이 여러 세트 남음 + 지속 6~7초 */
  wallOld: () => {
    (RULES.wall as { oneSet: boolean }).oneSet = false;
    for (const l of WEAPONS.reflect_wall!.levels) (l.params as Record<string, number>).duration = l.lv === 1 || l.lv === 2 ? 6 : 7;
  },
  /** 반사벽을 아예 뺀다 */
  noWall: () => {
    WEAPONS.reflect_wall!.implemented = false;
  },
  /** 모든 캐릭터가 회오리로 시작 (회오리 빌드가 튀는지) */
  allWhirl: () => {
    for (const c of Object.values(CHARACTERS)) c.startWeapon = "whirlwind";
  },
  /** 이동 속도 패시브(가벼운 발굽) 빼기 */
  noHooves: () => {
    PASSIVES.swift_hooves!.implemented = false;
  },
  /** 예전 마무리 시간 10초 (+50% 팝 경험치), 클리어 경험치 없음 */
  wrap10: () => {
    (RULES.stage as { wrapUpSeconds: number; clearXpRatio: number }).wrapUpSeconds = 10;
    (RULES.stage as { wrapUpSeconds: number; clearXpRatio: number }).clearXpRatio = 0;
  },
  /** 11/24 이전 상태 묶음 (반사벽 변경 31bc547만 들어간 상태와 같은 규칙): 예전 회오리 + 마무리 10초 + 발굽 없음 */
  pre: () => {
    (RULES.ball.orbit as { legacy: boolean }).legacy = true;
    (RULES.stage as { wrapUpSeconds: number; clearXpRatio: number }).wrapUpSeconds = 10;
    (RULES.stage as { wrapUpSeconds: number; clearXpRatio: number }).clearXpRatio = 0;
    PASSIVES.swift_hooves!.implemented = false;
  },
  ramp,
  /** 임시 난이도 후보 (강화 0 완주 약 20% 목표) */
  hardA: () => harder(1.25, 1.05),
  hardB: () => harder(1.4, 1.08),
  hardC: () => harder(1.55, 1.1),
  /** 지금 쓰는 임시 난이도 (= hardB) */
  hard20: () => harder(1.4, 1.08),
  /** 11/25 페인트 총·자석 토템 고레벨(Lv5 이상·진화) 하향 시험 (NERF="m=1,p=1"로 한쪽만) */
  nerfPM: () => {
    const o = Object.fromEntries((process.env.NERF ?? "m=1,p=1").split(",").map((kv) => kv.split("=")));
    const hi = (lv: number | string) => lv === "evo" || Number(lv) >= 5;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    if (o.m === "1")
      for (const l of WEAPONS.magnet_totem!.levels) {
        if (!hi(l.lv)) continue;
        l.cooldown = r2(l.cooldown * Number(o.mcd ?? 1.2));
        const pr = l.params as Record<string, number>;
        pr.duration = Number(o.mdur ?? 3.5);
        pr.pullSpeed = Number(o.mpull ?? 90);
      }
    if (o.p === "1")
      for (const l of WEAPONS.paint_gun!.levels) {
        if (!hi(l.lv)) continue;
        l.cooldown = r2(l.cooldown * Number(o.pcd ?? 1.25));
        const pr = l.params as Record<string, number>;
        if (pr.projectiles && pr.projectiles > 3) pr.projectiles = 3;
        if (pr.puddleRadius) pr.puddleRadius = 30;
        if (pr.splashRadius) pr.splashRadius = 55;
        if (pr.pierce && pr.pierce > 2) pr.pierce = 2;
      }
  },
  /** 11/25 응집 가다듬기 전 동작 (부드럽게 끄기) */
  cohOld: () => {
    (RULES.cohesion as { smooth: boolean }).smooth = false;
  },
  /** 11/25 응집 시험안 (a): 같은 색 응집 없앰 */
  cohNone: () => {
    (RULES.cohesion as { speed: number }).speed = 0;
  },
  /** 11/25 응집 시험안 (b): 개별 끌림 대신 같이 소환된 짝이 무리로 함께 걷기 */
  cohFlock: () => {
    (RULES.cohesion as { mode: string }).mode = "flock";
  },
  /** 스테이지 4 적 상한 112 → 85 */
  st4cap85: () => {
    STAGES.stage04!.maxAlive = 85;
  },
  /** 스테이지 4 가시 젤리 없음 */
  st4noSpiky: () => {
    STAGES.stage04!.mix = {};
  },
  /** 스테이지 4 엘리트 없음 */
  st4noElite: () => {
    STAGES.stage04!.elites = [];
  },
  /** 스테이지 4 소환 간격 ×1.2 (적이 덜 쌓이게) */
  st4fewer: () => {
    for (const ph of STAGES.stage04!.spawn) ph.interval = Math.round(ph.interval * 1.2 * 100) / 100;
  },
  /** 연쇄 배율 상한 끄기 (11/23 밤 이전) */
  chainCapOff: () => {
    (RULES.chain as { maxDepth: number }).maxDepth = 999;
  },
  /** 스테이지 4·5 접촉 피해 배율 ×0.9 (초반 벽 완화) */
  st45soft: () => {
    for (const k of ["stage04", "stage05"]) STAGES[k]!.contactMul = Math.round(STAGES[k]!.contactMul! * 0.9 * 100) / 100;
  },
  /** 스테이지 4·5 적 속도 배율 ×0.9 */
  st45slow: () => {
    for (const k of ["stage04", "stage05"]) for (const ph of STAGES[k]!.spawn) ph.speedMul = Math.round((ph.speedMul ?? 1) * 0.9 * 100) / 100;
  },
  /** 색 공 규칙 킥 쿨다운 배율 1.5 → 1 (11/23 밤 이전) */
  kickMul1: () => {
    (RULES.ball as { kickCooldownMul: number }).kickCooldownMul = 1;
  },
  /** 색 공 규칙 킥 쿨다운 배율 2 */
  kickMul2: () => {
    (RULES.ball as { kickCooldownMul: number }).kickCooldownMul = 2;
  },
  /** 색 공 규칙 킥 조준 끄기 (11/23 밤 이전) */
  noKickAim: () => {
    (RULES.ball as { kickAim: number }).kickAim = 0;
  },
  /** 양치기 이동 속도 1.0 → 1.1 */
  shepSpd11: () => {
    CHARACTERS.shepherd!.stats.move_speed = 1.1;
  },
  /** 양치기 이동 속도 1.15 */
  shepSpd115: () => {
    CHARACTERS.shepherd!.stats.move_speed = 1.15;
  },
  /** 양치기 체력 120 → 140 */
  shepHp140: () => {
    CHARACTERS.shepherd!.stats.max_hp = 140;
  },
  /** 큐 체력 80 → 100 */
  cueHp100b: () => {
    CHARACTERS.cue!.stats.max_hp = 100;
  },
  /** 큐 이동 속도 1.1 → 1.2 */
  cueSpd12: () => {
    CHARACTERS.cue!.stats.move_speed = 1.2;
  },
  /** 큐 체력 100 + 이동 속도 1.2 */
  cueHpSpd: () => {
    CHARACTERS.cue!.stats.max_hp = 100;
    CHARACTERS.cue!.stats.move_speed = 1.2;
  },
  /** 큐의 캐롬을 쿠션으로 세지 않음 (11/23 밤 이전) */
  noCueCarom: () => {
    (RULES.ball as { cueCaromCushion: boolean }).cueCaromCushion = false;
  },
  /** 스테이지 11~15 적 속도 배율 ×0.9 */
  lateSpeed90: () => {
    for (const k of ["stage11", "stage12", "stage13", "stage14", "stage15"]) for (const ph of STAGES[k]!.spawn) ph.speedMul = Math.round((ph.speedMul ?? 1) * 0.9 * 100) / 100;
  },
  /** 스테이지 15 적 속도 배율 ×0.85 */
  st15Speed85: () => {
    for (const ph of STAGES.stage15!.spawn) ph.speedMul = Math.round((ph.speedMul ?? 1) * 0.85 * 100) / 100;
  },
  /** 반사벽 동시 상한 3장 (만화경 삼각형 하나, V자 하나 반) */
  wallCap3: () => {
    (RULES.wall as { maxActive: number }).maxActive = 3;
  },
  /** 반사벽 동시 상한 6장 */
  wallCap6: () => {
    (RULES.wall as { maxActive: number }).maxActive = 6;
  },
  /** 스테이지 11~15 접촉 피해 배율 ×0.9 (2.7~3.1 → 2.43~2.79) */
  lateContact90: () => {
    for (const k of ["stage11", "stage12", "stage13", "stage14", "stage15"]) STAGES[k]!.contactMul = Math.round(STAGES[k]!.contactMul! * 0.9 * 100) / 100;
  },
  /** 스테이지 4~15 접촉 피해 배율 ×0.9 */
  allContact90: () => {
    for (const [k, st] of Object.entries(STAGES)) if (/^stage(0[4-9]|1\d)$/.test(k)) st.contactMul = Math.round((st.contactMul ?? 1) * 0.9 * 100) / 100;
  },
  /** 브라우저 1280×720 화면에서 실제로 보이는 월드 크기 (확대 1.16배): 소환·폭탄·막힘 판정이 이 크기를 쓴다 */
  viewWeb: () => {
    const v = RULES.view as { w: number; h: number };
    v.w = 1103;
    v.h = 620;
  },
  /** 스테이지 15 접촉 피해 배율 3.1 → 2.6 */
  st15Contact26: () => {
    STAGES.stage15!.contactMul = 2.6;
  },
  /** 스테이지 15 소환 간격 ×1.3 */
  st15Slow: () => {
    for (const ph of STAGES.stage15!.spawn) ph.interval = Math.round(ph.interval * 1.3 * 100) / 100;
  },
  /** 팝이 보스·엘리트에 주는 피해 12 → 18 (마리당) */
  popDmg18: () => {
    (RULES.boss as { popDamagePerEnemy: number }).popDamagePerEnemy = 18;
  },
  /** 무지개 양치기 체력 12000 → 9000 */
  boss15Hp9k: () => {
    ENEMIES.rainbow_shepherd!.hp = 9000;
  },
  /** 스테이지 15 적 상한 188 → 150 */
  st15cap150: () => {
    STAGES.stage15!.maxAlive = 150;
  },
  /** 굴러가는 거리 750 → 520 (예전 사거리). 11/23부터 아레나가 1920×1080이라 따로 줄이지 않는다 */
  a75range520: () => {
    (RULES.ball as { range: number }).range = 520;
  },
  /** 당구 튕김 끄기 (아레나는 지금 그대로) */
  a75noCarom: () => {
    (RULES.ball as { carom: boolean }).carom = false;
  },
  /** 아레나 0.75배 + 소환 간격 ×1.25 (넓이가 0.56배라 밀도를 맞춘다) */
  arena75slow: () => {
    scaleArena(0.75);
    for (const st of Object.values(STAGES)) for (const ph of st.spawn) ph.interval = Math.round(ph.interval * 1.25 * 100) / 100;
  },
  /** 아레나 0.75배 + 동시에 살아 있는 적 상한 ×0.75 */
  arena75cap: () => {
    scaleArena(0.75);
    for (const st of Object.values(STAGES)) st.maxAlive = Math.round(st.maxAlive * 0.75);
  },
  /** 색 공 던지는 속도 1400 → 1800 (굴러가는 거리는 같음, 먼 곳에 더 빨리 닿는다) */
  fastBall: () => {
    (RULES.ball as { speed: number }).speed = 1800;
  },
  /** 던지는 속도 1800 + 아레나 0.75배 */
  fastBall75: () => {
    (RULES.ball as { speed: number }).speed = 1800;
    scaleArena(0.75);
  },
  /** 아레나 1920×1080 (지금 2560×1440의 0.75배) */
  arena75: () => scaleArena(0.75),
  /** 아레나 1600×900 (0.625배) */
  arena62: () => scaleArena(0.625),
  /** 당구 튕김 없이 (다른 색에 맞으면 공이 사라지던 예전 방식) */
  noCarom: () => {
    (RULES.ball as { carom: boolean }).carom = false;
  },
  /** 아레나 0.75배 + 당구 튕김 없이 */
  arena75noCarom: () => {
    scaleArena(0.75);
    (RULES.ball as { carom: boolean }).carom = false;
  },
  /** 무지개 양치기 체력 12000 → 10000 */
  boss15Hp10k: () => {
    ENEMIES.rainbow_shepherd!.hp = 10000;
  },
  /** 스테이지 15 접촉 피해 배율 3.1 → 2.9 */
  st15Contact29: () => {
    STAGES.stage15!.contactMul = 2.9;
  },
  /** 무지개 양치기 소환 4 → 3마리 */
  boss15Summon3: () => {
    (ENEMIES.rainbow_shepherd!.params as { summonCount: number }).summonCount = 3;
  },
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
  /** 양치기 체력 100 → 130 */
  shepHp130: () => {
    CHARACTERS.shepherd!.stats.max_hp = 130;
  },
  /** 양치기 체력 120 + 방어 1 */
  shepHp120Armor1: () => {
    CHARACTERS.shepherd!.stats.max_hp = 120;
    CHARACTERS.shepherd!.stats.armor = 1;
  },
};
