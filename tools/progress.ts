/**
 * 영구 강화 진행 시뮬: 새 세이브에서 시작해 런을 이어서 하고, 런마다 코인을 받아 영구 강화를 산다.
 *   npm run progress -- --runs 20 --character olly [--save save.json]
 *   --character a,b,c  여러 캐릭터를 차례로 번갈아 플레이
 *   --save 파일        세이브를 파일에 읽고 쓴다 (없으면 메모리)
 *   --unlocks          열린 캐릭터만 고른다 (--character 목록 중 열린 것을 번갈아, 목록에 열린 것이 없으면 열린 것 전부).
 *                      --character를 안 주면 열린 캐릭터 전부를 번갈아 한다. 런마다 새로 열린 캐릭터를 찍는다.
 *   --newest           --unlocks와 함께: 가장 최근에 열린 캐릭터로 한다 (새 캐릭터를 바로 써 보는 사람)
 *   --seed n           시드 시작값 (기본 1000, 런 i의 시드는 n + i)
 *   --ball             색 공 규칙
 *   --contact-mul k    측정용: 모든 스테이지의 접촉 피해 배율에 k를 곱한다 (메모리에서만, 데이터는 그대로).
 *                      기본 난이도를 올리기 전에 '첫 판 완주 약 20%' 근사로 해금 런 번호를 재는 데 썼다 (k=1.5, 색 공 규칙).
 * 영구 강화는 캐릭터별 트리 (코인 지갑은 공용): 런이 끝나면 방금 한 캐릭터의 트리를 산다. '트리'는 그 캐릭터 트리 진행.
 * 기획 목표 (11/24 캐릭터별): 한 캐릭터만 하면 그 트리를 채우는 데 약 20~25런, 네 캐릭터 전부 약 60~80런.
 * 여러 시퀀스 통계는 tools/meta-curve.ts seq.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runCampaign } from "../src/sim/campaign.ts";
import { CAMPAIGN, STAGES } from "../src/data/index.ts";
import { allTreesProgress, botSpend, loadSave, memoryStore, profileOf, recordRun, treeProgress, writeSave } from "../src/progression/save.ts";
import type { SaveStore } from "../src/progression/save.ts";
import { newlyUnlocked } from "../src/progression/unlocks.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}
const runs = Number(arg("runs", "20"));
const useUnlocks = process.argv.includes("--unlocks");
const newest = process.argv.includes("--newest");
const chars = arg("character", useUnlocks ? "" : "shepherd").split(",").filter(Boolean);
const seed0 = Number(arg("seed", "1000"));
const contactK = Number(arg("contact-mul", "1"));
if (contactK !== 1) for (const id of CAMPAIGN) STAGES[id]!.contactMul = (STAGES[id]!.contactMul ?? 1) * contactK;
const file = arg("save", "");
const ballMode = process.argv.includes("--ball");
const store: SaveStore = file
  ? { read: () => (existsSync(file) ? readFileSync(file, "utf8") : null), write: (t) => writeFileSync(file, t) }
  : memoryStore();

let save = loadSave(store, (text, error) => {
  writeFileSync(`${file}.broken`, text);
  console.log(`세이브가 깨져 있어 새로 시작 (${error}). 원본: ${file}.broken`);
});
/** 이번 런의 캐릭터 */
function pick(i: number): string {
  if (!useUnlocks) return chars[i % chars.length] as string;
  if (newest) return save.unlocked[save.unlocked.length - 1] as string;
  const open = chars.filter((c) => save.unlocked.includes(c));
  const pool = open.length > 0 ? open : save.unlocked;
  return pool[i % pool.length] as string;
}
/** 캐릭터가 열린 런 번호 */
const unlockedAt: Record<string, number> = {};
console.log("런   캐릭터     도달  완주  받은코인  남은코인  트리  쿠션 3쿠션  터뜨림  새로 열림");
for (let i = 0; i < runs; i++) {
  const ch = pick(i);
  const r = runCampaign(seed0 + save.runs, ch, CAMPAIGN, { meta: profileOf(save, ch), ballMode });
  const before = save;
  save = botSpend(recordRun(save, r), ch);
  writeSave(store, save);
  const fresh = newlyUnlocked(before, save);
  for (const id of fresh) unlockedAt[id] = save.runs;
  console.log(
    [
      String(save.runs).padStart(3),
      ch.padEnd(9),
      String(r.reached).padStart(5),
      (r.won ? "O" : "-").padStart(4),
      String(r.coins).padStart(8),
      String(save.coins).padStart(8),
      `${Math.round(treeProgress(save, ch) * 100)}%`.padStart(5),
      String(r.cushionPops).padStart(4),
      String(r.threeCushions).padStart(5),
      String(r.poppedEnemies).padStart(7),
      fresh.join(","),
    ].join("  "),
  );
}
console.log(`\n완주 ${save.wins}/${save.runs} · 최고 ${save.bestStage}스테이지 · 트리 ${Object.keys(save.characters).map((c) => `${c} ${Math.round(treeProgress(save, c) * 100)}%`).join(" ")} (평균 ${Math.round(allTreesProgress(save) * 100)}%)`);
console.log(`해금: ${save.unlocked.map((id) => `${id}@${unlockedAt[id] ?? 0}`).join(" ")}  (숫자는 열린 런 번호, 0은 처음부터)`);
console.log(`누적: 쿠션 팝 ${save.totals.cushionPops} · 3쿠션 ${save.totals.threeCushions} · 터뜨린 적 ${save.totals.poppedEnemies}`);
