/**
 * 회오리 동작 스크린샷 (11/24 런 조정): 시험 진입로로 스테이지를 열고 window.__pop.give로 회오리를 준 뒤 몇 초 뒤 찍는다.
 *   node tools/shot-whirl.mjs [출력 폴더]  → whirl-<이름>.png
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = process.argv[2] ?? "docs/shots";
const page = fileURLToPath(new URL("../dist/pop-shepherd.html", import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const cases = [
  { name: "lv3", hash: "stage3-olly", lv: 3, branch: null, wait: 7000 },
  { name: "6A", hash: "stage6-olly", lv: 6, branch: "A", wait: 7000 },
  { name: "7B", hash: "stage8-pale", lv: 7, branch: "B", wait: 8000 },
  { name: "evo", hash: "stage10-cue", lv: "evo", branch: "A", wait: 8000 },
];
for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`file://${page}#${c.hash}`);
  await p.waitForTimeout(800);
  // 카드 선택 창이 떠 있으면 첫 카드를 고른다
  await p.keyboard.press("1").catch(() => {});
  await p.evaluate(({ lv, branch }) => globalThis.__pop.give("whirlwind", lv, branch), c);
  await p.waitForTimeout(c.wait);
  for (let k = 0; k < 3; k++) await p.keyboard.press("1").catch(() => {});
  await p.screenshot({ path: `${out}/whirl-${c.name}.png` });
  console.log(c.name, errors.length ? errors : "오류 없음");
  await ctx.close();
}
await browser.close();
