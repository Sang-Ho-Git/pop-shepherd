/**
 * 영구 강화 진행 시뮬: 새 세이브에서 시작해 런을 이어서 하고, 런마다 코인을 받아 영구 강화를 산다.
 *   npm run progress -- --runs 20 --character olly [--save save.json]
 *   --character a,b,c  여러 캐릭터를 차례로 번갈아 플레이
 *   --save 파일        세이브를 파일에 읽고 쓴다 (없으면 메모리)
 * 기획 목표: 트리 전체를 채우는 데 15~20런.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runCampaign } from "../src/sim/campaign.ts";
import { CAMPAIGN } from "../src/data/index.ts";
import { botSpend, loadSave, memoryStore, recordRun, treeProgress, writeSave } from "../src/progression/save.ts";
import type { SaveStore } from "../src/progression/save.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}
const runs = Number(arg("runs", "20"));
const chars = arg("character", "shepherd").split(",");
const file = arg("save", "");
const store: SaveStore = file
  ? { read: () => (existsSync(file) ? readFileSync(file, "utf8") : null), write: (t) => writeFileSync(file, t) }
  : memoryStore();

let save = loadSave(store, (text, error) => {
  writeFileSync(`${file}.broken`, text);
  console.log(`세이브가 깨져 있어 새로 시작 (${error}). 원본: ${file}.broken`);
});
console.log("런   캐릭터     도달  완주  받은코인  남은코인  트리");
for (let i = 0; i < runs; i++) {
  const ch = chars[i % chars.length] as string;
  const r = runCampaign(1000 + save.runs, ch, CAMPAIGN, { meta: save.meta });
  save = botSpend(recordRun(save, r));
  writeSave(store, save);
  console.log(
    [String(save.runs).padStart(3), ch.padEnd(9), String(r.reached).padStart(5), (r.won ? "O" : "-").padStart(4), String(r.coins).padStart(8), String(save.coins).padStart(8), `${Math.round(treeProgress(save) * 100)}%`.padStart(5)].join("  "),
  );
}
console.log(`\n완주 ${save.wins}/${save.runs} · 최고 ${save.bestStage}스테이지 · 트리 ${Math.round(treeProgress(save) * 100)}%`);
