/**
 * 11/24 밤 점검: 자동 플레이(#auto)로 실제 화면에서 바뀐 것들이 자연스러운지 찍는다.
 *   node tools/shot-features.mjs [출력 폴더]
 * - clear: 스테이지가 끝나기 직전·직후 (마무리 시간 없이 바로 상점으로 넘어가는지)
 * - wall: 반사벽이 사라지기 직전 깜빡임 (window.__pop.wallT)
 * - whirl: 회오리 둔화·삭제 연출 (자동 플레이 중)
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = process.argv[2] ?? "docs/shots";
const page = fileURLToPath(new URL("../dist/pop-shepherd.html", import.meta.url));
mkdirSync(out, { recursive: true });
const dur = (n) => JSON.parse(readFileSync(new URL(`../data/stages/stage${String(n).padStart(2, "0")}.json`, import.meta.url), "utf8")).duration;
const browser = await chromium.launch();
const state = (p) => p.evaluate(() => ({ ...globalThis.__pop, log: [] }));

async function open(hash) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`file://${page}#${hash}`);
  return { ctx, p, errors };
}

// 1) 스테이지 클리어 전환: 스테이지 3을 x2로, 끝나기 1초 전 / 상점 화면
{
  const { ctx, p, errors } = await open("auto-pale-s3-x2");
  const end = dur(3);
  let before = false;
  let hold = false;
  for (let k = 0; k < 2400; k++) {
    const s = await state(p);
    if (!before && s.screen === "play" && s.stage === 3 && s.time >= end - 1) {
      await p.screenshot({ path: `${out}/night-clear-before.png` });
      before = true;
    }
    if (before && !hold && s.screen === "play" && s.phase === "cleared") {
      await p.waitForTimeout(250);
      await p.screenshot({ path: `${out}/night-clear-hold.png` });
      hold = true;
    }
    if (before && s.screen === "shop") {
      await p.screenshot({ path: `${out}/night-clear-shop.png` });
      break;
    }
    if (s.screen === "result") break;
    await p.waitForTimeout(50);
  }
  console.log("clear", before ? "찍음" : "못 찍음", errors.length ? errors : "오류 없음");
  await ctx.close();
}

if (process.env.ONLY_CLEAR) { await browser.close(); process.exit(0); }
// 2) 반사벽 깜빡임: 스테이지 6에 반사벽 7A를 주고, 가장 빨리 사라질 벽이 0.4초 남았을 때
{
  const { ctx, p, errors } = await open("auto-cue-s6");
  await p.waitForTimeout(1500);
  await p.evaluate(() => globalThis.__pop.give("reflect_wall", 7, "A"));
  let n = 0;
  for (let k = 0; k < 1200 && n < 2; k++) {
    const s = await state(p);
    if (s.screen === "play" && s.wallT > 0 && s.wallT < 0.45) {
      n++;
      await p.screenshot({ path: `${out}/night-wall-blink-${n}.png` });
      await p.waitForTimeout(1500);
    }
    await p.waitForTimeout(30);
  }
  console.log("wall", n, errors.length ? errors : "오류 없음");
  await ctx.close();
}

// 3) 회오리: 스테이지 7에 회오리 6A를 주고 자동 플레이 6초 뒤
{
  const { ctx, p, errors } = await open("auto-olly-s7");
  await p.waitForTimeout(1500);
  await p.evaluate(() => globalThis.__pop.give("whirlwind", 6, "A"));
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `${out}/night-whirl-auto.png` });
  console.log("whirl", errors.length ? errors : "오류 없음");
  await ctx.close();
}
await browser.close();
