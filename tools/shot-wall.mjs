/**
 * 11/25 반사벽 진화(만화경) 길이 확인: 무기 범위(area)를 크게 준 채 스테이지 7에서 만화경을 세우고 찍는다.
 *   npm run build:web && node tools/shot-wall.mjs [출력 폴더] [area]  → wall-evo-area<값>.png
 * 벽 길이는 min(area, RULES.wall.areaCap=1.2) 배로만 늘어난다 (255 × 1.2 = 306px).
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = process.argv[2] ?? "docs/shots";
const area = Number(process.argv[3] ?? "1.8");
const page = fileURLToPath(new URL("../dist/pop-shepherd.html", import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(`file://${page}#auto-olly-s7-x1`);
await p.waitForTimeout(800);
await p.evaluate((a) => { globalThis.__pop.give("reflect_wall", "evo", null); globalThis.__pop.setArea(a); }, area);
let shot = false;
for (let k = 0; k < 400 && !shot; k++) {
  const s = await p.evaluate(() => ({ screen: globalThis.__pop.screen, wallT: globalThis.__pop.wallT }));
  if (s.screen === "result") break;
  if (s.screen === "play" && s.wallT > 0) {
    await p.screenshot({ path: `${out}/wall-evo-area${area}.png` });
    shot = true;
  }
  await p.waitForTimeout(100);
}
console.log(shot ? "찍음" : "벽이 안 섰음", errors.length ? errors : "오류 없음");
await browser.close();
