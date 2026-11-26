/**
 * 11/26 연쇄 가시화 스크린샷: __pop.chainScene으로 장면을 놓고(시뮬 멈춤) __pop.tick으로 원하는 순간까지 진행해 찍는다.
 *   npm run build:web && node tools/shot-chainfx.mjs [출력 폴더]  → chainfx-<이름>.png
 * tail: 연쇄 가능 적(자기 색 꼬리·빛)과 연쇄 불가(휘슬·무기, 회색/흰 꼬리) / predict: 연쇄 예감 고리·화살표
 * line: 연쇄 선·"연쇄 2!" / miss: "2/3" / bounce: 튕김 불꽃 / whistle: 휘슬 고리
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = process.argv[2] ?? "docs/shots";
const page = fileURLToPath(new URL("../dist/pop-shepherd.html", import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(`file://${page}#stage7-olly`);
await p.waitForTimeout(1200);
await p.keyboard.press("1").catch(() => {});

async function shot(name, scene, ticks, pre = []) {
  await p.evaluate((k) => globalThis.__pop.chainScene(k), scene);
  for (const n of pre) await p.evaluate((x) => globalThis.__pop.tick(x), n);
  await p.evaluate((n) => globalThis.__pop.tick(n), ticks);
  await p.waitForTimeout(40);
  await p.screenshot({ path: `${out}/chainfx-${name}.png` });
  console.log(name);
}
await shot("tail", "chain", 5);
await shot("predict", "chain", 8, [5]);
await shot("line", "chain", 1, [20]);
await shot("miss", "miss", 1, [16]);
await shot("bounce", "bounce", 1, [16]);
// 휘슬: 시뮬을 풀고 스페이스를 눌러 퍼지는 보랏빛 밀기 고리를 찍는다
await p.evaluate(() => globalThis.__pop.chainScene("chain"));
await p.evaluate(() => globalThis.__pop.thaw());
await p.keyboard.down("Space");
await p.waitForTimeout(140);
await p.screenshot({ path: `${out}/chainfx-whistle.png` });
await p.keyboard.up("Space");
console.log("whistle");
console.log(errors.length ? errors : "오류 없음");
await browser.close();
