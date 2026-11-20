import { step } from "../src/core/game.ts";
import { RULES } from "../src/core/rules.ts";
import type { Card, Game, Input } from "../src/core/types.ts";
import { CAMPAIGN, CHARACTERS, META, PASSIVES, SHOP, stage, WEAPONS } from "../src/data/index.ts";
import type { MetaNode } from "../src/data/index.ts";
import { needsBranch, resolveChoice, xpTotalFor } from "../src/progression/levelup.ts";
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
import type { Fx } from "./render.ts";

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
}
let run: Run | null = null;
let g: Game | null = null;
let paused = false;
let fx: Fx[] = [];
let banner: { text: string; sub: string; t: number } | null = null;
let shop: ShopState | null = null;
let choiceShown = false;
let hitFlash = 0;

function startRun(characterId: string): void {
  const meta = applyMeta(CHARACTERS[characterId]!, save.meta);
  run = { character: characterId, stageIndex: 0, carry: null, meta, popped: 0, seed: (Date.now() >>> 0) % 1_000_000 };
  beginStage();
}

function beginStage(): void {
  if (!run) return;
  const id = CAMPAIGN[run.stageIndex] as string;
  g = startStage(run.seed + run.stageIndex * 7919, run.character, id, run.carry, run.meta, true);
  fx = [];
  paused = false;
  choiceShown = false;
  screen = "play";
  hideOverlay();
  const st = stage(id);
  const goal = st.clear === "boss" ? "보스를 쓰러뜨려라" : st.clear === "elites" ? `엘리트 ${st.elites?.length ?? 0}마리를 쓰러뜨려라` : `${Math.round(st.duration / 60)}분 ${st.duration % 60 ? `${st.duration % 60}초 ` : ""}버텨라`;
  banner = { text: `스테이지 ${run.stageIndex + 1} · ${st.name}`, sub: goal, t: 3 };
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
  save = recordRun(save, { character: run.character, reached, won, coins });
  writeSave(store, save);
  screen = "result";
  const name = CHAR_NAME[run.character] ?? run.character;
  show([
    el("p", "eyebrow", won ? "런 완주" : `스테이지 ${run.stageIndex + 1}에서 쓰러짐`),
    el("h1", "", won ? "목장을 지켰다" : "양 떼에 묻혔다"),
    el("p", "lede", `${name} · Lv${g.player.level} · 클리어 ${reached}/10 · 터뜨린 적 ${run.popped}`),
    el("p", "coins", `코인 +${coins}  (보유 ${save.coins})`),
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
      row([button("시작", () => renderSelect()), button("영구 강화", () => renderMeta(), "btn ghost")]),
      el("p", "small", `기록: ${save.runs}런 · 완주 ${save.wins} · 최고 ${save.bestStage}스테이지 · 영구 강화 ${Math.round(treeProgress(save) * 100)}%`),
      el("p", "small keys", "이동 WASD/방향키 · 휘슬 Space · 일시정지 Esc · 카드 1/2/3"),
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
  const ch = g.choices[0];
  if (!ch) return;
  choiceShown = true;
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
addEventListener("keydown", (e) => {
  keys.add(e.code);
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

// 터치: 화면 아무 데나 누르고 끌면 그 방향으로 이동, 휘슬 버튼
let touch: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (touch && e.pointerId === touch.id) {
    touch.x = e.clientX;
    touch.y = e.clientY;
  }
});
const endTouch = (e: PointerEvent): void => {
  if (touch && e.pointerId === touch.id) touch = null;
};
canvas.addEventListener("pointerup", endTouch);
canvas.addEventListener("pointercancel", endTouch);
let whistleTap = false;
$("whistle").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  whistleTap = true;
});

function readInput(): Input {
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
  return { moveX: x, moveY: y, whistle };
}

/* ───────────────────────── 효과 ───────────────────────── */

function handleEvents(game: Game): void {
  for (const e of game.events) {
    switch (e.type) {
      case "pop": {
        const color = PALETTE[e.color === "rainbow" ? "yellow" : e.color];
        fx.push({ kind: "ring", x: e.x, y: e.y, t: 0, life: 0.45, color, radius: 60 + e.size * 12 });
        if (e.chainDepth >= 1) fx.push({ kind: "text", x: e.x, y: e.y, t: 0, life: 0.9, color: "#fff3c4", text: `연쇄 ${e.chainDepth + 1}` });
        else if (e.cushion) fx.push({ kind: "text", x: e.x, y: e.y, t: 0, life: 0.9, color: "#9fe3ff", text: "쿠션!" });
        break;
      }
      case "player-hit":
        hitFlash = 0.25;
        break;
      case "whistle":
        fx.push({ kind: "ring", x: game.player.x, y: game.player.y, t: 0, life: 0.5, color: "#f4efe1", radius: RULES.whistle.radius });
        break;
      case "boss-spawn":
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
    if (!paused && g.choices.length === 0) {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 5) {
        step(g, readInput());
        handleEvents(g);
        acc -= DT;
        n++;
        if (g.choices.length > 0 || g.phase === "cleared" || g.phase === "failed") break;
      }
      if (n >= 5) acc = 0;
    }
    if (g.choices.length > 0 && !choiceShown && !paused) renderChoice();
    if (g.choices.length === 0 && !paused) {
      if (g.phase === "cleared") endStage();
      else if (g.phase === "failed" || g.player.dead) finishRun(false);
    }
  }
  for (const f of fx) f.t += dt;
  fx = fx.filter((f) => f.t < f.life);
  if (banner) banner.t -= dt;
  if (banner && banner.t <= 0) banner = null;
  hitFlash = Math.max(0, hitFlash - dt);

  if (g) {
    const v = computeView(g, canvas.width, canvas.height);
    drawWorld(ctx, g, v, fx, clock);
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
  requestAnimationFrame(frame);
}

renderTitle();
requestAnimationFrame(frame);
