/// <reference lib="dom" />
/**
 * 폰 성능 점검: 웹 빌드를 Pixel 7 화면 + CPU 느리게(CDP Emulation.setCPUThrottlingRate)로 열어
 * 적이 많은 장면을 실시간(x1)으로 자동 플레이하며 프레임 시간을 sim(시뮬 틱)·draw(월드 그리기)·hud(DOM)로 나눠 잰다.
 *   node tools/perf.ts [--scenes auto-cue-s4,auto-olly-s14,auto-pale-s15] [--throttle 4] [--seconds 30] [--warm 8]
 *                      [--profile] [--html dist/pop-shepherd.html] [--out <폴더>]
 * --profile: CDP CPU 프로파일을 함수별 self 시간으로 모아 상위 25개를 찍는다 (압축 안 한 빌드로: --html <파일>).
 * 헤드리스 크롬은 캔버스를 소프트웨어로 그려 draw가 실제 폰(GPU)보다 비싸게 나온다. 전후 비교용으로 쓴다.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const { chromium, devices } = createRequire(import.meta.url)("playwright");
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : d;
};
const scenes = arg("scenes", "auto-cue-s4,auto-olly-s14,auto-pale-s15").split(",");
const throttle = Number(arg("throttle", "4"));
const seconds = Number(arg("seconds", "30"));
const warm = Number(arg("warm", "8"));
const out = arg("out", "perf-out");
const profile = process.argv.includes("--profile");
const htmlPath = arg("html", new URL("../dist/pop-shepherd.html", import.meta.url).pathname);
mkdirSync(out, { recursive: true });
const html = readFileSync(htmlPath, "utf8");

const browser = await chromium.launch();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

interface Row {
  scene: string;
  fps: number;
  gapMedian: number;
  gapP95: number;
  /** 20ms보다 늦은 프레임 비율 (%) — p95는 16.7ms 배수로만 움직여 거칠다 */
  slowPct: number;
  sim: number;
  draw: number;
  hud: number;
  total: number;
  maxTotal: number;
  stepsPerFrame: number;
  enemies: number;
  balls: number;
  /** 측정이 끝났을 때 그리기 해상도 (느린 기기에서 낮아진다) */
  renderScale: number;
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.min(s.length - 1, Math.floor(p * s.length))] as number) : 0;
};

async function one(scene: string): Promise<Row> {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  await ctx.route("http://pop.test/**", (r: Any) => r.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><meta charset="utf-8">${html}` }));
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await p.goto(`http://pop.test/#${scene}-x1`);
  await p.waitForTimeout(warm * 1000);
  await p.evaluate(() => (globalThis as Any).__pop.perfReset());
  if (profile) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
  }
  const enemies: number[] = [];
  const balls: number[] = [];
  for (let t = 0; t < seconds; t++) {
    await p.waitForTimeout(1000);
    const d = await p.evaluate(() => ({ e: (globalThis as Any).__pop.enemies, b: (globalThis as Any).__pop.balls }));
    enemies.push(d.e);
    balls.push(d.b);
  }
  const perf = await p.evaluate(() => JSON.parse(JSON.stringify((globalThis as Any).__pop.perf)));
  const renderScale = await p.evaluate(() => (globalThis as Any).__pop.renderScale ?? 0);
  if (profile) {
    const { profile: prof } = await cdp.send("Profiler.stop");
    // 함수별 self 시간 (샘플 수 × 간격)
    const byId = new Map<number, Any>(prof.nodes.map((n: Any) => [n.id, n]));
    const self = new Map<string, number>();
    const counts = new Map<number, number>();
    for (const s of prof.samples as number[]) counts.set(s, (counts.get(s) ?? 0) + 1);
    let all = 0;
    for (const [id, c] of counts) {
      const n = byId.get(id);
      const f = n.callFrame;
      const key = `${f.functionName || "(익명)"} ${f.url ? `:${f.lineNumber + 1}` : ""}`;
      self.set(key, (self.get(key) ?? 0) + c);
      all += c;
    }
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    const lines = top.map(([k, c]) => `${((c / all) * 100).toFixed(1).padStart(5)}%  ${k}`);
    writeFileSync(`${out}/${scene}-profile.txt`, lines.join("\n"));
    console.log(`  프로파일 상위 (${scene}):\n${lines.slice(0, 15).map((l) => `    ${l}`).join("\n")}`);
  }
  await p.screenshot({ path: `${out}/${scene}.png` });
  await ctx.close();
  const f = Math.max(1, perf.frames);
  return {
    scene,
    fps: Math.round((perf.frames / seconds) * 10) / 10,
    gapMedian: Math.round(pct(perf.gaps, 0.5) * 10) / 10,
    gapP95: Math.round(pct(perf.gaps, 0.95) * 10) / 10,
    slowPct: Math.round((perf.gaps.filter((x: number) => x > 20).length / Math.max(1, perf.gaps.length)) * 1000) / 10,
    sim: Math.round((perf.sim / f) * 100) / 100,
    draw: Math.round((perf.draw / f) * 100) / 100,
    hud: Math.round((perf.hud / f) * 100) / 100,
    total: Math.round((perf.total / f) * 100) / 100,
    maxTotal: Math.round(perf.maxTotal),
    stepsPerFrame: Math.round((perf.steps / f) * 100) / 100,
    enemies: Math.round(enemies.reduce((a, b) => a + b, 0) / enemies.length),
    balls: Math.round(balls.reduce((a, b) => a + b, 0) / balls.length),
    renderScale,
  };
}

const rows: Row[] = [];
for (const s of scenes) {
  const r = await one(s);
  rows.push(r);
  console.log(
    `${s.padEnd(16)} fps ${String(r.fps).padStart(5)} · 간격 중앙 ${r.gapMedian}ms p95 ${r.gapP95}ms · 20ms 넘은 프레임 ${r.slowPct}% · 프레임당 sim ${r.sim} draw ${r.draw} hud ${r.hud} = ${r.total}ms (최대 ${r.maxTotal}) · 틱/프레임 ${r.stepsPerFrame} · 적 ${r.enemies} 공 ${r.balls} · 해상도 ${r.renderScale}`,
  );
}
await browser.close();
writeFileSync(`${out}/perf.json`, JSON.stringify({ throttle, seconds, rows }, null, 2));
