/**
 * 11/25 응집 시험안 비교: 완주, 판당 팝 수, 분당 팝, 평균 연쇄를 본다 (강화 0, 색 공 규칙).
 * node tools/cohesion.ts <variant> <시드 수> <시작 시드> <캐릭터,..> [--json 파일]
 * node tools/cohesion.ts --merge 파일..
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CAMPAIGN } from "../src/data/index.ts";
import { runCampaign } from "../src/sim/campaign.ts";
import { VARIANTS } from "./variants.ts";

interface Row { ch: string; seed: number; won: boolean; reached: number; minutes: number; pops: number; cushionPops: number; avgChain: number }

function summarize(rows: Row[]): void {
  const n = rows.length;
  const won = rows.filter((r) => r.won).length;
  const chars = [...new Set(rows.map((r) => r.ch))];
  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  const min = sum((r) => r.minutes);
  console.log(`완주 ${won}/${n} (${((100 * won) / n).toFixed(0)}%) | ${chars.map((c) => `${c} ${rows.filter((r) => r.ch === c && r.won).length}`).join(" · ")}`);
  console.log(`판당 팝 ${(sum((r) => r.pops) / n).toFixed(0)} · 분당 팝 ${(sum((r) => r.pops) / min).toFixed(1)} · 쿠션 팝 판당 ${(sum((r) => r.cushionPops) / n).toFixed(1)} · 평균 연쇄 ${(sum((r) => r.avgChain) / n).toFixed(2)} · 평균 도달 스테이지 ${(sum((r) => r.reached) / n + 1).toFixed(1)}`);
}

const args = process.argv.slice(2);
if (args[0] === "--merge") summarize(args.slice(1).flatMap((f) => JSON.parse(readFileSync(f, "utf8")) as Row[]));
else {
  const v = args[0] ?? "base";
  const n = Number(args[1] ?? "36");
  const start = Number(args[2] ?? "11");
  const chars = (args[3] ?? "shepherd,cue,olly,pale").split(",");
  VARIANTS[v]!();
  const rows: Row[] = [];
  for (const ch of chars)
    for (let s = start; s < start + n; s++) {
      const r = runCampaign(s, ch, CAMPAIGN, { ballMode: true });
      const pops = r.stages.reduce((a, x) => a + x.pops, 0);
      rows.push({
        ch, seed: s, won: r.won, reached: r.stages.filter((x) => x.cleared).length,
        minutes: r.stages.reduce((a, x) => a + x.survived, 0) / 60,
        pops, cushionPops: r.cushionPops,
        avgChain: r.stages.reduce((a, x) => a + x.avgChain * x.pops, 0) / Math.max(1, pops),
      });
    }
  const ji = args.indexOf("--json");
  if (ji >= 0) writeFileSync(args[ji + 1]!, JSON.stringify(rows));
  else summarize(rows);
}
