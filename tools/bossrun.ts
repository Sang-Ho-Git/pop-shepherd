/**
 * 보스·엘리트 측정: 캠페인 런을 돌려 한 줄씩 JSON으로 찍는다 (병렬로 여러 개 띄워 합친다).
 *   node tools/bossrun.ts [variant] [시드 수] [시작 시드] [캐릭터,..] > 파일.jsonl
 *   node tools/bossrun.ts --sum 파일.jsonl ...   # 합쳐서 완주·죽은 스테이지·보스전 시간 표
 * 한 줄: 캐릭터, 시드, 완주, 죽은 스테이지(번호), 스테이지별 보스전 시간(등장부터 처치까지)·엘리트 처치 시간
 */
import { readFileSync } from "node:fs";
import { CAMPAIGN } from "../src/data/index.ts";
import { runCampaign } from "../src/sim/campaign.ts";
import { VARIANTS } from "./variants.ts";

if (process.argv[2] === "--sum") {
  const rows = process.argv.slice(3).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  const dead: Record<number, number> = {};
  let won = 0;
  const boss: Record<number, number[]> = {};
  const bossDmg: Record<number, number[]> = {};
  const elite: number[] = [];
  for (const r of rows) {
    if (r.won) won++;
    else dead[r.dead] = (dead[r.dead] ?? 0) + 1;
    for (const [k, t] of Object.entries(r.boss as Record<string, number>)) (boss[Number(k)] ??= []).push(t);
    for (const [k, t] of Object.entries((r.bossHit ?? {}) as Record<string, number>)) (bossDmg[Number(k)] ??= []).push(t);
    elite.push(...(r.elite as number[]));
  }
  const nDead = rows.length - won;
  const q = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] ?? NaN;
  console.log(`런 ${rows.length} · 완주 ${won} · 죽은 스테이지 ${Object.entries(dead).map(([k, c]) => `${k}:${c}`).join(" ")}`);
  for (const k of [5, 15]) {
    const d = dead[k] ?? 0;
    console.log(`스테이지 ${k}: 사망 ${d} (전체 사망의 ${((100 * d) / Math.max(1, nDead)).toFixed(0)}%)`);
    const t = boss[k] ?? [];
    if (t.length) console.log(`  보스전 시간 ${t.length}회: 중앙 ${q(t, 0.5).toFixed(0)}초, 25% ${q(t, 0.25).toFixed(0)}, 75% ${q(t, 0.75).toFixed(0)}, 최대 ${q(t, 1).toFixed(0)}`);
    const h = bossDmg[k] ?? [];
    if (h.length) console.log(`  보스전 받은 피해 중 보스 몫 평균 ${((100 * h.reduce((a, b) => a + b, 0)) / h.length).toFixed(0)}%`);
  }
  if (elite.length) console.log(`엘리트 처치 시간 ${elite.length}회: 중앙 ${q(elite, 0.5).toFixed(0)}초, 75% ${q(elite, 0.75).toFixed(0)}, 최대 ${q(elite, 1).toFixed(0)}`);
  process.exit(0);
}

const v = process.argv[2] ?? "base";
const n = Number(process.argv[3] ?? "12");
const start = Number(process.argv[4] ?? "11");
const chars = (process.argv[5] ?? "shepherd,cue,olly,pale").split(",");
VARIANTS[v]!();
for (const ch of chars) {
  for (let s = start; s < start + n; s++) {
    const r = runCampaign(s, ch, CAMPAIGN, { ballMode: true });
    const boss: Record<number, number> = {};
    const bossHit: Record<number, number> = {};
    r.stages.forEach((x, i) => {
      if (x.bossTime !== null) boss[i + 1] = Math.round(x.bossTime * 10) / 10;
      if (x.bossTime !== null || x.bossHpLeft !== null) bossHit[i + 1] = x.damageTaken > 0 ? Math.round((100 * x.damageFromSpecial) / x.damageTaken) / 100 : 0;
    });
    const elite = r.stages.flatMap((x) => (x as { eliteTimes?: number[] }).eliteTimes ?? []);
    console.log(JSON.stringify({ ch, seed: s, won: r.won, dead: r.won ? 0 : r.stages.length, boss, bossHit, elite }));
  }
}
