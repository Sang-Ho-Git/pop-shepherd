import { step } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { Card, Game, Input } from "../src/core/types.ts";
import { CAMPAIGN, CHARACTERS, META, PASSIVES, SHOP, stage, WEAPONS } from "../src/data/index.ts";
import type { MetaNode } from "../src/data/index.ts";
import { botCardScore, botChooseBranch, botChooseCard, needsBranch, resolveChoice, validateFrontChoice, xpTotalFor } from "../src/progression/levelup.ts";
import { botInput } from "../src/sim/bot.ts";
import { applyMeta, coinsForRun, isUnlocked, nextCost } from "../src/progression/meta.ts";
import type { MetaSpecials } from "../src/progression/meta.ts";
import { browserStore, loadSave, recordRun, spendOnMeta, treeProgress, writeSave } from "../src/progression/save.ts";
import type { SaveData } from "../src/progression/save.ts";
import { buy, openShop, reroll } from "../src/progression/shop.ts";
import type { ShopState } from "../src/progression/shop.ts";
import { carryOf, startStage } from "../src/sim/campaign.ts";
import type { Carry } from "../src/sim/campaign.ts";
import { weaponLevel, MAX_LEVEL } from "../src/weapons/weapons.ts";
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
const ctx = canvas.getContext("2d")!;
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
const CHAR_BLURB: Record<string, string> = {
  olly: "목동. 체력 130, 방어 2. 올가미로 떨어진 양을 짝에게 끌어다 붙인다. 처음이라면 올리.",
  shepherd: "보정 없는 기준 캐릭터. 킥으로 이동 방향의 적을 정확히 날린다.",
  cue: "당구사. 날리는 힘 125%, 체력 80. 큐의 샷에 맞아 튕긴 적은 쿠션샷으로 친다.",
  pale: "화가. 쿨다운 −10%, 연쇄 반경 120%. 페인트 총으로 옆 무리의 색을 칠한다.",
};

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

function show(nodes: HTMLElement[], cls = "panel"): void {
  overlay.replaceChildren();
  const p = el("div", cls);
  for (const n of nodes) p.append(n);
  overlay.append(p);
  overlay.hidden = false;
  const first = p.querySelector("button");
  (first as HTMLButtonElement | null)?.focus();
}

function hideOverlay(): void {
  overlay.hidden = true;
  overlay.replaceChildren();
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
  seed: number;
  /** 시험 진입로(#stageN)로 시작한 판: 기록·코인에 넣지 않는다 */
  dev?: boolean;
}
let run: Run | null = null;
let g: Game | null = null;
let paused = false;
let fx: Fx[] = [];
let banner: { text: string; sub: string; t: number } | null = null;
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
  const meta = applyMeta(CHARACTERS[characterId]!, save.meta);
  run = { character: characterId, stageIndex: 0, carry: null, meta, popped: 0, seed: (Date.now() >>> 0) % 1_000_000 };
  beginStage();
}

/** 처음 하는 사람을 위한 안내 (스테이지 1, 처음 세 판). 시각(초)에 맞춰 하나씩 띄운다 */
const HINTS_BALL: [number, string][] = [
  [1, "마우스로 조준하고 클릭하면 색 공을 던진다"],
  [7, "같은 색 무리에 맞혀 공까지 3마리가 되면 터진다. 바닥이 빛나는 무리가 지금 공으로 터뜨릴 수 있는 곳"],
  [15, "같은 색이 하나뿐이면 공이 그 옆에 붙는다. 다음 공으로 터뜨리면 된다"],
  [18, "오른쪽 클릭이나 Q로 지금 공과 다음 공을 바꾼다"],
  [20, "공은 울타리에서 한 번 튕긴다. 튕겨서 맞히면 쿠션 팝 (큐는 두 번, 경험치 보너스)"],
  [28, "터질 때 나오는 충격파가 옆 무리를 날려 연쇄가 된다. Space는 휘슬 (주변을 밀어낸다)"],
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
  const goal = st.clear === "boss" ? "보스를 쓰러뜨려라" : st.clear === "elites" ? `엘리트 ${st.elites?.length ?? 0}마리를 쓰러뜨려라` : `${Math.round(st.duration / 60)}분 ${st.duration % 60 ? `${st.duration % 60}초 ` : ""}버텨라`;
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

function endStage(): void {
  if (!run || !g) return;
  run.popped += g.stats.poppedEnemies;
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
  if (!won) run.popped += g.stats.poppedEnemies;
  const reached = run.stageIndex + (won ? 1 : 0);
  const coins = coinsForRun(reached, run.popped);
  if (!run.dev) {
    save = recordRun(save, { character: run.character, reached, won, coins });
    writeSave(store, save);
  }
  screen = "result";
  const name = CHAR_NAME[run.character] ?? run.character;
  show([
    el("p", "eyebrow", won ? "런 완주" : `스테이지 ${run.stageIndex + 1}에서 쓰러짐`),
    el("h1", "", won ? "목장을 지켰다" : "양 떼에 묻혔다"),
    el("p", "lede", `${name} · Lv${g.player.level} · 클리어 ${reached}/${CAMPAIGN.length} · 터뜨린 적 ${run.popped}`),
    el("p", "coins", run.dev ? "시험 판이라 기록과 코인에 넣지 않았다" : `코인 +${coins}  (보유 ${save.coins})`),
    row([button("영구 강화", () => renderMeta()), button("다시 하기", () => renderSelect(), "btn ghost")]),
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
      el("p", "small", ballMode ? "색 공 규칙: 마우스로 조준하고 클릭으로 던진다. 같은 색 무리에 맞혀 3마리를 채우면 터진다." : "기존 규칙: 날아간 적이 같은 색에 세게 부딪혀야 터진다."),
      el("p", "small", `기록: ${save.runs}런 · 완주 ${save.wins} · 최고 ${save.bestStage}스테이지 · 영구 강화 ${Math.round(treeProgress(save) * 100)}%`),
      el("p", "small keys", `이동 WASD/방향키 · ${ballMode ? "조준 마우스 · 던지기 클릭 · 공 바꾸기 오른쪽 클릭/Q · " : ""}휘슬 Space · 일시정지 Esc · 카드 1/2/3`),
    ],
    "panel title",
  );
}

function renderSelect(): void {
  screen = "select";
  const cards = row(
    CHAR_ORDER.map((id) => {
      const ch = CHARACTERS[id]!;
      const b = button("", () => startRun(id), "char");
      const s = ch.stats;
      b.append(el("strong", "", CHAR_NAME[id] ?? id), el("span", "weapon", `시작 무기 · ${weaponName(ch.startWeapon)}`), el("span", "", CHAR_BLURB[id] ?? ""));
      b.append(el("span", "stats", `체력 ${s.max_hp} · 방어 ${s.armor} · 속도 ${Math.round(s.move_speed * 100)}%`));
      const rec = save.characters[id];
      if (rec) b.append(el("span", "rec", `${rec.runs}런 · 완주 ${rec.wins} · 최고 ${rec.bestStage}`));
      return b;
    }),
    "chars",
  );
  show([el("p", "eyebrow", "캐릭터"), el("h2", "", "누구로 몰까"), cards, row([button("뒤로", () => renderTitle(), "btn ghost")])]);
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
    el("h2", "", "정비 상점"),
    el("p", "lede", `골드 ${Math.floor(g.player.gold)} · 체력 ${Math.ceil(g.player.hp)}/${g.player.maxHp}`),
    items,
    row([rr, button(`스테이지 ${run.stageIndex + 2}로`, () => leaveShop())]),
  ]);
}

function renderMeta(): void {
  screen = "meta";
  const branches: Record<string, string> = { survival: "생존", power: "화력", economy: "경제" };
  const cols = row(
    Object.entries(branches).map(([key, label]) => {
      const col = el("div", "branch");
      col.append(el("h3", "", label));
      for (const n of META.nodes.filter((x: MetaNode) => x.branch === key)) {
        const lv = save.meta[n.id] ?? 0;
        const cost = nextCost(save.meta, n.id);
        const unlocked = isUnlocked(save.meta, n.id);
        const b = button("", () => {
          save = spendOnMeta(save, n.id);
          writeSave(store, save);
          renderMeta();
        }, "node");
        b.disabled = cost === null || !unlocked || save.coins < cost;
        b.append(el("strong", "", `${n.name} ${lv}/${n.maxLevel}`), el("span", "", n.note));
        b.append(el("span", "price", cost === null ? "완료" : !unlocked ? "잠김" : `${cost} 코인`));
        col.append(b);
      }
      return col;
    }),
    "tree",
  );
  show([el("p", "eyebrow", `코인 ${save.coins}`), el("h2", "", "영구 강화"), cols, row([button("시작", () => renderSelect()), button("처음으로", () => renderTitle(), "btn ghost")])]);
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

function handleEvents(game: Game): void {
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
      case "stage-clear":
        sfx.clear();
        break;
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
      case "boss-spawn":
        sfx.boss();
        banner = { text: game.enemies.find((x) => x.id === e.id)?.kind === "wool_giant" ? "양털 거인" : "무지개 양치기", sub: "곁에서 터뜨려야 상처를 입는다", t: 3 };
        break;
      case "elite-spawn":
        banner = { text: "엘리트 등장", sub: "곁에서 터뜨리면 보물 상자", t: 2 };
        break;
      case "boss-phase":
        banner = { text: "2단계", sub: "보스가 거칠어졌다", t: 2 };
        break;
      case "wrapup-start":
        banner = { text: "마무리", sub: "15초 동안 경험치 +50%", t: 2.5 };
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

function bar(label: string, frac: number, color: string, text: string): HTMLElement {
  const b = el("div", "bar");
  const fill = el("div", "fill");
  fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  fill.style.background = color;
  b.append(fill, el("span", "label", `${label} ${text}`));
  return b;
}

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
  const top = el("div", "top");
  top.append(
    bar("체력", p.hp / p.maxHp, "#ff6b6b", `${Math.ceil(Math.max(0, p.hp))}/${p.maxHp}`),
    el("div", "goal", goal),
    el("div", "gold", `골드 ${Math.floor(p.gold)}`),
  );
  const boss = game.enemies.find((e) => e.rank === "boss");
  const bottom = el("div", "bottom");
  if (boss) bottom.append(bar("보스", boss.hp / boss.maxHp, PALETTE[boss.color === "rainbow" ? "yellow" : boss.color], ""));
  bottom.append(bar(`Lv${p.level}`, (game.stats.xp - lvFrom) / Math.max(1, lvTo - lvFrom), "#9fe3ff", ""));
  const ws = el("div", "weapons");
  for (const w of game.weapons) ws.append(el("span", "w", `${w.def.name} ${w.level.lv === "evo" ? "진화" : `Lv${w.level.lv}${w.level.branch ?? ""}`}`));
  ws.append(el("span", "w whistle-cd", p.whistleCd > 0 ? `휘슬 ${Math.ceil(p.whistleCd)}초` : "휘슬 준비"));
  if (game.ball) {
    const ball = el("span", "w balls");
    const dot = (c: string, label: string): HTMLElement => {
      const s = el("span", "dot", label);
      s.style.setProperty("--c", PALETTE[c as keyof typeof PALETTE]);
      return s;
    };
    ball.append(el("span", "", "공"), dot(game.ball.current, ""), el("span", "", "다음"), dot(game.ball.next, ""));
    ws.append(ball);
  }
  bottom.append(ws);
  hud.replaceChildren(top, bottom);
}

/* ───────────────────────── 루프 ───────────────────────── */

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
addEventListener("resize", resize);
resize();

let last = performance.now();
let acc = 0;
let clock = 0;
const DT = 1 / RULES.tickHz;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  if (g && screen === "play") {
    if (hitStop > 0) hitStop = Math.max(0, hitStop - dt);
    else if (!paused && g.choices.length === 0) {
      acc += dt * (auto?.speed ?? 1);
      let n = 0;
      const maxSteps = 5 * (auto?.speed ?? 1);
      while (acc >= DT && n < maxSteps) {
        step(g, readInput());
        handleEvents(g);
        acc -= DT;
        n++;
        if (g.choices.length > 0 || g.phase === "cleared" || g.phase === "failed") break;
      }
      if (n >= maxSteps) acc = 0;
    }
    if (g.choices.length > 0 && !choiceShown && !paused) renderChoice();
    if (g.choices.length === 0 && !paused) {
      if (g.phase === "cleared") endStage();
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
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    drawWorld(ctx, g, sv, fx, clock, aimCache);
    if (hitFlash > 0) {
      ctx.fillStyle = `rgba(255,60,60,${hitFlash})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (banner && screen === "play") {
      ctx.textAlign = "center";
      ctx.globalAlpha = Math.min(1, banner.t * 2);
      ctx.fillStyle = "#fff3c4";
      ctx.font = `${Math.round(48 * v.scale)}px Jua, "Gowun Dodum", sans-serif`;
      ctx.fillText(banner.text, canvas.width / 2, canvas.height * 0.3);
      ctx.font = `${Math.round(22 * v.scale)}px "Gowun Dodum", sans-serif`;
      ctx.fillStyle = "#cfe8dd";
      ctx.fillText(banner.sub, canvas.width / 2, canvas.height * 0.3 + 38 * v.scale);
      ctx.globalAlpha = 1;
    }
    if (screen === "play") renderHud(g);
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
  requestAnimationFrame(frame);
}

/* ───────────────────────── 자동 플레이 (점검용) ───────────────────────── */

/**
 * 자동 플레이: 주소가 #auto 로 시작하면 봇이 실제 화면에서 런을 한다 (조작·카드·갈래·상점 버튼까지 실제 UI로).
 * #auto-cue-s15-x4 처럼 캐릭터, 시작 스테이지(s), 속도 배율(x)을 붙일 수 있다. 시험 판이라 기록에 남지 않는다.
 * 점검 도구(Playwright)는 window.__pop 으로 상태를 읽는다.
 */
interface AutoState {
  character: string;
  stage: number;
  speed: number;
  /** 다음 UI 동작까지 남은 시간 (사람처럼 조금 기다렸다 누른다) */
  wait: number;
  runs: number;
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
}
const dbg: PopDebug = { screen: "", stage: 0, time: 0, hp: 0, maxHp: 0, level: 0, enemies: 0, balls: 0, fps: 0, result: null, runs: 0, log: [] };
(globalThis as { __pop?: PopDebug }).__pop = dbg;
let fpsAcc = 0;
let fpsN = 0;

function parseAuto(): AutoState | null {
  const m = /^#auto(.*)$/.exec(location.hash);
  if (!m) return null;
  const st: AutoState = { character: "olly", stage: 1, speed: 1, wait: 0.5, runs: 0 };
  for (const t of (m[1] ?? "").split("-").filter(Boolean)) {
    if (CHARACTERS[t]) st.character = t;
    else if (/^s\d+$/.test(t)) st.stage = Number(t.slice(1));
    else if (/^x\d+$/.test(t)) st.speed = Math.max(1, Math.min(8, Number(t.slice(1))));
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
    dbg.level = g.player.level;
    dbg.enemies = g.enemies.filter((e) => !e.dead).length;
    dbg.balls = g.balls.length;
  }
  a.wait -= dt;
  if (a.wait > 0) return;
  a.wait = 0.4 / a.speed;
  if (screen === "play" && g && choiceShown && g.choices[0]) {
    // 카드 고르기 또는 갈래 고르기: 봇이 고른 번호의 실제 버튼을 누른다
    const branchScreen = overlay.textContent?.includes("갈래를 고른다");
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
if (auto) devBegin(auto.character, auto.stage);
else if (!devStart()) renderTitle();
requestAnimationFrame(frame);
