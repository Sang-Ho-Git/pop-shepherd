/**
 * 11/25 응집 시험안 화면 비교: 예전(pull) / 응집 없앰(coh0) / 무리로 걷기(flock)를 같은 판·같은 시점에 찍는다.
 *   npm run build:web && node tools/shot-cohesion.mjs [출력 폴더]
 * 자동 플레이(#auto)로 스테이지 7을 x2로 돌려 30초·60초에 찍는다.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = process.argv[2] ?? "docs/shots";
const page = fileURLToPath(new URL("../dist/pop-shepherd.html", import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
// 11/25 가다듬기 전후: smooth(지금 기본) / old(-cohold, 예전 동작). 이름을 쉼표로 줄이면 그것만 찍는다 (예: node tools/shot-cohesion.mjs docs/shots smooth,old)
const only = process.argv[3]?.split(",");
const SHOTS = [["pull", "-cohold"], ["none", "-coh0"], ["flock", "-flock"], ["smooth", ""], ["old", "-cohold"]];
for (const [name, tok] of SHOTS.filter(([n]) => !only || only.includes(n))) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`file://${page}#auto-olly-s7-x2${tok}`);
  const want = [30, 60];
  const got = [];
  for (let k = 0; k < 4000 && got.length < want.length; k++) {
    const s = await p.evaluate(() => ({ screen: globalThis.__pop.screen, stage: globalThis.__pop.stage, time: globalThis.__pop.time, enemies: globalThis.__pop.enemies }));
    if (s.screen === "result") break;
    const t = want[got.length];
    if (s.screen === "play" && s.stage === 7 && s.time >= t) {
      const path = `${out}/cohesion-${name}-${t}s.png`;
      await p.screenshot({ path });
      got.push(`${path} (적 ${s.enemies})`);
    }
    await p.waitForTimeout(50);
  }
  console.log(name, got.join(", ") || "못 찍음", errors.length ? errors : "오류 없음");
  await ctx.close();
}
await browser.close();
