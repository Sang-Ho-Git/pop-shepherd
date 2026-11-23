/**
 * 실시간 점검: 웹 빌드(dist/pop-shepherd.html)를 실제 브라우저에서 자동 플레이(#auto)로 돌리며 오류·멈춤·프레임 저하를 찾는다.
 *   node tools/realtime.mjs --runs auto-cue,auto-olly-s15 --out <폴더> [--minutes 40]
 * 각 런은 따로 탭을 연다. 5초마다 window.__pop 을 읽어 기록하고, 이상하면 스크린샷을 남긴다.
 * 결과: <폴더>/<런>.json (상태 기록·로그·문제 목록), 문제 스크린샷.
 */
import { createRequire } from "node:module";
// 플레이라이트는 전역에 설치된 것을 쓴다 (프로젝트 의존성에 넣지 않음)
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const runs = arg("runs", "auto-olly").split(",");
const out = arg("out", "realtime-out");
const minutes = Number(arg("minutes", "45"));
const page = fileURLToPath(new URL("../dist/pop-shepherd.html", import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

async function one(hash) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const issues = [];
  const samples = [];
  let shots = 0;
  const shot = async (why) => {
    if (shots >= 12) return;
    shots++;
    const f = `${out}/${hash}-${shots}.png`;
    await p.screenshot({ path: f }).catch(() => {});
    issues.push({ t: Date.now(), kind: "screenshot", why, file: f });
  };
  p.on("pageerror", (e) => issues.push({ t: Date.now(), kind: "pageerror", msg: String(e.stack ?? e) }));
  p.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") issues.push({ t: Date.now(), kind: `console-${m.type()}`, msg: m.text() });
  });
  await p.goto(`file://${page}#${hash}`);
  const start = Date.now();
  let lastTime = -1;
  let sameTime = 0;
  let lastScreen = "";
  let sameScreen = 0;
  let lastShotAt = 0;
  while (Date.now() - start < minutes * 60_000) {
    await p.waitForTimeout(5000);
    const s = await p.evaluate(() => {
      const d = globalThis.__pop;
      return d ? { ...d, log: d.log.slice(-5), logLen: d.log.length } : null;
    }).catch((e) => ({ error: String(e) }));
    if (!s || s.error) {
      issues.push({ t: Date.now(), kind: "no-state", msg: s?.error ?? "window.__pop 없음" });
      break;
    }
    samples.push({ at: Math.round((Date.now() - start) / 1000), screen: s.screen, stage: s.stage, time: Math.round(s.time), hp: Math.round(s.hp), level: s.level, enemies: s.enemies, fps: s.fps });
    // 멈춤: 플레이 화면인데 게임 시간이 15초 넘게 그대로
    if (s.screen === "play" && Math.abs(s.time - lastTime) < 0.01) {
      sameTime += 5;
      if (sameTime === 15) {
        issues.push({ t: Date.now(), kind: "stuck", msg: `스테이지 ${s.stage} ${s.time.toFixed(1)}초에서 시간이 멈춤` });
        await shot("stuck");
      }
    } else sameTime = 0;
    lastTime = s.time;
    // 같은 메뉴 화면에 30초 넘게
    if (s.screen !== "play" && s.screen === lastScreen && s.screen !== "result") {
      sameScreen += 5;
      if (sameScreen === 30) {
        issues.push({ t: Date.now(), kind: "menu-stuck", msg: `${s.screen} 화면에서 30초` });
        await shot("menu-stuck");
      }
    } else sameScreen = 0;
    lastScreen = s.screen;
    if (s.screen === "play" && s.fps > 0 && s.fps < 40) issues.push({ t: Date.now(), kind: "low-fps", msg: `fps ${s.fps} · 적 ${s.enemies} · 스테이지 ${s.stage}` });
    // 3분마다 기록용 스크린샷
    if (Date.now() - lastShotAt > 180_000) {
      lastShotAt = Date.now();
      await shot(`기록 스테이지 ${s.stage} ${Math.round(s.time)}초`);
    }
    if (s.result) {
      await shot("결과");
      break;
    }
  }
  const final = await p.evaluate(() => globalThis.__pop).catch(() => null);
  await ctx.close();
  const rep = { hash, seconds: Math.round((Date.now() - start) / 1000), result: final?.result ?? null, log: final?.log ?? [], issues, samples };
  writeFileSync(`${out}/${hash}.json`, JSON.stringify(rep, null, 1));
  const bad = issues.filter((i) => i.kind !== "screenshot");
  console.log(`${hash}: ${rep.result ? `${rep.result.won ? "완주" : "실패"} 클리어 ${rep.result.reached} Lv${rep.result.level}` : "결과 없음"} · ${rep.seconds}초 · 문제 ${bad.length}건${bad.length ? ` (${[...new Set(bad.map((i) => i.kind))].join(", ")})` : ""}`);
}

await Promise.all(runs.map(one));
await browser.close();
