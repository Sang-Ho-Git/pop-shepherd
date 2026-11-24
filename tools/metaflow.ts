/// <reference lib="dom" />
/**
 * 메타 흐름 실시간 점검: 웹 빌드를 실제 브라우저(Playwright)에서 새 세이브로 여러 판 이어서 한다.
 *   npm run build:web && node tools/metaflow.ts --runs 6 --out <폴더> [--speed 8] [--phone] [--legacy]
 *
 * 한 판마다: 제목 → 시작 → 캐릭터 선택(가장 최근에 열린 캐릭터) → 판(봇, #auto-rec) → 결과 화면
 *   → "<캐릭터> 영구 강화" → 살 수 있는 가장 싼 노드부터 코인이 떨어질 때까지 실제 버튼으로 산다 → 캐릭터 고르기.
 * 확인하는 것
 *   - 다음 판 시작 때 능력치(체력·방어·속도·힘·쿨다운·시작 골드·부활)가 세이브의 그 캐릭터 트리와 같은지 (applyMeta로 계산)
 *   - 결과 화면의 코인 증가가 세이브의 코인 증가와 같은지, 새로 열린 캐릭터가 결과 화면에 뜨는지
 *   - 두 판마다 새로고침: localStorage 세이브가 그대로이고 제목 화면 기록이 같은지
 *   - --legacy: 버전 1 세이브(공용 트리 구매)를 넣으면 환불 안내가 한 번만 뜨고 해금이 유지되는지
 * 결과: <폴더>/metaflow.json (판별 기록·문제 목록), 화면 스크린샷.
 * 파일을 바로 열지 않고 호스트처럼 doctype·viewport를 붙여 http로 연다 (Artifact로 올릴 때와 같은 조건).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CHARACTERS } from "../src/data/index.ts";
import { applyMeta } from "../src/progression/meta.ts";
import { newSave, parseSave } from "../src/progression/save.ts";
import type { SaveData } from "../src/progression/save.ts";

// 플레이라이트는 전역에 설치된 것을 쓴다 (프로젝트 의존성에 넣지 않음)
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : d;
};
const runs = Number(arg("runs", "4"));
const out = arg("out", "metaflow-out");
const speed = Number(arg("speed", "8"));
const phone = process.argv.includes("--phone");
const legacyOnly = process.argv.includes("--legacy");
mkdirSync(out, { recursive: true });

const NAME: Record<string, string> = { shepherd: "양치기", cue: "큐", olly: "올리", pale: "팔레" };
const KEY = "pop-shepherd-save-v1";
const html = readFileSync(new URL("../dist/pop-shepherd.html", import.meta.url), "utf8");
const issues: string[] = [];
const log = (s: string): void => console.log(s);
const issue = (s: string): void => {
  issues.push(s);
  console.log(`  ✗ ${s}`);
};

const browser = await chromium.launch();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

async function open(hash = ""): Promise<{ ctx: Page; p: Page }> {
  const ctx = await browser.newContext(phone ? { ...devices["Pixel 7"] } : { viewport: { width: 1280, height: 800 } });
  await ctx.route("http://pop.test/", (r: Page) =>
    r.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><meta charset="utf-8">${html}` }),
  );
  const p = await ctx.newPage();
  p.on("pageerror", (e: Error) => issue(`페이지 오류: ${e.message}`));
  await p.goto(`http://pop.test/${hash}`);
  return { ctx, p };
}

async function readSave(p: Page): Promise<SaveData | null> {
  const text = await p.evaluate((k: string) => localStorage.getItem(k), KEY);
  if (text === null) return newSave(); // 아직 한 번도 저장하지 않은 새 세이브
  const r = parseSave(text);
  return r.ok ? r.save : null;
}

/** 오버레이에서 글자가 맞는 버튼을 누른다 (폰은 탭) */
async function press(p: Page, name: string | RegExp): Promise<void> {
  const b = p.locator("#overlay button", { hasText: name }).first();
  await b.scrollIntoViewIfNeeded();
  if (phone) await b.tap();
  else await b.click();
}

const shotOnce = new Set<string>();
async function waitScreen(p: Page, screen: string, timeoutMs: number, progress = false): Promise<boolean> {
  const t0 = Date.now();
  let next = 60_000;
  while (Date.now() - t0 < timeoutMs) {
    const d = await p.evaluate(() => {
      const x = (globalThis as { __pop?: { screen: string; stage: number; time: number; fps: number; level: number } }).__pop!;
      return { screen: x.screen, stage: x.stage, time: x.time, fps: x.fps, level: x.level };
    });
    if (d.screen === screen) return true;
    // 판 안의 메뉴(정비 상점, 레벨업 카드)도 한 번씩 찍는다 (폰 레이아웃 확인)
    if (progress && d.screen === "shop" && !shotOnce.has("shop")) {
      shotOnce.add("shop");
      await shot(p, "shop");
    }
    if (progress && d.screen === "play" && !shotOnce.has("choice") && (await p.$("#overlay:not([hidden]) button.card"))) {
      shotOnce.add("choice");
      await shot(p, "levelup");
    }
    if (progress && Date.now() - t0 > next) {
      next += 60_000;
      log(`    … ${Math.round((Date.now() - t0) / 1000)}초: 스테이지 ${d.stage} ${Math.round(d.time)}초 Lv${d.level} · ${d.fps}fps`);
    }
    await p.waitForTimeout(500);
  }
  return false;
}

async function shot(p: Page, name: string, full = true): Promise<string> {
  const path = `${out}/${name}${phone ? "-phone" : "-desk"}.png`;
  await p.screenshot({ path, fullPage: full });
  return path;
}

/** 판 시작 때 능력치가 영구 강화대로인지 */
function checkStats(save: SaveData, ch: string, got: { maxHp: number; revives: number; gold: number; stats: Record<string, number> }): string[] {
  const { character, specials } = applyMeta(CHARACTERS[ch]!, save.meta[ch] ?? {});
  const s = character.stats as unknown as Record<string, number>;
  const bad: string[] = [];
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  if (got.maxHp !== s.max_hp) bad.push(`체력 ${got.maxHp} ≠ ${s.max_hp}`);
  for (const k of ["armor", "move_speed", "knock_power", "cooldown", "area", "chain_radius", "gold_find", "pickup", "regen", "luck", "aim_assist", "rainbow", "heal_find"]) {
    if (got.stats[k] !== undefined && s[k] !== undefined && !near(got.stats[k]!, s[k]!)) bad.push(`${k} ${got.stats[k]} ≠ ${s[k]}`);
  }
  if (got.revives !== specials.revives) bad.push(`부활 ${got.revives} ≠ ${specials.revives}`);
  if (got.gold !== specials.startGold) bad.push(`시작 골드 ${got.gold} ≠ ${specials.startGold}`);
  return bad;
}

interface RunLog {
  run: number;
  character: string;
  reached: number;
  won: boolean;
  coinsShown: number;
  coinsSaved: number;
  goldNote: string;
  unlocked: string[];
  bought: string[];
  coinsLeft: number;
  statsChecked: string;
  seconds: number;
}

async function flow(): Promise<RunLog[]> {
  const rows: RunLog[] = [];
  let { ctx, p } = await open(`#auto-rec-x${speed}`);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  let prevUnlocked = ["olly"];
  for (let i = 1; i <= runs; i++) {
    const t0 = Date.now();
    await press(p, /^시작$/);
    const before = (await readSave(p))!;
    // 가장 최근에 열린 캐릭터 (새로 연 캐릭터를 바로 써 보는 사람)
    const ch = before.unlocked[before.unlocked.length - 1] as string;
    if (i === 1 || before.unlocked.length !== prevUnlocked.length) await shot(p, `select-run${i}`);
    // 잠긴 캐릭터 카드는 꺼져 있어야 한다
    const disabled = await p.$$eval("button.char", (bs: HTMLButtonElement[]) => bs.filter((b) => b.disabled).length);
    if (disabled !== 4 - before.unlocked.length) issue(`run${i} 잠긴 카드 수 ${disabled} (열린 ${before.unlocked.length})`);
    // 앞 판 끝의 능력치가 남아 있지 않게 지운 뒤 시작
    await p.evaluate(() => {
      const d = (globalThis as { __pop?: { player: unknown; result: unknown } }).__pop!;
      d.player = null;
      d.result = null;
    });
    await press(p, new RegExp(`^${NAME[ch]}`));
    // 판 시작 직후 능력치 (스테이지 1의 처음 1초 안: 레벨업 전)
    await p.waitForFunction(() => {
      const d = (globalThis as { __pop?: { player: unknown; time: number; screen: string } }).__pop!;
      return d.player && d.screen === "play" && d.time < 1;
    });
    const got = await p.evaluate(() => (globalThis as { __pop?: { player: unknown } }).__pop!.player);
    const bad = checkStats(before, ch, got);
    if (bad.length) issue(`run${i} ${ch} 능력치: ${bad.join(", ")}`);
    if (!(await waitScreen(p, "result", 40 * 60_000, true))) {
      issue(`run${i}: 40분 안에 결과 화면이 안 뜸`);
      await shot(p, `stuck-run${i}`, false);
      break;
    }
    await p.waitForTimeout(300);
    const text: string = await p.$eval("#overlay", (o: HTMLElement) => o.innerText);
    const after = (await readSave(p))!;
    const coinsShown = Number(/코인 \+(\d+)/.exec(text)?.[1] ?? -1);
    const fresh = after.unlocked.filter((x) => !before.unlocked.includes(x));
    const shownFresh = [...text.matchAll(/새로 열림: (\S+)/g)].map((m) => m[1]);
    if (coinsShown !== after.coins - before.coins) issue(`run${i} 코인: 화면 +${coinsShown}, 세이브 +${after.coins - before.coins}`);
    if (shownFresh.join() !== fresh.map((x) => NAME[x]).join()) issue(`run${i} 새로 열림: 화면 ${shownFresh.join()} / 세이브 ${fresh.join()}`);
    // 화면 숫자는 정수로 (남은 골드가 4848.891000000002처럼 나온 적이 있다)
    if (/\d\.\d{3,}/.test(text)) issue(`run${i} 결과 화면에 긴 소수: ${/\S*\d\.\d{3,}\S*/.exec(text)?.[0]}`);
    if (after.runs !== before.runs + 1) issue(`run${i} 런 수 ${before.runs} → ${after.runs}`);
    if (i === 1 || fresh.length > 0) await shot(p, `result-run${i}`);
    const reached = Number(/클리어 (\d+)/.exec(text)?.[1] ?? 0);
    log(`run${i} ${ch} 클리어 ${reached} · 코인 +${coinsShown} (보유 ${after.coins})${fresh.length ? ` · 새로 열림 ${fresh.join(",")}` : ""}`);
    // 영구 강화: 가장 싼 노드부터
    await press(p, new RegExp(`^${NAME[ch]} 영구 강화$`));
    await waitScreen(p, "meta", 5000);
    const bought: string[] = [];
    for (let k = 0; k < 60; k++) {
      const pick = await p.$$eval("button.node:not(:disabled)", (bs: HTMLButtonElement[]) => {
        const c = bs.map((b, idx) => ({ idx, name: b.querySelector("strong")?.textContent ?? "", cost: Number(/(\d+) 코인/.exec(b.querySelector(".price")?.textContent ?? "")?.[1] ?? 1e9) }));
        c.sort((a, b) => a.cost - b.cost);
        return c[0] ?? null;
      });
      if (!pick) break;
      const s0 = (await readSave(p))!;
      const y0 = await p.evaluate(() => scrollY);
      const btn = p.locator("button.node:not(:disabled)").nth(pick.idx);
      await btn.scrollIntoViewIfNeeded();
      const y1 = await p.evaluate(() => scrollY);
      if (phone) await btn.tap();
      else await btn.click();
      const s1 = (await readSave(p))!;
      const y2 = await p.evaluate(() => scrollY);
      if (s0.coins - s1.coins !== pick.cost) issue(`run${i} 구매 ${pick.name}: 가격 ${pick.cost}, 코인 ${s0.coins} → ${s1.coins}`);
      if (Math.abs(y2 - y1) > 2) issue(`run${i} 구매 뒤 스크롤이 튐 ${y1} → ${y2} (구매 전 ${y0})`);
      bought.push(`${pick.name.replace(/ \d+\/\d+$/, "")}(${pick.cost})`);
    }
    if (i === 1 || bought.length > 3) await shot(p, `meta-run${i}`);
    const end = (await readSave(p))!;
    rows.push({
      run: i,
      character: ch,
      reached,
      won: text.includes("런 완주"),
      coinsShown,
      coinsSaved: after.coins - before.coins,
      goldNote: /남은 골드 [\d.]+ → 코인 \d+/.exec(text)?.[0] ?? "",
      unlocked: end.unlocked,
      bought,
      coinsLeft: end.coins,
      statsChecked: bad.length ? bad.join(", ") : "맞음",
      seconds: Math.round((Date.now() - t0) / 1000),
    });
    prevUnlocked = before.unlocked;
    if (bought.length) log(`  산 것: ${bought.join(" ")} · 남은 코인 ${end.coins}`);
    // 두 판마다 새로고침: 세이브가 그대로여야 한다
    if (i % 2 === 0) {
      const textBefore = await p.evaluate((k: string) => localStorage.getItem(k), KEY);
      await p.reload();
      await waitScreen(p, "title", 5000);
      const textAfter = await p.evaluate((k: string) => localStorage.getItem(k), KEY);
      if (textBefore !== textAfter) issue(`run${i} 새로고침 뒤 세이브가 바뀜`);
      const title: string = await p.$eval("#overlay", (o: HTMLElement) => o.innerText);
      if (!title.includes(`기록: ${end.runs}런`)) issue(`run${i} 새로고침 뒤 제목 기록이 다름: ${/기록: [^\n]*/.exec(title)?.[0]}`);
      log(`  새로고침: 세이브 유지 ${textBefore === textAfter ? "O" : "X"}`);
    } else {
      await press(p, /^처음으로$/);
    }
  }
  await shot(p, "title-end");
  await ctx.close();
  return rows;
}

/** 버전 1 세이브(공용 트리) → 환불 안내 한 번, 해금 유지 */
async function legacy(): Promise<void> {
  const v1 = {
    version: 1,
    coins: 120,
    meta: { sturdy: 2, strength: 1, thrift: 1 },
    runs: 4,
    wins: 0,
    bestStage: 7,
    characters: { olly: { runs: 3, wins: 0, bestStage: 7 }, cue: { runs: 1, wins: 0, bestStage: 2 } },
    unlocked: ["olly", "shepherd", "cue"],
    totals: { poppedEnemies: 5000, cushionPops: 40, threeCushions: 2, maxChain: 8, reached: 15 },
    bests: { poppedEnemies: 2500, cushionPops: 20, threeCushions: 1, maxChain: 8 },
  };
  const refund = 80 + 110 + 80 + 65; // sturdy 2 + strength 1 + thrift 1 (버전 1 비용표)
  const { ctx, p } = await open("");
  await p.evaluate(([k, t]: string[]) => localStorage.setItem(k!, t!), [KEY, JSON.stringify(v1)]);
  await p.reload();
  await p.waitForSelector("#overlay button");
  const t1: string = await p.$eval("#overlay", (o: HTMLElement) => o.innerText);
  const shown = /쓴 코인 (\d+)을 모두 돌려받았다/.exec(t1);
  const s = (await readSave(p))!;
  await shot(p, "legacy-title");
  log(`예전 세이브: 안내 ${shown ? `있음(${shown[1]})` : "없음"} · 코인 ${s.coins} (120 + ${refund}) · 해금 ${s.unlocked.join(",")} · 버전 ${s.version}`);
  if (!shown) issue("예전 세이브: 환불 안내가 안 뜸");
  else if (Number(shown[1]) !== refund) issue(`예전 세이브: 환불 ${shown[1]} ≠ ${refund}`);
  if (s.coins !== 120 + refund) issue(`예전 세이브: 코인 ${s.coins} ≠ ${120 + refund}`);
  if (s.unlocked.join() !== "olly,shepherd,cue") issue(`예전 세이브: 해금 ${s.unlocked.join()}`);
  if (Object.values(s.meta).some((m) => Object.keys(m).length > 0)) issue("예전 세이브: 트리가 비지 않음");
  await p.reload();
  const t2: string = await p.$eval("#overlay", (o: HTMLElement) => o.innerText);
  if (/돌려받았다/.test(t2)) issue("예전 세이브: 새로고침 뒤에도 환불 안내가 또 뜸");
  await press(p, /^영구 강화$/);
  const t3: string = await p.$eval("#overlay", (o: HTMLElement) => o.innerText);
  if (/돌려받았다/.test(t3)) issue("예전 세이브: 영구 강화 화면에 환불 안내가 또 뜸");
  await shot(p, "legacy-meta");
  await press(p, /^캐릭터 고르기$/);
  const open3 = await p.$$eval("button.char:not(:disabled) strong", (bs: HTMLElement[]) => bs.map((b) => b.textContent));
  log(`  선택 화면에서 열린 캐릭터: ${open3.join(", ")}`);
  if (open3.length !== 3) issue(`예전 세이브: 선택 화면 열린 캐릭터 ${open3.length}`);
  await ctx.close();
}

const t0 = Date.now();
let rows: RunLog[] = [];
await legacy();
if (!legacyOnly) rows = await flow();
await browser.close();
writeFileSync(`${out}/metaflow${phone ? "-phone" : ""}.json`, JSON.stringify({ phone, speed, rows, issues, minutes: Math.round((Date.now() - t0) / 60000) }, null, 2));
log(`\n문제 ${issues.length}개${issues.length ? `:\n${issues.map((x) => `- ${x}`).join("\n")}` : ""}`);
