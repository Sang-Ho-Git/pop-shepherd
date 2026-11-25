import { step } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { Card, Game, Input } from "../src/core/types.ts";
import { CAMPAIGN, CHARACTERS, META, PASSIVES, SHOP, stage, WEAPONS } from "../src/data/index.ts";
import type { MetaNode } from "../src/data/index.ts";
import { botCardScore, botChooseBranch, botChooseCard, needsBranch, resolveChoice, validateFrontChoice, xpTotalFor } from "../src/progression/levelup.ts";
import { botInput } from "../src/sim/bot.ts";
import { applyMeta, costFor, isUnlocked, nodesFor, runCoins } from "../src/progression/meta.ts";
import type { MetaSpecials } from "../src/progression/meta.ts";
import { acknowledgeRefund, browserStore, loadSave, profileOf, recordRun, spendOnMeta, treeProgress, writeSave } from "../src/progression/save.ts";
import type { SaveData } from "../src/progression/save.ts";
import { conditionProgress, isCharacterUnlocked, newlyUnlocked, statValue, UNLOCKS } from "../src/progression/unlocks.ts";
import type { UnlockCondition } from "../src/progression/unlocks.ts";
import { buy, openShop, reroll } from "../src/progression/shop.ts";
import type { ShopState } from "../src/progression/shop.ts";
import { carryOf, startStage } from "../src/sim/campaign.ts";
import type { Carry } from "../src/sim/campaign.ts";
import { makeWeapon, weaponLevel, MAX_LEVEL } from "../src/weapons/weapons.ts";
import type { CharacterDef } from "../src/core/types.ts";
import { computeView, drawWorld, PALETTE } from "./render.ts";
import type { Aim, Fx, View } from "./render.ts";
import { readyClusters } from "../src/combat/ball.ts";
import { isMuted, setMuted, sfx, unlock } from "./audio.ts";
import devBuildsJson from "./dev-builds.json" with { type: "json" };

/** 시험 진입로 빌드: 봇 런에서 스테이지 N 시작 때 실제로 넘어온 상태 (tools/dev-builds.ts로 만든다) */
const DEV_BUILDS = devBuildsJson as unknown as Record<string, Record<string, Carry>>;

/* ───────────────────────── 기본 ───────────────────────── */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 없음`);
  return el as T;
};
const canvas = $<HTMLCanvasElement>("game");
// 불투명 캔버스: 모든 픽셀을 매 프레임 칠하므로 투명도가 필요 없다 (합성할 때 섞기를 건너뛴다)
const ctx = canvas.getContext("2d", { alpha: false })!;
const overlay = $<HTMLDivElement>("overlay");
const hud = $<HTMLDivElement>("hud");
const store = browserStore("pop-shepherd-save-v1");
let save: SaveData = loadSave(store);

/** 색 공 규칙 (실험): 브라우저에 기억한다. 처음에는 켜져 있다. */
const BALL_KEY = "pop-shepherd-ballmode";
let ballMode = (() => {
  try {
    return localStorage.getItem(BALL_KEY) !== "off";
  } catch {
    return true;
  }
})();
function setBallMode(on: boolean): void {
  ballMode = on;
  try {
    localStorage.setItem(BALL_KEY, on ? "on" : "off");
  } catch {
    // 기억하지 못해도 이번 판에는 적용된다
  }
}

const CHAR_ORDER = ["olly", "shepherd", "cue", "pale"];
const CHAR_NAME: Record<string, string> = { shepherd: "양치기", cue: "큐", olly: "올리", pale: "팔레" };
/** 캐릭터 소개. 숫자는 쓰지 않는다 (능력치 줄이 data/characters.json에서 만든다: 예전에 소개의 체력·쿨다운이 데이터와 어긋났다) */
const CHAR_BLURB: Record<string, string> = {
  olly: "목동. 튼튼하고 단단하다. 올가미로 떨어진 양을 짝에게 끌어다 붙인다. 처음이라면 올리.",
  shepherd: "튼튼한 기준 캐릭터. 킥으로 이동 방향의 적을 정확히 날린다.",
  cue: "당구사. 조준선이 늘 보이고 3쿠션까지 꺾여 보인다. 쿠션에서 속도를 덜 잃고, 공끼리 맞은 것도 쿠션으로 친다.",
  pale: "화가. 터질 때 연쇄가 멀리 번진다. 페인트 총으로 옆 무리의 색을 칠한다.",
};
/** 기본값(1, 쿨다운은 0)과 다른 능력치 (선택 화면의 둘째 능력치 줄) */
const STAT_NAME: [keyof CharacterDef["stats"], string][] = [
  ["knock_power", "날리는 힘"],
  ["area", "무기 범위"],
  ["chain_radius", "연쇄 반경"],
  ["pickup", "줍는 거리"],
  ["direct_dmg", "직격 피해"],
];
function statExtras(s: CharacterDef["stats"]): string {
  const parts = STAT_NAME.filter(([k]) => s[k] !== 1).map(([k, n]) => `${n} ${Math.round(s[k] * 100)}%`);
  if (s.cooldown !== 0) parts.push(`쿨다운 ${s.cooldown > 0 ? "−" : "+"}${Math.round(Math.abs(s.cooldown) * 100)}%`);
  return parts.join(" · ");
}

function el(tag: string, cls = "", text = ""): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** 마지막으로 그린 메뉴 화면 (같은 화면을 다시 그리면 스크롤 위치를 지킨다) */
let shownScreen = "";

/**
 * 메뉴 화면을 그린다. 메뉴는 문서 전체가 스크롤된다 (body.menu): 폰에서 오버레이 안쪽 스크롤 상자를 쓰면
 * 다시 그릴 때마다 맨 위로 튀고(첫 버튼 포커스), 호스트 페이지 안에서 스크롤이 겹치던 문제가 있었다.
 * 같은 화면을 다시 그릴 때(영구 강화 구매, 상점 구매·새로고침, 캐릭터 탭)는 보던 자리를 지킨다.
 */
function show(nodes: HTMLElement[], cls = "panel"): void {
  const keep = shownScreen === screen && !overlay.hidden;
  const y = keep ? window.scrollY : 0;
  // 다시 그리기 전 포커스가 있던 버튼 (같은 글자의 버튼에 포커스를 돌려준다: 키보드로 연달아 살 때)
  const focused = keep && document.activeElement instanceof HTMLButtonElement ? document.activeElement.textContent : null;
  overlay.replaceChildren();
  const p = el("div", cls);
  for (const n of nodes) p.append(n);
  overlay.append(p);
  overlay.hidden = false;
  document.body.classList.add("menu");
  shownScreen = screen;
  const buttons = [...p.querySelectorAll("button")] as HTMLButtonElement[];
  const target = (focused !== null ? buttons.find((b) => b.textContent === focused && !b.disabled) : undefined) ?? buttons.find((b) => !b.disabled);
  target?.focus({ preventScroll: true });
  window.scrollTo(0, y);
}

function hideOverlay(): void {
  overlay.hidden = true;
  overlay.replaceChildren();
  document.body.classList.remove("menu");
  shownScreen = "";
  window.scrollTo(0, 0);
}

/* ───────────────────────── 카드 설명 ───────────────────────── */

function weaponName(id: string): string {
  return WEAPONS[id]?.name ?? id;
}

function lvText(lv: number | "evo"): string {
  return lv === "evo" ? "진화" : `Lv${lv}`;
}

function cardInfo(g: Game, c: Card): { title: string; body: string; tag: string } {
  switch (c.kind) {
    case "weaponUp": {
      const w = g.weapons.find((x) => x.def.id === c.id)!;
      const lv = w.level.lv as number;
      const next = lv + 1 >= 4 ? (c.branch ? weaponLevel(w.def, lv + 1, c.branch) : null) : weaponLevel(w.def, lv + 1);
      const body = next ? next.note : "갈래를 고른다: A 또는 B";
      return { title: `${weaponName(c.id)} ${lvText(lv)} → ${lvText(lv + 1)}`, body, tag: "무기 강화" };
    }
    case "newWeapon": {
      const def = WEAPONS[c.id]!;
      return { title: def.name, body: def.levels[0]!.note, tag: "새 무기" };
    }
    case "passiveUp": {
      const def = PASSIVES[c.id]!;
      return { title: `${def.name} Lv${g.player.passives[c.id]} → Lv${(g.player.passives[c.id] ?? 0) + 1}`, body: def.note, tag: "패시브 강화" };
    }
    case "newPassive": {
      const def = PASSIVES[c.id]!;
      return { title: def.name, body: def.note, tag: "새 패시브" };
    }
    case "heal":
      return { title: "물 한 모금", body: `체력 ${Math.round(RULES.cards.fillerHealFrac * 100)}% 회복`, tag: "채움" };
    case "gold":
      return { title: "골드 주머니", body: `골드 +${SHOP.fillerGold}`, tag: "채움" };
    case "evolve":
      return { title: `${weaponName(c.id)} 진화`, body: WEAPONS[c.id]!.levels.find((l) => l.lv === "evo")!.note, tag: "진화" };
  }
}

/* ───────────────────────── 런 상태 ───────────────────────── */

type Screen = "title" | "select" | "play" | "shop" | "result" | "meta";
let screen: Screen = "title";

interface Run {
  character: string;
  stageIndex: number;
  carry: Carry | null;
  meta: { character: CharacterDef; specials: MetaSpecials };
  popped: number;
  /** 런 전체: 가장 긴 연쇄, 쿠션 팝, 3쿠션 이상 팝 (결과 화면) */
  bestChain: number;
  cushionPops: number;
  threeCushions: number;
  seed: number;
  /** 시험 진입로(#stageN)로 시작한 판: 기록·코인에 넣지 않는다 */
  dev?: boolean;
}
let run: Run | null = null;
let g: Game | null = null;
let paused = false;
let fx: Fx[] = [];
let banner: { text: string; sub: string; t: number } | null = null;
/** 클리어 뒤 상점으로 넘어가기 전 잠깐 (s): 마무리 시간이 없어져 0:00에서 곧바로 상점이 덮이던 것을 클리어 배너·흩어지는 연출로 받친다 */
const CLEAR_HOLD = 1.3;
let clearHold = 0;
/** 마지막 틱 전의 적 목록 (클리어하면 g.enemies가 비므로, 사라지는 자리를 그리려고) */
let prevEnemies: Game["enemies"] = [];
let shop: ShopState | null = null;
let choiceShown = false;
let hitFlash = 0;
let shake = 0;
/** 히트스톱: 큰 팝·연쇄 때 아주 잠깐 시뮬을 멈춘다 (화면은 계속 그린다) */
let hitStop = 0;
let aimCache: Aim | null = null;
let aimTick = 0;
const AIM_GUIDE_SECONDS = 25;

function startRun(characterId: string): void {
  // 영구 강화는 캐릭터별 트리: 이 캐릭터가 산 노드만 적용
  const meta = applyMeta(CHARACTERS[characterId]!, profileOf(save, characterId));
  run = { character: characterId, stageIndex: 0, carry: null, meta, popped: 0, bestChain: 0, cushionPops: 0, threeCushions: 0, seed: (Date.now() >>> 0) % 1_000_000 };
  beginStage();
}

/** 처음 하는 사람을 위한 안내 (스테이지 1, 처음 세 판). 시각(초)에 맞춰 하나씩 띄운다 */
/** 터치 화면인지 (안내 문구를 손가락 조작으로) */
const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
/** 줄인 움직임 설정 (매 프레임 matchMedia를 새로 만들지 않게 한 번만) */
const REDUCED_MOTION = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

const HINTS_BALL: [number, string][] = [
  [1, COARSE ? "화면을 톡 치면 그곳으로 색 공을 던진다. 누르고 끌면 움직인다" : "마우스로 조준하고 클릭하면 색 공을 던진다"],
  [7, "같은 색 무리에 맞혀 공까지 3마리가 되면 터진다. 바닥이 빛나는 무리가 지금 공으로 터뜨릴 수 있는 곳"],
  [14, "같은 색이 하나뿐이면 공이 그 옆에 붙는다. 다음 공으로 터뜨리면 된다"],
  [22, COARSE ? "오른쪽 아래 '바꾸기'로 지금 공과 다음 공을 바꾼다" : "오른쪽 클릭이나 Q로 지금 공과 다음 공을 바꾼다"],
  [30, "공은 당구공처럼 굴러가다 멈춘다. 울타리·바위·반사벽(쿠션)에서 튕기고, 다른 색에 맞으면 맞고 튕긴다"],
  [38, "쿠션을 거쳐 터뜨리면 보너스: 1쿠션 +30%, 2쿠션 +60%, 3쿠션 이상 +120%. 조준선이 꺾이는 길을 보여 준다"],
  [46, "터질 때 나오는 충격파가 옆 무리를 날려 연쇄가 된다. Space는 휘슬 (주변을 밀어낸다)"],
];
const HINTS_OLD: [number, string][] = [
  [1, "무기가 자동으로 적을 날린다. 날아간 적이 같은 색에 세게 부딪혀 3마리가 되면 터진다"],
  [9, "천천히 닿거나 걸어와 붙은 무리는 터지지 않는다. 다음 한 방을 기다리는 짝이다"],
  [18, "Space는 휘슬: 주변을 한 번에 밀어낸다 (재사용 60초)"],
];
const HINT_KEY = "pop-shepherd-hints-seen";
function hintsLeft(): number {
  try {
    return 3 - Number(localStorage.getItem(HINT_KEY) ?? "0");
  } catch {
    return 3;
  }
}
let hintQueue: [number, string][] = [];
let hint: { text: string; t: number } | null = null;

/** 버틸 시간 글: 90초 → "1분 30초 버텨라" (예전에는 분을 반올림해 "2분 30초"로 나왔다) */
function goalTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m > 0 ? `${m}분 ` : ""}${s ? `${s}초 ` : ""}버텨라`;
}

function beginStage(): void {
  if (!run) return;
  const id = CAMPAIGN[run.stageIndex] as string;
  g = startStage(run.seed + run.stageIndex * 7919, run.character, id, run.carry, run.meta, true, ballMode);
  fx = [];
  paused = false;
  choiceShown = false;
  screen = "play";
  hideOverlay();
  const st = stage(id);
  const goal = st.clear === "boss" ? "보스를 쓰러뜨려라" : st.clear === "elites" ? `엘리트 ${st.elites?.length ?? 0}마리를 쓰러뜨려라` : goalTime(st.duration);
  banner = { text: `스테이지 ${run.stageIndex + 1} · ${st.name}`, sub: goal, t: 3 };
  hint = null;
  hintQueue = run.stageIndex === 0 && hintsLeft() > 0 ? [...(ballMode ? HINTS_BALL : HINTS_OLD)] : [];
  if (hintQueue.length > 0) {
    try {
      localStorage.setItem(HINT_KEY, String(4 - hintsLeft()));
    } catch {
      // 기억하지 못하면 다음에도 보인다
    }
  }
}

/** 스테이지 하나의 기록을 런 기록에 더한다 */
function addRunStats(): void {
  if (!run || !g) return;
  run.bestChain = Math.max(run.bestChain, g.stats.maxChain);
  run.cushionPops += g.stats.cushionPops;
  run.threeCushions += g.stats.threeCushions;
}

function endStage(): void {
  if (!run || !g) return;
  run.popped += g.stats.poppedEnemies;
  addRunStats();
  if (run.stageIndex >= CAMPAIGN.length - 1) return finishRun(true);
  shop = openShop(g, { extraSlots: run.meta.specials.shopSlots, freeRerolls: run.meta.specials.freeRerolls });
  screen = "shop";
  renderShop();
}

function leaveShop(): void {
  if (!run || !g) return;
  run.carry = carryOf(g);
  run.stageIndex++;
  shop = null;
  beginStage();
}

function finishRun(won: boolean): void {
  if (!run || !g) return;
  if (!won) {
    run.popped += g.stats.poppedEnemies;
    addRunStats();
  }
  const reached = run.stageIndex + (won ? 1 : 0);
  // 남은 인게임 골드도 코인으로 바뀐다 (완주·실패 모두)
  const goldLeft = g.player.gold;
  const rc = runCoins(reached, run.popped, goldLeft);
  const coins = rc.total;
  let fresh: string[] = [];
  if (!run.dev) {
    const before = save;
    save = recordRun(save, {
      character: run.character,
      reached,
      won,
      coins,
      poppedEnemies: run.popped,
      cushionPops: run.cushionPops,
      threeCushions: run.threeCushions,
      maxChain: run.bestChain,
    });
    writeSave(store, save);
    fresh = newlyUnlocked(before, save);
  }
  screen = "result";
  const played = run.character;
  const name = CHAR_NAME[played] ?? played;
  show([
    el("p", "eyebrow", won ? "런 완주" : `스테이지 ${run.stageIndex + 1}에서 쓰러짐`),
    el("h1", "", won ? "목장을 지켰다" : "양 떼에 묻혔다"),
    el("p", "lede", `${name} · Lv${g.player.level} · 클리어 ${reached}/${CAMPAIGN.length} · 터뜨린 적 ${run.popped}`),
    el("p", "small", `가장 긴 연쇄 ${run.bestChain}${g.ball ? ` · 쿠션 팝 ${run.cushionPops} · 3쿠션 이상 ${run.threeCushions}` : ""}`),
    // 코인 줄은 짧게, 내역은 따로 (폰에서 "보유"가 두 줄로 갈라지던 것)
    el("p", "coins", run.dev ? "시험 판이라 기록과 코인에 넣지 않았다" : `코인 +${coins}`),
    ...(run.dev ? [] : [el("p", "small", `${rc.fromGold > 0 ? `남은 골드 ${Math.floor(goldLeft)} → 코인 ${rc.fromGold} · ` : ""}보유 ${save.coins}`)]),
    ...fresh.map((id) => el("p", "unlock-new", `새로 열림: ${CHAR_NAME[id] ?? id}`)),
    row([button(`${name} 영구 강화${affordable(played) > 0 ? ` · ${affordable(played)}개 살 수 있음` : ""}`, () => renderMeta(played)), button(fresh.length > 0 ? "캐릭터 고르기" : "다시 하기", () => renderSelect(), "btn ghost")]),
  ]);
  run = null;
}

function row(children: HTMLElement[], cls = "row"): HTMLElement {
  const r = el("div", cls);
  for (const c of children) r.append(c);
  return r;
}

/* ───────────────────────── 화면들 ───────────────────────── */

function renderTitle(): void {
  screen = "title";
  g = null;
  show(
    [
      el("p", "eyebrow", "색깔 몰이 서바이벌"),
      el("h1", "logo", "팝 셰퍼드"),
      el("p", "lede", "같은 색 양을 셋 이상 부딪히면 터진다. 날리고, 몰고, 연쇄로 목장을 지켜라."),
      row([button("시작", () => renderSelect()), button("영구 강화", () => renderMeta(), "btn ghost"), button("스테이지 시험", () => renderDevPick(), "btn ghost")]),
      row([
        button(`색 공 던지기 규칙: ${ballMode ? "켜짐" : "꺼짐"}`, () => {
          setBallMode(!ballMode);
          renderTitle();
        }, "btn ghost toggle"),
        button(`소리: ${isMuted() ? "꺼짐" : "켜짐"} (M)`, () => {
          setMuted(!isMuted());
          renderTitle();
        }, "btn ghost toggle"),
      ]),
      el("p", "small", ballMode ? COARSE ? "색 공 규칙: 톡 치면 그곳으로 던진다. 같은 색 무리에 맞혀 3마리를 채우면 터진다." : "색 공 규칙: 마우스로 조준하고 클릭으로 던진다. 같은 색 무리에 맞혀 3마리를 채우면 터진다." : "기존 규칙: 날아간 적이 같은 색에 세게 부딪혀야 터진다."),
      ...refundNotice(),
      el("p", "small", `기록: ${save.runs}런 · 완주 ${save.wins} · 최고 ${save.bestStage}스테이지`),
      el("p", "small", `영구 강화 · ${CHAR_ORDER.filter((id) => CHARACTERS[id] && isCharacterUnlocked(save, id)).map((id) => `${CHAR_NAME[id] ?? id} ${Math.round(treeProgress(save, id) * 100)}%`).join(" · ")}`),
      // 터치 화면이면 손가락 조작을 알려 준다 (폰에서 WASD·마우스 안내가 나오던 것)
      el("p", "small keys", COARSE
        ? `이동 누르고 끌기 · ${ballMode ? "던지기 톡 · 공 바꾸기 '바꾸기' 버튼 · " : ""}휘슬 '휘슬' 버튼`
        : `이동 WASD/방향키 · ${ballMode ? "조준 마우스 · 던지기 클릭 · 공 바꾸기 오른쪽 클릭/Q · " : ""}휘슬 Space · 일시정지 Esc · 카드 1/2/3`),
    ],
    "panel title",
  );
}

/** 해금 조건 하나의 진행 글: "최고 스테이지 3/5", "쿠션 팝 23/60" */
const STAT_LABEL: Record<string, string> = {
  reached: "클리어 스테이지",
  cushionPops: "쿠션 팝",
  threeCushions: "3쿠션 팝",
  poppedEnemies: "터뜨린 적",
  maxChain: "연쇄",
  runs: "판",
};
function conditionText(c: UnlockCondition): string {
  const v = Math.min(c.n, statValue(save, c.kind, c.stat));
  return `${c.kind === "best" && c.stat !== "runs" ? "최고 " : ""}${STAT_LABEL[c.stat] ?? c.stat} ${v}/${c.n}`;
}

function renderSelect(): void {
  screen = "select";
  const cards = row(
    CHAR_ORDER.filter((id) => CHARACTERS[id]).map((id) => {
      const ch = CHARACTERS[id]!;
      const open = isCharacterUnlocked(save, id);
      const b = button("", () => startRun(id), open ? "char" : "char locked");
      const s = ch.stats;
      b.append(el("strong", "", `${open ? "" : "🔒 "}${CHAR_NAME[id] ?? id}`), el("span", "weapon", `시작 무기 · ${weaponName(ch.startWeapon)}`), el("span", "", CHAR_BLURB[id] ?? ""));
      b.append(el("span", "stats", `체력 ${s.max_hp} · 방어 ${s.armor} · 속도 ${Math.round(s.move_speed * 100)}%`));
      const extra = statExtras(s);
      if (extra) b.append(el("span", "stats", extra));
      if (open) {
        const rec = save.characters[id];
        if (rec) b.append(el("span", "rec", `${rec.runs}런 · 완주 ${rec.wins} · 최고 ${rec.bestStage}`));
        const tp = treeProgress(save, id);
        if (tp > 0) b.append(el("span", "rec", `영구 강화 ${Math.round(tp * 100)}%`));
      } else {
        const rule = UNLOCKS.characters[id];
        b.disabled = true;
        b.setAttribute("aria-label", `${CHAR_NAME[id] ?? id}: 잠김. ${rule?.text ?? ""}`);
        if (rule) {
          b.append(el("span", "cond", `열리는 조건 · ${rule.text}`));
          // 가장 많이 채운 조건부터 보여 준다
          const sorted = [...rule.any].sort((x, y) => conditionProgress(save, y) - conditionProgress(save, x));
          b.append(el("span", "cond-progress", sorted.map(conditionText).join(" · ")));
        }
      }
      return b;
    }),
    "chars",
  );
  const locked = CHAR_ORDER.filter((id) => CHARACTERS[id] && !isCharacterUnlocked(save, id)).length;
  show([
    el("p", "eyebrow", "캐릭터"),
    el("h2", "", "누구로 몰까"),
    cards,
    ...(locked > 0 ? [el("p", "small", "잠긴 캐릭터는 런 기록으로 열린다. 스테이지 시험에서는 모든 캐릭터를 써 볼 수 있다 (기록에 남지 않음).")] : []),
    row([button("뒤로", () => renderTitle(), "btn ghost")]),
  ]);
}

function renderShop(): void {
  if (!g || !shop || !run) return;
  const st = shop;
  const items = row(
    st.items.map((it, i) => {
      const info = it.card.kind === "heal" ? { title: "체력 회복", body: `최대 체력의 ${Math.round(SHOP.healFrac * 100)}%`, tag: "회복" } : cardInfo(g!, it.card);
      const b = button("", () => {
        buy(g!, st, i);
        renderShop();
      }, "card");
      b.disabled = it.sold || g!.player.gold < it.price;
      b.append(el("span", "tag", info.tag), el("strong", "", info.title), el("span", "", info.body), el("span", "price", it.sold ? "샀음" : `${it.price} 골드`));
      return b;
    }),
    "cards",
  );
  const rr = button(st.freeRerolls > 0 ? `새로고침 (무료 ${st.freeRerolls})` : `새로고침 ${SHOP.rerollCost} 골드`, () => {
    reroll(g!, st, SHOP.slots + run!.meta.specials.shopSlots);
    renderShop();
  }, "btn ghost");
  rr.disabled = st.freeRerolls <= 0 && g.player.gold < SHOP.rerollCost;
  show([
    el("p", "eyebrow", `스테이지 ${run.stageIndex + 1} 클리어`),
    ...(g.stats.vanished > 0 ? [el("p", "small", `남은 적 ${g.stats.vanished}마리가 흩어지며 경험치 +${Math.round(g.stats.clearXp)}`)] : []),
    el("h2", "", "정비 상점"),
    el("p", "lede", `골드 ${Math.floor(g.player.gold)} · 체력 ${Math.ceil(g.player.hp)}/${g.player.maxHp}`),
    el("p", "small", `남은 골드는 런이 끝나면 영구 강화 코인이 된다 (지금 끝나면 코인 +${runCoins(0, 0, g.player.gold).fromGold})`),
    items,
    row([rr, button(`스테이지 ${run.stageIndex + 2}로`, () => leaveShop())]),
  ]);
}

/**
 * 영구 강화가 캐릭터별로 바뀌며 돌려받은 코인 안내 (예전 세이브에서 한 번).
 * 보여 주면 세이브에서 지운다 (제목 화면이나 영구 강화 화면 중 먼저 뜬 곳에 한 번).
 */
function refundNotice(): HTMLElement[] {
  if (save.metaRefund <= 0) return [];
  const n = save.metaRefund;
  save = acknowledgeRefund(save);
  writeSave(store, save);
  return [el("p", "notice", `영구 강화가 캐릭터별 트리로 바뀌어, 쓴 코인 ${n}을 모두 돌려받았다. 캐릭터마다 다시 골라 보자.`)];
}

/** 지금 코인으로 바로 살 수 있는 노드 수 (결과 화면 버튼에 알려 준다) */
function affordable(ch: string): number {
  const profile = profileOf(save, ch);
  return nodesFor(ch).filter((n) => {
    const c = costFor(save.meta, ch, n.id);
    return c !== null && isUnlocked(profile, n.id) && c.cost <= save.coins;
  }).length;
}

/** 영구 강화 화면에서 보고 있는 캐릭터 */
let metaChar = "";

function renderMeta(characterId?: string): void {
  screen = "meta";
  const open = CHAR_ORDER.filter((id) => CHARACTERS[id] && isCharacterUnlocked(save, id));
  if (characterId && open.includes(characterId)) metaChar = characterId;
  if (!open.includes(metaChar)) metaChar = open[0] ?? "shepherd";
  const ch = metaChar;
  const profile = profileOf(save, ch);
  const chName = CHAR_NAME[ch] ?? ch;
  // 캐릭터 탭: 열린 캐릭터만 고를 수 있고, 탭마다 트리 진행률
  const tabs = row(
    CHAR_ORDER.filter((id) => CHARACTERS[id]).map((id) => {
      const isOpen = open.includes(id);
      const b = button("", () => renderMeta(id), id === ch ? "ctab on" : "ctab");
      b.setAttribute("aria-pressed", String(id === ch));
      b.disabled = !isOpen;
      b.append(el("strong", "", `${isOpen ? "" : "🔒 "}${CHAR_NAME[id] ?? id}`), el("span", "", isOpen ? `${Math.round(treeProgress(save, id) * 100)}%` : "잠김"));
      const bar = el("span", "tbar");
      bar.style.setProperty("--p", `${Math.round(treeProgress(save, id) * 100)}%`);
      b.append(bar);
      return b;
    }),
    "ctabs",
  );
  const branches: [string, string][] = [["own", `${chName} 전용`], ["survival", "생존"], ["power", "화력"], ["cue", "솜씨"], ["economy", "경제"]];
  const nodes = nodesFor(ch);
  const cols = row(
    branches.map(([key, label]) => {
      const col = el("div", key === "own" ? "branch own" : "branch");
      col.append(el("h3", "", label));
      for (const n of nodes.filter((x: MetaNode) => x.branch === key)) {
        const lv = profile[n.id] ?? 0;
        const c = costFor(save.meta, ch, n.id);
        const unlocked = isUnlocked(profile, n.id);
        const b = button("", () => {
          save = spendOnMeta(save, ch, n.id);
          writeSave(store, save);
          renderMeta(ch);
        }, "node");
        b.disabled = c === null || !unlocked || save.coins < c.cost;
        b.append(el("strong", "", `${n.name} ${lv}/${n.maxLevel}`), el("span", "", n.note));
        // 잠긴 노드는 무엇을 사야 열리는지 보여 준다
        const need = Object.entries(n.requires ?? {})
          .filter(([r, rl]) => (profile[r] ?? 0) < rl)
          .map(([r, rl]) => `${META.nodes.find((x: MetaNode) => x.id === r)?.name ?? r} ${rl}`)
          .join(", ");
        const short = c !== null && unlocked && save.coins < c.cost;
        const price = c === null ? "완료" : !unlocked ? `잠김 · ${need} 필요` : c.shared ? `${c.cost} 코인 · 익힌 기술 −${Math.round((META.shareDiscount ?? 0) * 100)}%` : `${c.cost} 코인`;
        b.append(el("span", "price", short ? `${price} · ${c!.cost - save.coins} 모자람` : price));
        // 코인만 모자란 노드는 잠긴 노드와 다르게 보인다 (다음 판 목표)
        if (short) b.classList.add("short");
        if (c === null) b.classList.add("done");
        col.append(b);
      }
      return col;
    }),
    "tree",
  );
  show([
    el("p", "eyebrow sticky-coins", `코인 ${save.coins} (모든 캐릭터 공용)`),
    el("h2", "", "영구 강화"),
    ...refundNotice(),
    tabs,
    el("p", "small", `${chName} 트리 ${Math.round(treeProgress(save, ch) * 100)}% · 산 강화는 ${chName}에게만 붙는다. 다른 캐릭터가 이미 익힌 공통 강화는 ${Math.round((META.shareDiscount ?? 0) * 100)}% 싸다.`),
    cols,
    row([button(`${chName}로 시작`, () => startRun(ch)), button("캐릭터 고르기", () => renderSelect(), "btn ghost"), button("처음으로", () => renderTitle(), "btn ghost")]),
  ]);
}

function renderChoice(): void {
  if (!g) return;
  validateFrontChoice(g);
  const ch = g.choices[0];
  if (!ch) return;
  choiceShown = true;
  sfx.levelUp();
  const pick = (i: number): void => {
    const c = ch.cards[i]!;
    if (needsBranch(g!, c)) return renderBranch(i);
    resolveChoice(g!, i);
    choiceShown = false;
    hideOverlay();
  };
  const cards = row(
    ch.cards.map((c, i) => {
      const info = cardInfo(g!, c);
      const b = button("", () => pick(i), "card");
      b.dataset.key = String(i + 1);
      b.append(el("span", "tag", `${i + 1} · ${info.tag}`), el("strong", "", info.title), el("span", "", info.body));
      return b;
    }),
    "cards",
  );
  show([el("p", "eyebrow", ch.kind === "chest" ? "보물 상자" : `레벨 ${ch.level}`), el("h2", "", ch.kind === "chest" ? "상자에서 하나" : "하나를 고른다"), cards]);
}

function renderBranch(i: number): void {
  if (!g) return;
  const c = g.choices[0]!.cards[i]!;
  if (c.kind !== "weaponUp") return;
  const w = g.weapons.find((x) => x.def.id === c.id)!;
  const opts = (["A", "B"] as const).map((b, k) => {
    const lv4 = weaponLevel(w.def, 4, b);
    const lv7 = weaponLevel(w.def, MAX_LEVEL, b);
    const btn = button("", () => {
      resolveChoice(g!, i, b);
      choiceShown = false;
      hideOverlay();
    }, "card");
    btn.dataset.key = String(k + 1);
    btn.append(el("span", "tag", `${k + 1} · 갈래 ${b}`), el("strong", "", lv4.note.split(":")[0] ?? b), el("span", "", lv4.note), el("span", "small", `Lv7 ${lv7.note}`));
    return btn;
  });
  show([el("p", "eyebrow", `${weaponName(w.def.id)} Lv4`), el("h2", "", "갈래를 고른다"), row(opts, "cards"), el("p", "small", "진화해도 고른 갈래의 Lv7 효과는 남는다.")]);
}

function renderPause(): void {
  paused = true;
  show([el("h2", "", "일시정지"), row([button("계속", () => resume()), button("포기하고 결과로", () => finishRun(false), "btn ghost")])]);
}

function resume(): void {
  paused = false;
  hideOverlay();
  if (g && g.choices.length > 0) renderChoice();
}

/* ───────────────────────── 입력 ───────────────────────── */

const keys = new Set<string>();
addEventListener("pointerdown", () => unlock(), { capture: true });
addEventListener("keydown", (e) => {
  unlock();
  keys.add(e.code);
  if (e.code === "KeyQ" && !e.repeat) swapTap = true;
  if (e.code === "KeyM") {
    setMuted(!isMuted());
    if (screen === "title") renderTitle();
  }
  if (e.code === "Escape" && screen === "play") {
    if (paused) resume();
    else if (!choiceShown) renderPause();
  }
  if (/^Digit[1-4]$/.test(e.code) && !overlay.hidden) {
    const b = overlay.querySelector<HTMLButtonElement>(`button[data-key="${e.code.slice(5)}"]`);
    b?.click();
  }
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && screen === "play") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

// 마우스: 조준과 던지기 (누르고 있으면 쿨다운마다 계속 던진다)
let mouse: { x: number; y: number } | null = null;
let mouseDown = false;
let tapThrow: { x: number; y: number } | null = null;
/** 지금 공과 다음 공 바꾸기: 오른쪽 클릭 또는 Q */
let swapTap = false;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse") mouse = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") {
    mouse = { x: e.clientX, y: e.clientY };
    if (e.button === 0) mouseDown = true;
    if (e.button === 2) swapTap = true;
  }
});
addEventListener("pointerup", (e) => {
  if (e.pointerType === "mouse" && e.button === 0) mouseDown = false;
});

// 터치: 누르고 끌면 그 방향으로 이동, 짧게 톡 치면 그곳으로 던지기, 휘슬 버튼
let touch: { id: number; x0: number; y0: number; x: number; y: number; t0: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now() };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (touch && e.pointerId === touch.id) {
    touch.x = e.clientX;
    touch.y = e.clientY;
  }
});
const endTouch = (e: PointerEvent): void => {
  if (touch && e.pointerId === touch.id) {
    if (Math.hypot(touch.x - touch.x0, touch.y - touch.y0) < 12 && performance.now() - touch.t0 < 250) tapThrow = { x: touch.x, y: touch.y };
    touch = null;
  }
};
canvas.addEventListener("pointerup", endTouch);
canvas.addEventListener("pointercancel", endTouch);
let whistleTap = false;
$("swap").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  swapTap = true;
});
$("pausebtn").addEventListener("click", () => {
  if (screen === "play" && !paused && !choiceShown) renderPause();
});
// 다른 앱으로 넘어가면 멈춘다 (돌아왔을 때 바로 맞지 않게)
document.addEventListener("visibilitychange", () => {
  if (document.hidden && screen === "play" && !paused && !choiceShown && !auto) renderPause();
});
$("whistle").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  whistleTap = true;
});

/** 화면 좌표(CSS px) → 월드 좌표 */
function screenToWorld(v: View, sx: number, sy: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const dpr = canvas.width / Math.max(1, r.width);
  return { x: v.camX + ((sx - r.left) * dpr - v.ox) / v.scale, y: v.camY + ((sy - r.top) * dpr - v.oy) / v.scale };
}

let view: View | null = null;

function aimPoint(): { x: number; y: number } | null {
  if (!g || !view) return null;
  if (mouse) return screenToWorld(view, mouse.x, mouse.y);
  return { x: g.player.x + g.player.faceX * 200, y: g.player.y + g.player.faceY * 200 };
}

function readInput(): Input {
  if (auto && g) return botInput(g);
  let x = 0;
  let y = 0;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
  if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
  if (touch) {
    const dx = touch.x - touch.x0;
    const dy = touch.y - touch.y0;
    if (Math.hypot(dx, dy) > 12) {
      x = dx;
      y = dy;
    }
  }
  const whistle = keys.has("Space") || whistleTap;
  whistleTap = false;
  let aim = aimPoint();
  let throwBall = mouseDown;
  if (tapThrow && view) {
    aim = screenToWorld(view, tapThrow.x, tapThrow.y);
    throwBall = true;
    tapThrow = null;
  }
  const swapBall = swapTap;
  swapTap = false;
  return { moveX: x, moveY: y, whistle, aimX: aim?.x, aimY: aim?.y, throwBall, swapBall };
}

/* ───────────────────────── 효과 ───────────────────────── */

/** 자동 플레이 점검용 기록: 보스·엘리트 등장과 처치, 스테이지 끝 (tools/realtime.mjs가 읽는다) */
function autoLog(game: Game): void {
  const st = run ? run.stageIndex + 1 : 0;
  for (const e of game.events) {
    if (e.type === "boss-spawn") dbg.log.push(`보스 등장 s${st} ${game.time.toFixed(1)}`);
    else if (e.type === "special-killed") dbg.log.push(`${e.rank === "boss" ? "보스" : "엘리트"} 처치 s${st} ${game.time.toFixed(1)} ${e.kind}`);
    else if (e.type === "stage-clear") dbg.log.push(`클리어 s${st} ${game.time.toFixed(1)} 체력 ${Math.round(game.player.hp)}/${Math.round(game.player.maxHp)}`);
    else if (e.type === "player-dead") dbg.log.push(`사망 s${st} ${game.time.toFixed(1)} 공격피해 ${Math.round(game.stats.damageFromAttacks)}/${Math.round(game.stats.damageTaken)}`);
    else if (e.type === "groggy") dbg.log.push(`그로기 s${st} ${game.time.toFixed(1)} ${e.why}`);
  }
}

function handleEvents(game: Game): void {
  if (auto) autoLog(game);
  for (const e of game.events) {
    switch (e.type) {
      case "pop": {
        const color = PALETTE[e.color === "rainbow" ? "yellow" : e.color];
        fx.push({ kind: "ring", x: e.x, y: e.y, t: 0, life: 0.45, color, radius: 60 + e.size * 12 });
        for (let k = 0; k < Math.min(24, e.size * 5); k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 120 + Math.random() * 260;
          fx.push({ kind: "spark", x: e.x, y: e.y, t: 0, life: 0.5 + Math.random() * 0.3, color, radius: 3 + Math.random() * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
        }
        shake = Math.min(14, shake + 3 + e.size * 1.5 + e.chainDepth * 2);
        sfx.pop(e.size, e.chainDepth);
        if (e.chainDepth >= 1 || e.size >= 5) hitStop = Math.max(hitStop, Math.min(0.09, 0.04 + e.chainDepth * 0.015 + Math.max(0, e.size - 4) * 0.01));
        if (e.chainDepth >= 1) fx.push({ kind: "text", x: e.x, y: e.y, t: 0, life: 0.9, color: "#fff3c4", text: `연쇄 ${e.chainDepth + 1}` });
        else if (e.cushions >= 3) {
          // 쓰리쿠션: 가장 큰 보너스. 크게 알리고 화면을 더 흔든다
          fx.push({ kind: "text", x: e.x, y: e.y, t: 0, life: 1.4, color: "#ffcf5a", text: `${e.cushions}쿠션! +${Math.round((RULES.ball.cushionBonus[3] ?? 0) * 100)}%` });
          shake = Math.min(18, shake + 6);
          hitStop = Math.max(hitStop, 0.08);
        } else if (e.cushions >= 1) {
          fx.push({ kind: "text", x: e.x, y: e.y, t: 0, life: 1, color: "#9fe3ff", text: `${e.cushions}쿠션 +${Math.round((RULES.ball.cushionBonus[e.cushions] ?? 0) * 100)}%` });
        } else if (e.cushion) fx.push({ kind: "text", x: e.x, y: e.y, t: 0, life: 0.9, color: "#9fe3ff", text: "쿠션!" });
        break;
      }
      case "player-hit":
        hitFlash = 0.25;
        shake = Math.min(14, shake + 6);
        sfx.hit();
        break;
      case "fire": {
        // 무기 발사선: 올가미는 줄, 킥·페인트는 짧은 선, 충격파는 고리
        const p = game.player;
        const look: Record<string, { color: string; w: number }> = {
          lasso: { color: "#e9c46a", w: 4 },
          kick: { color: "#f4efe1", w: 6 },
          paint_gun: { color: "#ff8fd8", w: 3 },
        };
        const st = look[e.weapon];
        if (st) {
          for (const id of e.ids) {
            const t = game.enemies.find((x) => x.id === id);
            if (t) fx.push({ kind: "line", x: p.x, y: p.y, x2: t.x, y2: t.y, t: 0, life: e.weapon === "lasso" ? 0.35 : 0.18, color: st.color, radius: st.w });
          }
        }
        if (e.weapon === "shockwave") {
          const w = game.weapons.find((x) => x.def.id === "shockwave");
          fx.push({ kind: "ring", x: p.x, y: p.y, t: 0, life: 0.3, color: "#9fe3ff", radius: (w?.level.params.radius ?? 130) * p.stats.area * 1.4 });
        }
        break;
      }
      case "ball-throw":
        sfx.throwBall();
        break;
      case "chest-open":
        sfx.chest();
        break;
      case "stage-clear": {
        sfx.clear();
        clearHold = CLEAR_HOLD;
        banner = { text: "스테이지 클리어", sub: e.vanished > 0 ? `남은 양 ${e.vanished}마리가 흩어진다 · 경험치 +${Math.round(e.xp)}` : "", t: CLEAR_HOLD + 0.2 };
        // 남은 적은 흰 연기로 흩어진다 (터지는 팝과 구별, 많으면 일부만)
        const left = prevEnemies.filter((x) => !x.dead);
        const stride = Math.max(1, Math.ceil(left.length / 120));
        for (let k = 0; k < left.length; k += stride) {
          const x = left[k]!;
          fx.push({ kind: "ring", x: x.x, y: x.y, t: 0, life: 0.5 + Math.random() * 0.4, color: "rgba(235,240,245,0.75)", radius: x.radius + 10 });
          const a = Math.random() * Math.PI * 2;
          fx.push({ kind: "spark", x: x.x, y: x.y, t: 0, life: 0.8, color: x.color === "rainbow" ? "#ffffff" : PALETTE[x.color] + "aa", radius: x.radius * 0.6, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40 - 30 });
        }
        break;
      }
      case "blade-vanish": {
        // 회오리에 여러 번 맞아 사라진 적: 터지는 팝과 구별되게 회색 연기만 (점수 없음)
        fx.push({ kind: "ring", x: e.x, y: e.y, t: 0, life: 0.4, color: "rgba(220,225,230,0.7)", radius: 22 });
        for (let k = 0; k < 5; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 25 + Math.random() * 30;
          fx.push({ kind: "spark", x: e.x, y: e.y, t: 0, life: 0.6 + Math.random() * 0.3, color: "rgba(200,205,212,0.8)", radius: 5 + Math.random() * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20 });
        }
        break;
      }
      case "wind-start": {
        const dir = Math.abs(e.dx) > Math.abs(e.dy) ? (e.dx > 0 ? "→" : "←") : e.dy > 0 ? "↓" : "↑";
        banner = { text: `돌풍 ${dir}`, sub: "날아가는 공과 양이 바람에 휜다", t: 1.6 };
        break;
      }
      case "ball-swap":
        sfx.stick();
        aimCache = null;
        break;
      case "ball-cushion":
        sfx.stick();
        fx.push({ kind: "ring", x: e.x, y: e.y, t: 0, life: 0.25, color: "#9fe3ff", radius: 26 });
        fx.push({ kind: "text", x: e.x, y: e.y - 18, t: 0, life: 0.6, color: e.n >= 3 ? "#ffcf5a" : "#9fe3ff", text: String(e.n) });
        break;
      case "ball-miss":
        fx.push({ kind: "ring", x: e.x, y: e.y, t: 0, life: 0.25, color: "rgba(244,239,225,0.6)", radius: 20 });
        break;
      case "ball-stick":
        sfx.stick();
        fx.push({ kind: "ring", x: e.x, y: e.y, t: 0, life: 0.3, color: "#fff3c4", radius: 30 });
        break;
      case "whistle":
        sfx.whistle();
        fx.push({ kind: "ring", x: game.player.x, y: game.player.y, t: 0, life: 0.5, color: "#f4efe1", radius: RULES.whistle.radius });
        break;
      case "boss-spawn": {
        sfx.boss();
        const wool = game.enemies.find((x) => x.id === e.id)?.kind === "wool_giant";
        banner = wool
          ? { text: "양털 거인", sub: "빨간 바닥을 피하고, 머리 위 색 공을 맞혀라 · 돌진은 바위로 유인", t: 3.5 }
          : { text: "무지개 양치기", sub: "머리 위 색 공을 맞혀라 · 보호막은 쿠션 공으로 깬다", t: 3.5 };
        break;
      }
      case "elite-spawn": {
        const sub: Record<string, string> = {
          chief_jelly: "내려찍기를 피하고, 몸 색 공을 맞혀라",
          chameleon: "혀를 피하고, 몸 색 공을 맞혀라 (색이 바뀐다)",
          armored: "돌진을 바위로 유인해 기절시켜라",
        };
        banner = { text: "엘리트 등장", sub: sub[e.kind] ?? "곁에서 터뜨리면 보물 상자", t: 2.5 };
        break;
      }
      case "boss-phase":
        banner = { text: "2단계", sub: "공격이 빨라진다", t: 2 };
        break;
      case "weak-hit":
        fx.push({ kind: "ring", x: e.x, y: e.y, t: 0, life: 0.45, color: "#ffcf5a", radius: 70 });
        fx.push({ kind: "text", x: e.x, y: e.y - 30, t: 0, life: 1.1, color: "#ffcf5a", text: e.cushions > 0 ? `약점! ${e.cushions}쿠션` : "약점!" });
        shake = Math.min(16, shake + 6);
        hitStop = Math.max(hitStop, 0.06);
        sfx.pop(4, 1);
        break;
      case "groggy": {
        const t = game.enemies.find((x) => x.id === e.id);
        if (t) fx.push({ kind: "text", x: t.x, y: t.y - t.radius - 30, t: 0, life: 1.6, color: "#fff6b0", text: e.why === "crash" ? "쾅! 그로기" : "보호막 깨짐! 그로기" });
        shake = Math.min(18, shake + 8);
        hitStop = Math.max(hitStop, 0.1);
        sfx.chest();
        break;
      }
      case "shield-up":
        banner = { text: "무지개 보호막", sub: `울타리에 튕긴 공으로 쿠션 ${e.need}개를 채워 깨라`, t: 2.5 };
        break;
      case "shield-chip": {
        const t = game.enemies.find((x) => x.id === e.id);
        if (t) fx.push({ kind: "text", x: t.x, y: t.y + t.radius + 30, t: 0, life: 0.9, color: "#9fe3ff", text: e.left > 0 ? `보호막 ${e.left}` : "" });
        sfx.stick();
        break;
      }
      case "telegraph":
        sfx.warn();
        break;
      case "wrapup-start":
        banner = { text: "마무리", sub: `${RULES.stage.wrapUpSeconds}초 동안 경험치 +${Math.round(RULES.stage.wrapUpXpBonus * 100)}%`, t: 2.5 };
        break;
      case "evolve":
        banner = { text: `${weaponName(e.weapon)} 진화`, sub: "", t: 2.5 };
        break;
      case "player-revive":
        banner = { text: "두 번째 기회", sub: "", t: 2 };
        break;
    }
  }
}

/* ───────────────────────── HUD ───────────────────────── */

interface BarRefs {
  root: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
}
function bar(label: string, frac: number, color: string, text: string): BarRefs {
  const b = el("div", "bar");
  const fill = el("div", "fill");
  fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  fill.style.background = color;
  const lab = el("span", "label", `${label} ${text}`);
  b.append(fill, lab);
  return { root: b, fill, label: lab };
}

/** 바뀔 때만 DOM을 건드린다 (같은 값을 다시 넣어도 스타일 계산이 다시 돈다) */
function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}
function setBar(b: BarRefs, frac: number, text: string, color?: string): void {
  const w = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  if (b.fill.style.width !== w) b.fill.style.width = w;
  // style.background는 rgb()로 바뀌어 읽히므로 넣은 값을 따로 기억해 비교한다
  if (color && b.fill.dataset.c !== color) {
    b.fill.dataset.c = color;
    b.fill.style.background = color;
  }
  setText(b.label, text);
}

/**
 * HUD는 구조(무기 목록, 보스 막대, 색 공 칸)가 바뀔 때만 새로 만들고, 그 밖에는 글자·막대 길이만 바꾼다.
 * 예전에는 10Hz마다 통째로 다시 만들어 폰에서 스타일·배치 계산이 프레임을 가끔 늦췄다 (docs/2026-11-24-성능.md). 보이는 것은 같다.
 */
interface HudRefs {
  sig: string;
  hp: BarRefs;
  goal: HTMLElement;
  gold: HTMLElement;
  boss: BarRefs | null;
  lv: BarRefs;
  whistle: HTMLElement;
  cur: HTMLElement | null;
  next: HTMLElement | null;
}
let hudRefs: HudRefs | null = null;
let hudTick = 0;
function renderHud(game: Game): void {
  hudTick++;
  if (hudTick % 6 !== 0) return; // 10Hz면 충분하다
  const p = game.player;
  const st = game.stage!;
  const lvFrom = xpTotalFor(p.level);
  const lvTo = xpTotalFor(p.level + 1);
  let goal: string;
  if (game.phase === "wrapup") goal = `마무리 ${Math.max(0, Math.ceil(game.wrapUpAt + RULES.stage.wrapUpSeconds - game.time))}초`;
  else if (st.clear === "boss") {
    const boss = game.enemies.find((e) => e.rank === "boss");
    goal = boss ? `보스 ${Math.ceil(Math.max(0, boss.hp))}/${boss.maxHp}` : `보스 등장까지 ${Math.max(0, Math.ceil((st.boss?.at ?? 0) - game.time))}초`;
  } else if (st.clear === "elites") goal = `엘리트 ${game.stats.elitesKilled}/${st.elites?.length ?? 0}`;
  else goal = `${Math.floor(Math.max(0, st.duration - game.time) / 60)}:${String(Math.floor(Math.max(0, st.duration - game.time) % 60)).padStart(2, "0")}`;
  const boss = game.enemies.find((e) => e.rank === "boss");
  const weaponTexts = game.weapons.map((w) => `${w.def.name} ${w.level.lv === "evo" ? "진화" : `Lv${w.level.lv}${w.level.branch ?? ""}`}`);
  const sig = `${boss ? "B" : ""}|${game.ball ? "ball" : ""}|${weaponTexts.join(",")}`;
  const hpText = `${Math.ceil(Math.max(0, p.hp))}/${p.maxHp}`;
  const lvFrac = (game.stats.xp - lvFrom) / Math.max(1, lvTo - lvFrom);
  const bossColor = boss ? PALETTE[boss.color === "rainbow" ? "yellow" : boss.color] : "";
  const whistleText = p.whistleCd > 0 ? `휘슬 ${Math.ceil(p.whistleCd)}초` : "휘슬 준비";
  const goldText = `골드 ${Math.floor(p.gold)}`;
  if (!hudRefs || hudRefs.sig !== sig || !hud.firstChild) {
    const top = el("div", "top");
    const hp = bar("체력", p.hp / p.maxHp, "#ff6b6b", hpText);
    const goalEl = el("div", "goal", goal);
    const goldEl = el("div", "gold", goldText);
    top.append(hp.root, goalEl, goldEl);
    const bottom = el("div", "bottom");
    const bossBar = boss ? bar("보스", boss.hp / boss.maxHp, bossColor, "") : null;
    if (bossBar) bottom.append(bossBar.root);
    const lv = bar(`Lv${p.level}`, lvFrac, "#9fe3ff", "");
    bottom.append(lv.root);
    const ws = el("div", "weapons");
    for (const t of weaponTexts) ws.append(el("span", "w", t));
    const whistle = el("span", "w whistle-cd", whistleText);
    ws.append(whistle);
    let cur: HTMLElement | null = null;
    let next: HTMLElement | null = null;
    if (game.ball) {
      const ball = el("span", "w balls");
      cur = el("span", "dot", "");
      next = el("span", "dot", "");
      ball.append(el("span", "", "공"), cur, el("span", "", "다음"), next);
      ws.append(ball);
    }
    bottom.append(ws);
    hud.replaceChildren(top, bottom);
    hudRefs = { sig, hp, goal: goalEl, gold: goldEl, boss: bossBar, lv, whistle, cur, next };
    // 터치 버튼(휘슬·바꾸기)은 아래 HUD 위에 놓는다 (보스 막대·무기 두 줄이면 휘슬이 보스 막대를 가리던 것)
    document.documentElement.style.setProperty("--hud-bottom", `${Math.ceil(innerHeight - bottom.getBoundingClientRect().top)}px`);
  }
  const r = hudRefs;
  setBar(r.hp, p.hp / p.maxHp, `체력 ${hpText}`);
  setText(r.goal, goal);
  setText(r.gold, goldText);
  if (r.boss && boss) setBar(r.boss, boss.hp / boss.maxHp, "보스 ", bossColor);
  setBar(r.lv, lvFrac, `Lv${p.level} `);
  setText(r.whistle, whistleText);
  if (game.ball && r.cur && r.next) {
    const c = PALETTE[game.ball.current as keyof typeof PALETTE];
    const n = PALETTE[game.ball.next as keyof typeof PALETTE];
    if (r.cur.style.getPropertyValue("--c") !== c) r.cur.style.setProperty("--c", c);
    if (r.next.style.getPropertyValue("--c") !== n) r.next.style.setProperty("--c", n);
  }
}

/* ───────────────────────── 루프 ───────────────────────── */

/**
 * 그리기 해상도 (캔버스 픽셀 / CSS 픽셀). 처음에는 기기 배율(최대 2)이고, 느린 기기에서만 낮춘다.
 * 폰 성능 점검(tools/perf.ts, CPU 4배 감속)에서 병목은 시뮬·그리기 코드가 아니라 캔버스 픽셀 수였다:
 * 해상도 2 → 24fps, 1.5 → 41, 1.25 → 49, 1 → 58. 그래서 판 중 프레임 간격 중앙값이 20ms(50fps 아래)를 넘으면
 * 0.25씩 낮추고, 한 번 느렸던 해상도로는 다시 올리지 않는다 (오르내림 없이 한 번 자리 잡는다).
 * 빠른 기기에서는 해상도가 그대로라 화면이 전과 같다. 시뮬(결정론)에는 영향이 없다.
 */
const MAX_RENDER_SCALE = Math.min(2, window.devicePixelRatio || 1);
/** 지난번에 자리 잡은 해상도 (다음에 열 때 처음 몇 초 끊기지 않게). 빨라졌으면 다시 천천히 올라간다 */
const RENDER_KEY = "pop-shepherd-render-scale";
let renderScale = (() => {
  try {
    const v = Number(localStorage.getItem(RENDER_KEY));
    return v >= 1 && v < MAX_RENDER_SCALE ? v : MAX_RENDER_SCALE;
  } catch {
    return MAX_RENDER_SCALE;
  }
})();
function rememberScale(): void {
  try {
    localStorage.setItem(RENDER_KEY, String(renderScale));
  } catch {
    // 기억하지 못하면 다음에도 처음부터 맞춘다
  }
}
const slowScales = new Set<number>();
let gapWindow: number[] = [];
let fastWindows = 0;

function adaptResolution(gap: number): void {
  if (gap > 250) return; // 탭 전환 등 (실제 느림이 아님)
  gapWindow.push(gap);
  if (gapWindow.length < 60) return;
  const sorted = [...gapWindow].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  gapWindow = [];
  if (median > 20 && renderScale > 1) {
    slowScales.add(renderScale);
    renderScale = Math.max(1, renderScale - 0.25);
    fastWindows = 0;
    resize();
    rememberScale();
  } else if (median <= 17.5) {
    // 충분히 빠르면 (이전에 느렸던 적 없는 해상도로만) 천천히 올린다
    fastWindows++;
    const up = Math.min(MAX_RENDER_SCALE, renderScale + 0.25);
    if (fastWindows >= 4 && up > renderScale && !slowScales.has(up)) {
      renderScale = up;
      fastWindows = 0;
      resize();
      rememberScale();
    }
  } else fastWindows = 0;
}

function resize(): void {
  const dpr = renderScale;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
addEventListener("resize", resize);
resize();

let last = performance.now();
let acc = 0;
let clock = 0;
const DT = 1 / RULES.tickHz;

/**
 * 프레임 시간 측정 (성능 점검용, window.__pop.perf). sim = 시뮬 틱(step+이벤트), draw = 월드 그리기,
 * hud = HUD DOM, gap = 앞 프레임과의 간격(브라우저 그리기 포함). __pop.perfReset()으로 0부터.
 */
const perf = { frames: 0, steps: 0, sim: 0, draw: 0, hud: 0, total: 0, maxTotal: 0, gaps: [] as number[] };
function perfReset(): void {
  Object.assign(perf, { frames: 0, steps: 0, sim: 0, draw: 0, hud: 0, total: 0, maxTotal: 0, gaps: [] });
}

function frame(now: number): void {
  const t0 = performance.now();
  if (g && screen === "play" && !paused) {
    perf.gaps.push(now - last);
    adaptResolution(now - last);
  }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let tSim = 0;
  let tDraw = 0;
  let tHud = 0;
  clock += dt;
  if (g && screen === "play") {
    if (hitStop > 0) hitStop = Math.max(0, hitStop - dt);
    else if (!paused && g.choices.length === 0) {
      acc += dt * (auto?.speed ?? 1);
      let n = 0;
      const maxSteps = 5 * (auto?.speed ?? 1);
      const s0 = performance.now();
      while (acc >= DT && n < maxSteps) {
        prevEnemies = g.enemies;
        step(g, readInput());
        handleEvents(g);
        acc -= DT;
        n++;
        if (g.choices.length > 0 || g.phase === "cleared" || g.phase === "failed") break;
      }
      tSim = performance.now() - s0;
      perf.steps += n;
      if (n >= maxSteps) acc = 0;
    }
    if (g.choices.length > 0 && !choiceShown && !paused) renderChoice();
    if (g.choices.length === 0 && !paused) {
      if (g.phase === "cleared") {
        if (clearHold > 0) clearHold -= dt;
        else endStage();
      }
      else if (g.phase === "failed" || g.player.dead) finishRun(false);
    }
  }
  if (auto) autoTick(dt);
  for (const f of fx) f.t += dt;
  fx = fx.filter((f) => f.t < f.life);
  if (banner) banner.t -= dt;
  if (g && screen === "play" && hintQueue.length > 0 && g.time >= hintQueue[0]![0]) hint = { text: hintQueue.shift()![1], t: 7 };
  if (hint) {
    hint.t -= dt;
    if (hint.t <= 0) hint = null;
  }
  const hintEl = $("hint");
  hintEl.hidden = !(hint && screen === "play");
  if (hint && hintEl.textContent !== hint.text) hintEl.textContent = hint.text;
  if (banner && banner.t <= 0) banner = null;
  hitFlash = Math.max(0, hitFlash - dt);
  shake = Math.max(0, shake - dt * 40);

  if (g) {
    const v = computeView(g, canvas.width, canvas.height);
    view = v;
    // 보이는 월드 크기를 시뮬에 알려 준다: 적이 화면 밖에서 나타나고, 폭탄은 보이는 범위를 지운다
    g.view = { w: Math.max(RULES.view.w * 0.5, canvas.width / v.scale), h: Math.max(RULES.view.h * 0.5, canvas.height / v.scale) };
    // 화면 흔들림: 팝·피격 때 잠깐 (줄인 움직임 설정이면 끈다)
    const calm = REDUCED_MOTION?.matches ?? false;
    const sv = calm || shake <= 0 ? v : { ...v, ox: v.ox + (Math.random() - 0.5) * shake * v.scale, oy: v.oy + (Math.random() - 0.5) * shake * v.scale };
    if (g.ball && screen === "play") {
      aimTick++;
      if (!aimCache || aimTick % 6 === 0) {
        const ready = new Set<number>();
        for (const c of readyClusters(g, g.ball.current, 2)) for (const id of c.ids) ready.add(id);
        aimCache = { x: 0, y: 0, ready, line: true, cushions: 1 };
      }
      const a = aimPoint();
      if (a && aimCache) {
        aimCache.x = a.x;
        aimCache.y = a.y;
        // 조준 가이드: 스테이지 1은 끝까지, 2~3은 처음 25초만, 그 뒤로는 손에 든 공만 보인다.
        // 큐(당구사)는 늘 보이고 쿠션 3번까지 꺾인 길을 보여 준다
        const si = run?.stageIndex ?? 0;
        const cue = g.player.trait === "three_cushion";
        aimCache.line = cue || si === 0 || (si <= 2 && g.time < AIM_GUIDE_SECONDS);
        aimCache.cushions = cue ? 3 : 1;
      }
    } else aimCache = null;
    const d0 = performance.now();
    drawWorld(ctx, g, sv, fx, clock, aimCache);
    tDraw = performance.now() - d0;
    if (hitFlash > 0) {
      ctx.fillStyle = `rgba(255,60,60,${hitFlash})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (banner && screen === "play") {
      // 바쁜 화면 위에서도 읽히게: 어두운 띠를 깔고, 부제가 화면보다 넓으면 " · "에서 줄을 나눈다 (휴대폰 세로)
      ctx.textAlign = "center";
      ctx.globalAlpha = Math.min(1, banner.t * 2);
      // 세로 화면(휴대폰)은 플레이어가 화면 가운데라 배너를 더 위로 (첫 공격 예고를 가리지 않게)
      const cy = canvas.height * (canvas.height > canvas.width ? 0.16 : 0.3);
      const subFont = `${Math.round(22 * v.scale)}px "Gowun Dodum", sans-serif`;
      ctx.font = subFont;
      let lines = banner.sub ? [banner.sub] : [];
      if (banner.sub && ctx.measureText(banner.sub).width > canvas.width * 0.9) lines = banner.sub.split(" · ");
      const lh = 30 * v.scale;
      const top = cy - 50 * v.scale;
      const h = 66 * v.scale + lines.length * lh;
      ctx.fillStyle = "rgba(8,17,14,0.62)";
      ctx.fillRect(0, top, canvas.width, h);
      ctx.fillStyle = "#fff3c4";
      ctx.font = `${Math.round(48 * v.scale)}px Jua, "Gowun Dodum", sans-serif`;
      ctx.fillText(banner.text, canvas.width / 2, cy);
      ctx.font = subFont;
      ctx.fillStyle = "#e4f4ec";
      lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, cy + 38 * v.scale + i * lh));
      ctx.globalAlpha = 1;
    }
    const h0 = performance.now();
    if (screen === "play") renderHud(g);
    tHud = performance.now() - h0;
  } else {
    // 메뉴 배경: 천천히 흘러가는 양 떼
    ctx.fillStyle = "#0e1f1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const colors = ["red", "blue", "yellow", "green"] as const;
    for (let i = 0; i < 28; i++) {
      const x = ((i * 173 + clock * (30 + (i % 5) * 9)) % (canvas.width + 120)) - 60;
      const y = (i * 97) % canvas.height;
      ctx.fillStyle = PALETTE[colors[i % 4]!] + "55";
      ctx.beginPath();
      ctx.arc(x, y, 18 + (i % 3) * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  hud.hidden = screen !== "play";
  $("whistle").hidden = screen !== "play";
  $("swap").hidden = screen !== "play" || !g?.ball;
  $("pausebtn").hidden = screen !== "play" || paused || choiceShown;
  if (g && screen === "play" && !paused) {
    const total = performance.now() - t0;
    perf.frames++;
    perf.sim += tSim;
    perf.draw += tDraw;
    perf.hud += tHud;
    perf.total += total;
    perf.maxTotal = Math.max(perf.maxTotal, total);
  }
  requestAnimationFrame(frame);
}

/* ───────────────────────── 자동 플레이 (점검용) ───────────────────────── */

/**
 * 자동 플레이: 주소가 #auto 로 시작하면 봇이 실제 화면에서 런을 한다 (조작·카드·갈래·상점 버튼까지 실제 UI로).
 * #auto-cue-s15-x4 처럼 캐릭터, 시작 스테이지(s), 속도 배율(x)을 붙일 수 있다. -coh0 / -flock 은 응집 시험안(11/25). 시험 판이라 기록에 남지 않는다.
 * #auto-rec-x8 은 메타 흐름 점검용: 바로 시작하지 않고 제목 화면에서 기다린다. 메뉴(시작·캐릭터·영구 강화)는
 * 점검 도구(tools/metaflow.ts)가 실제 버튼으로 누르고, 판 안(카드·갈래·상점)만 봇이 한다. 이 판은 기록·코인에 남는다.
 * 점검 도구(Playwright)는 window.__pop 으로 상태를 읽는다.
 */
interface AutoState {
  character: string;
  stage: number;
  speed: number;
  /** 다음 UI 동작까지 남은 시간 (사람처럼 조금 기다렸다 누른다) */
  wait: number;
  runs: number;
  /** 기록에 남는 판 (메타 흐름 점검) */
  rec: boolean;
}
let auto: AutoState | null = null;

interface PopDebug {
  screen: string;
  stage: number;
  time: number;
  hp: number;
  maxHp: number;
  level: number;
  enemies: number;
  balls: number;
  fps: number;
  result: { won: boolean; reached: number; level: number } | null;
  runs: number;
  log: string[];
  /** 보스·엘리트 공격 예고 수, 보스 상태 (스크린샷 시점 고르기용): "" | "walk" | "groggy" | "shield" */
  hazards: number;
  boss: string;
  /** 그리기 해상도 (느린 기기에서 낮아진다) */
  renderScale: number;
  /** 지금 판의 캐릭터와 능력치 (영구 강화가 실제로 붙었는지 확인용) */
  player: { character: string; maxHp: number; revives: number; gold: number; stats: Record<string, number> } | null;
  /** 반사벽 중 가장 빨리 사라지는 벽의 남은 시간 (없으면 −1), 게임 단계 (스크린샷 시점 고르기용) */
  wallT: number;
  phase: string;
  /** 점검용: 지금 판에 무기를 준다 (스크린샷용, 예: give("whirlwind", 6, "A")) */
  give: (id: string, lv: number | "evo", branch?: string | null) => void;
}
const dbg: PopDebug = {
  screen: "", stage: 0, time: 0, hp: 0, maxHp: 0, level: 0, enemies: 0, balls: 0, fps: 0, result: null, runs: 0, log: [], hazards: 0, boss: "", player: null, renderScale: 0, wallT: -1, phase: "",
  give: (id, lv, branch = null) => {
    const def = WEAPONS[id];
    if (!g || !def) return;
    g.weapons = g.weapons.filter((w) => w.def.id !== id);
    g.weapons.push(makeWeapon(def, lv, branch));
  },
};
(globalThis as { __pop?: PopDebug }).__pop = dbg;
Object.assign(dbg, { perf, perfReset });
let fpsAcc = 0;
let fpsN = 0;

function parseAuto(): AutoState | null {
  const m = /^#auto(.*)$/.exec(location.hash);
  if (!m) return null;
  const st: AutoState = { character: "olly", stage: 1, speed: 1, wait: 0.5, runs: 0, rec: false };
  for (const t of (m[1] ?? "").split("-").filter(Boolean)) {
    if (CHARACTERS[t]) st.character = t;
    else if (/^s\d+$/.test(t)) st.stage = Number(t.slice(1));
    else if (t === "rec") st.rec = true;
    else if (/^x\d+$/.test(t)) st.speed = Math.max(1, Math.min(8, Number(t.slice(1))));
    // 11/25 응집 시험안 화면 비교용: coh0 = 응집 없앰, flock = 짝이 무리로 함께 걷기
    else if (t === "coh0") (RULES.cohesion as { speed: number }).speed = 0;
    else if (t === "flock") (RULES.cohesion as { mode: string }).mode = "flock";
  }
  return st;
}

/** 오버레이에서 글자가 맞는 버튼 (없으면 null) */
function overlayButton(pred: (b: HTMLButtonElement) => boolean): HTMLButtonElement | null {
  return ([...overlay.querySelectorAll("button")] as HTMLButtonElement[]).find((b) => !b.disabled && pred(b)) ?? null;
}

function autoTick(dt: number): void {
  const a = auto!;
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc >= 1) {
    dbg.fps = Math.round(fpsN / fpsAcc);
    fpsAcc = 0;
    fpsN = 0;
  }
  dbg.screen = screen;
  dbg.runs = a.runs;
  if (g) {
    dbg.stage = run ? run.stageIndex + 1 : dbg.stage;
    dbg.time = g.time;
    dbg.hp = g.player.hp;
    dbg.maxHp = g.player.maxHp;
    dbg.renderScale = renderScale;
    dbg.level = g.player.level;
    dbg.player = { character: run?.character ?? "", maxHp: g.player.maxHp, revives: g.player.revives, gold: g.player.gold, stats: { ...g.player.stats } };
    dbg.enemies = g.enemies.filter((e) => !e.dead).length;
    dbg.balls = g.balls.length;
    dbg.hazards = g.hazards.length;
    dbg.wallT = g.walls.length ? Math.min(...g.walls.map((w) => w.t)) : -1;
    dbg.phase = g.phase;
    const bs = g.enemies.find((e) => e.rank === "boss" && !e.dead)?.boss;
    dbg.boss = !bs ? "" : bs.groggy > 0 ? "groggy" : bs.shield > 0 ? "shield" : "walk";
  }
  a.wait -= dt;
  if (a.wait > 0) return;
  a.wait = 0.4 / a.speed;
  if (screen === "play" && g && choiceShown && g.choices[0]) {
    // 카드 고르기 또는 갈래 고르기: 봇이 고른 번호의 실제 버튼을 누른다
    // 갈래 화면은 제목(h2)으로 가린다 (카드 설명 "갈래를 고른다: A 또는 B"와 헷갈려 멈춘 적이 있다)
    const branchScreen = overlay.querySelector("h2")?.textContent === "갈래를 고른다";
    let idx: number;
    if (branchScreen) {
      const c = g.choices[0].cards.find((x) => x.kind === "weaponUp" && needsBranch(g!, x));
      const w = c && c.kind === "weaponUp" ? g.weapons.find((x) => x.def.id === c.id) : undefined;
      idx = w && botChooseBranch(w, g) === "B" ? 1 : 0;
    } else idx = botChooseCard(g.choices[0].cards, g);
    const btn = overlay.querySelector(`button[data-key="${idx + 1}"]`) as HTMLButtonElement | null;
    if (btn) {
      dbg.log.push(`${dbg.stage}스테이지 ${g.time.toFixed(0)}초 Lv${g.player.level}: ${btn.querySelector("strong")?.textContent ?? "?"}`);
      btn.click();
    } else dbg.log.push(`오류: 카드 버튼 ${idx + 1}이 없음`);
    return;
  }
  if (screen === "shop") {
    // 시뮬의 봇 상점과 같은 점수로 고른다 (체력이 60% 아래면 회복부터). 살 것이 없으면 다음 스테이지로
    if (g && shop) {
      const sc = (i: number): number => {
        const it = shop!.items[i]!;
        if (it.sold || it.price > g!.player.gold) return 0;
        if (it.card.kind === "heal") return g!.player.hp < g!.player.maxHp * 0.6 ? 200 : g!.player.hp < g!.player.maxHp * 0.85 ? 30 : 0;
        return botCardScore(it.card, g!);
      };
      let best = -1;
      for (let i = 0; i < shop.items.length; i++) if (sc(i) > 0 && (best < 0 || sc(i) > sc(best))) best = i;
      const cards = [...overlay.querySelectorAll("button.card")] as HTMLButtonElement[];
      const card = best >= 0 ? cards[best] : undefined;
      if (card && !card.disabled) {
        dbg.log.push(`상점: ${card.querySelector("strong")?.textContent ?? "?"}`);
        card.click();
        return;
      }
    }
    overlayButton((b) => /^스테이지 \d+로$/.test(b.textContent ?? ""))?.click();
    return;
  }
  if (screen === "result") {
    if (!dbg.result) {
      const lede = overlay.querySelector(".lede")?.textContent ?? "";
      const won = overlay.textContent?.includes("런 완주") ?? false;
      const reached = Number(/클리어 (\d+)/.exec(lede)?.[1] ?? 0);
      dbg.result = { won, reached, level: Number(/Lv(\d+)/.exec(lede)?.[1] ?? 0) };
      dbg.log.push(`결과: ${won ? "완주" : "실패"} · ${lede}`);
      a.runs++;
    }
  }
}

/** 시험 판에서 고를 캐릭터 (스테이지 시험 화면) */
let devChar = "shepherd";

/**
 * 스테이지 시험: 캐릭터와 스테이지를 골라 바로 시작한다. 기록·코인에는 넣지 않는다.
 * 스테이지 2 이후는 봇 런에서 그 스테이지 시작 때 실제로 가진 레벨·무기·패시브로 시작한다 (체력은 가득).
 */
function renderDevPick(): void {
  screen = "select";
  const chars = row(
    CHAR_ORDER.map((id) => button(`${devChar === id ? "● " : ""}${CHAR_NAME[id] ?? id}`, () => {
      devChar = id;
      renderDevPick();
    }, devChar === id ? "btn" : "btn ghost")),
  );
  const stages = row(
    CAMPAIGN.map((id, i) => {
      const st = stage(id);
      const boss = st.clear === "boss" ? " (보스)" : st.clear === "elites" ? " (엘리트)" : "";
      return button(`${i + 1}${boss}`, () => devBegin(devChar, i + 1), i === CAMPAIGN.length - 1 ? "btn" : "btn ghost");
    }),
  );
  const b = DEV_BUILDS[devChar]?.[String(CAMPAIGN.length)];
  show([
    el("p", "eyebrow", "시험 판 · 기록에 남지 않음"),
    el("h2", "", "스테이지 시험"),
    el("p", "lede", "캐릭터를 고르고 스테이지를 누르면 바로 시작한다. 뒤 스테이지는 봇이 실제로 거기까지 가며 만든 빌드로 시작한다 (체력은 가득)."),
    chars,
    stages,
    el("p", "small", b ? `스테이지 ${CAMPAIGN.length} 빌드: Lv${b.level} · ${b.weapons.map((w) => `${weaponName(w.id)} ${lvText(w.lv)}`).join(", ")}` : ""),
    el("p", "small", "주소 끝에 #stage15 나 #stage15-cue 를 붙여도 바로 시작한다."),
    row([button("돌아가기", () => renderTitle(), "btn ghost")]),
  ]);
}

/** 시험 판 시작: n번째 스테이지부터 */
function devBegin(characterId: string, n: number): void {
  n = Math.min(CAMPAIGN.length, Math.max(1, n));
  startRun(characterId);
  if (!run) return;
  run.dev = true;
  if (n === 1) return;
  const carry = DEV_BUILDS[characterId]?.[String(n)];
  if (!carry) return;
  run.stageIndex = n - 1;
  run.carry = structuredClone(carry);
  beginStage();
  if (g) g.player.hp = g.player.maxHp;
}

/** 시험 진입로: 주소 끝이 #stage1 ~ #stage15 (또는 #stage15-cue처럼 캐릭터까지)이면 바로 시작한다 */
function devStart(): boolean {
  const m = /^#stage(\d{1,2})(?:-(\w+))?$/.exec(location.hash);
  if (!m) return false;
  const ch = m[2] && CHARACTERS[m[2]] ? m[2] : "olly";
  devBegin(ch, Number(m[1]));
  return true;
}
addEventListener("hashchange", () => {
  if (devStart()) return;
});

auto = parseAuto();
if (auto && !auto.rec) devBegin(auto.character, auto.stage);
else if (auto) renderTitle();
else if (!devStart()) renderTitle();
requestAnimationFrame(frame);
