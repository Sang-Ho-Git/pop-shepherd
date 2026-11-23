/**
 * 시험 진입로(#stageN) 빌드 만들기: 캐릭터마다 봇 런(색 공)을 돌려, 스테이지 N 시작 때 실제로 넘어온 상태를 저장한다.
 * 마지막 스테이지까지 간 런을 고른다 (시드 11부터 차례로). 결과: web/dev-builds.json
 *   node tools/dev-builds.ts
 */
import { writeFileSync } from "node:fs";
import { CAMPAIGN } from "../src/data/index.ts";
import { runCampaign } from "../src/sim/campaign.ts";
import type { Carry } from "../src/sim/campaign.ts";

const out: Record<string, Record<number, Carry>> = {};
for (const ch of ["shepherd", "cue", "olly", "pale"]) {
  for (let seed = 11; seed < 60; seed++) {
    const got: Record<number, Carry> = {};
    const r = runCampaign(seed, ch, CAMPAIGN, { ballMode: true, onCarry: (i, c) => (got[i + 1] = structuredClone(c)) });
    if (r.stages.length < CAMPAIGN.length) continue;
    out[ch] = got;
    console.log(`${ch}: 시드 ${seed}, 스테이지 15 시작 Lv${got[15]!.level} · ${got[15]!.weapons.map((w) => `${w.id}${w.lv}`).join(" ")}`);
    break;
  }
}
writeFileSync(new URL("../web/dev-builds.json", import.meta.url), JSON.stringify(out) + "\n");
