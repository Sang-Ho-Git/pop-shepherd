/**
 * tools/meta-curve.ts의 작업자 (worker_threads). 처음에 variant를 적용하고, 받은 일을 하나씩 돌려 결과를 돌려준다.
 *   { kind: "run", seed, character, coins }      코인 c개를 싼 노드부터 쓴 프로필로 런 하나
 *   { kind: "seq", seq, chars, maxRuns }         새 세이브에서 연속 런 (캐릭터 번갈아), 트리가 다 차거나 maxRuns까지
 */
import { parentPort, workerData } from "node:worker_threads";
import { runCampaign } from "../src/sim/campaign.ts";
import { CAMPAIGN } from "../src/data/index.ts";
import { profileForCoins } from "../src/progression/meta.ts";
import { botSpend, newSave, recordRun, treeProgress } from "../src/progression/save.ts";
import { VARIANTS } from "./variants.ts";

const { variant, ballMode } = workerData as { variant: string; ballMode: boolean };
for (const v of variant.split("+")) {
  const apply = VARIANTS[v];
  if (!apply) throw new Error(`알 수 없는 variant: ${v}`);
  apply();
}

export type Job = { id: number; kind: "run"; seed: number; character: string; coins: number } | { id: number; kind: "seq"; seq: number; chars: string[]; maxRuns: number };

export interface RunRow {
  won: boolean;
  reached: number;
  coins: number;
  coinsFromGold: number;
  goldLeft: number;
}
export interface SeqRow extends RunRow {
  character: string;
  /** 이 런이 끝나고 산 뒤의 트리 진행 (0~1) */
  tree: number;
}

parentPort!.on("message", (job: Job) => {
  if (job.kind === "run") {
    const meta = job.coins > 0 ? profileForCoins(job.coins) : undefined;
    const r = runCampaign(job.seed, job.character, CAMPAIGN, { ballMode, meta });
    const row: RunRow = { won: r.won, reached: r.reached, coins: r.coins, coinsFromGold: r.coinsFromGold, goldLeft: r.goldLeft };
    parentPort!.postMessage({ id: job.id, row });
    return;
  }
  let save = newSave();
  const rows: SeqRow[] = [];
  for (let i = 0; i < job.maxRuns; i++) {
    const ch = job.chars[(job.seq + i) % job.chars.length] as string;
    const r = runCampaign(job.seq * 1000 + i, ch, CAMPAIGN, { meta: save.meta, ballMode });
    save = botSpend(recordRun(save, r));
    const tree = treeProgress(save);
    rows.push({ character: ch, won: r.won, reached: r.reached, coins: r.coins, coinsFromGold: r.coinsFromGold, goldLeft: r.goldLeft, tree });
    if (tree >= 1) break;
  }
  parentPort!.postMessage({ id: job.id, rows });
});
