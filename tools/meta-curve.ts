/**
 * 영구 강화 곡선 측정 (작업자 여러 개로 나눠 돌린다).
 *
 * 영구 강화는 캐릭터별 트리다 (11/24). 코인 지갑은 공용.
 * 1) 코인 양별 완주율: 코인 c개를 그 캐릭터 트리에 싼 노드부터 쓴 프로필로 시드 × 캐릭터를 돌린다.
 *    node tools/meta-curve.ts coins --coins 0,500,1000,1500,all --seeds 9 --ball [--variant hard20]
 *    all = 그 캐릭터 트리 전체 비용 (캐릭터마다 다를 수 있음)
 * 2) 연속 런: 새 세이브에서 런을 이어 하며(런마다 방금 한 캐릭터의 트리를 봇이 가장 싼 노드부터 산다)
 *    첫 완주가 몇 번째 런인지, 트리를 다 채우는 데 몇 런인지 여러 시퀀스로 잰다.
 *    node tools/meta-curve.ts seq --chars shepherd --seqs 12 --max-runs 40 --ball   한 캐릭터만 계속
 *    node tools/meta-curve.ts seq --seqs 12 --max-runs 120 --ball                   4캐릭터 번갈아 (네 트리가 다 찰 때까지)
 *
 * --dump 파일 (coins 모드): 런별 결과를 JSON으로 저장
 * --workers N (기본: CPU 수), --chars a,b,c (기본 4캐릭터), --seed-start (기본 11)
 */
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { totalTreeCost } from "../src/progression/meta.ts";
import type { Job, RunRow, SeqRow } from "./meta-worker.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}
const mode = process.argv[2] ?? "coins";
const variant = arg("variant", "base");
const ballMode = process.argv.includes("--ball");
const chars = arg("chars", "shepherd,cue,olly,pale").split(",");
const workers = Number(arg("workers", String(availableParallelism())));
const seedStart = Number(arg("seed-start", "11"));

type Out = { id: number; row?: RunRow; rows?: SeqRow[] };

/** 일을 작업자들에게 나눠 주고 결과를 id 순서로 모은다 */
async function runPool(jobs: Job[]): Promise<Out[]> {
  const results: Out[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const started = Date.now();
  await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, async () => {
      const w = new Worker(new URL("./meta-worker.ts", import.meta.url), { workerData: { variant, ballMode } });
      try {
        for (;;) {
          const job = jobs[next++];
          if (!job) break;
          const out = await new Promise<Out>((resolve, reject) => {
            w.once("message", resolve);
            w.once("error", reject);
            w.postMessage(job);
          });
          w.removeAllListeners("error");
          results[job.id] = out;
          done++;
          if (process.stderr.isTTY) process.stderr.write(`\r${done}/${jobs.length} (${Math.round((Date.now() - started) / 1000)}초)`);
        }
      } finally {
        await w.terminate();
      }
    }),
  );
  if (process.stderr.isTTY) process.stderr.write("\n");
  return results;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

const pct = (a: number, b: number): string => `${Math.round((a / b) * 100)}%`;

async function coinsMode(): Promise<void> {
  // 코인 양 칸: 숫자 또는 all (캐릭터마다 자기 트리 전체 비용)
  const labels = arg("coins", "0,500,1000,1500,all").split(",");
  const coinsOf = (label: string, ch: string): number => (label === "all" ? totalTreeCost(ch) : Number(label));
  const seeds = Number(arg("seeds", "9"));
  const jobs: (Job & { label: string })[] = [];
  for (const label of labels) for (const character of chars) for (let s = seedStart; s < seedStart + seeds; s++) jobs.push({ id: jobs.length, kind: "run", seed: s, character, coins: coinsOf(label, character), label });
  const res = await runPool(jobs);
  const dump = arg("dump", "");
  if (dump) writeFileSync(dump, JSON.stringify(jobs.map((j, i) => ({ ...j, ...res[i]!.row }))));
  console.log(`variant ${variant}${ballMode ? " (색 공)" : ""} · 캐릭터 트리 전체 ${chars.map((c) => `${c} ${totalTreeCost(c)}`).join(", ")} 코인 · 시드 ${seeds} × ${chars.join(",")}`);
  console.log(`| 코인 | 완주 | ${chars.join(" | ")} | 평균 도달 | 평균 코인 (골드 몫) | 평균 남은 골드 |`);
  console.log(`|---|---|${chars.map(() => "---|").join("")}---|---|---|`);
  for (const label of labels) {
    const rows = jobs.flatMap((j, i) => (j.label === label ? [{ j, r: res[i]!.row! }] : []));
    const won = rows.filter((x) => x.r.won).length;
    const per = chars.map((c) => {
      const cr = rows.filter((x) => x.j.kind === "run" && x.j.character === c);
      return `${cr.filter((x) => x.r.won).length}/${cr.length}`;
    });
    const avg = (f: (r: RunRow) => number): string => (rows.reduce((a, x) => a + f(x.r), 0) / rows.length).toFixed(1);
    console.log(`| ${label === "all" ? "트리 전체" : label} | ${won}/${rows.length} (${pct(won, rows.length)}) | ${per.join(" | ")} | ${avg((r) => r.reached)} | ${avg((r) => r.coins)} (${avg((r) => r.coinsFromGold)}) | ${avg((r) => r.goldLeft)} |`);
  }
}

async function seqMode(): Promise<void> {
  const seqs = Number(arg("seqs", "12"));
  const maxRuns = Number(arg("max-runs", chars.length > 1 ? "120" : "40"));
  const jobs: Job[] = Array.from({ length: seqs }, (_, i) => ({ id: i, kind: "seq", seq: seedStart + i, chars, maxRuns }));
  const res = await runPool(jobs);
  const how = chars.length > 1 ? `${chars.join(",")} 번갈아` : `${chars[0]}만`;
  console.log(`variant ${variant}${ballMode ? " (색 공)" : ""} · 캐릭터 트리 ${chars.map((c) => `${c} ${totalTreeCost(c)}`).join(", ")} 코인 · 시퀀스 ${seqs}개 (최대 ${maxRuns}런, ${how})`);
  const firstWins: number[] = [];
  const firstFull: number[] = [];
  const allFull: number[] = [];
  const at5: number[] = [];
  let coinSum = 0;
  let goldSum = 0;
  let runSum = 0;
  const multi = chars.length > 1;
  console.log(multi ? "| 시퀀스 | 첫 완주 | 5런 뒤 코인 | 첫 트리 다 참 | 네 트리 다 참 | 캐릭터별 다 참 |" : "| 시퀀스 | 첫 완주 | 5런 뒤 코인 | 트리 50% | 트리 다 참 | 런별 도달 (O=완주) |");
  console.log("|---|---|---|---|---|---|");
  for (const [i, o] of res.entries()) {
    const rows = o.rows!;
    const fw = rows.findIndex((r) => r.won) + 1;
    const fullAt = (c: string): number => rows.findIndex((r) => (r.trees[c] ?? 0) >= 1) + 1;
    const per = chars.map(fullAt);
    const first = per.every((x) => x === 0) ? 0 : Math.min(...per.filter((x) => x > 0));
    const all = per.every((x) => x > 0) ? Math.max(...per) : 0;
    const e5 = rows[Math.min(4, rows.length - 1)]!.earned;
    if (fw > 0) firstWins.push(fw);
    if (first > 0) firstFull.push(first);
    if (all > 0) allFull.push(all);
    at5.push(e5);
    for (const r of rows) {
      coinSum += r.coins;
      goldSum += r.coinsFromGold;
      runSum++;
    }
    if (multi) console.log(`| ${seedStart + i} | ${fw || "-"} | ${e5} | ${first || "-"} | ${all || `>${rows.length}`} | ${chars.map((c, k) => `${c} ${per[k] || "-"}`).join(" · ")} |`);
    else {
      const c = chars[0] as string;
      const half = rows.findIndex((r) => (r.trees[c] ?? 0) >= 0.5) + 1;
      console.log(`| ${seedStart + i} | ${fw || "-"} | ${e5} | ${half || "-"} | ${all || `>${rows.length}`} | ${rows.map((r) => (r.won ? "O" : String(r.reached))).join(" ")} |`);
    }
  }
  const s = (xs: number[]): string => (xs.length ? `중앙값 ${median(xs)} (최소 ${Math.min(...xs)}, 최대 ${Math.max(...xs)}, ${xs.length}/${seqs})` : "없음");
  console.log(`\n첫 완주 런: ${s(firstWins)}`);
  console.log(`5런 뒤 번 코인: ${s(at5)}`);
  if (multi) console.log(`첫 트리 다 참: ${s(firstFull)}`);
  console.log(`${multi ? "네 트리" : "트리"} 다 참: ${s(allFull)}`);
  console.log(`런당 코인 평균 ${(coinSum / runSum).toFixed(1)} (그중 골드 몫 ${(goldSum / runSum).toFixed(1)})`);
}

if (mode === "coins") await coinsMode();
else if (mode === "seq") await seqMode();
else throw new Error(`알 수 없는 모드: ${mode} (coins | seq)`);
