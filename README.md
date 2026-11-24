# 팝 셰퍼드 (Pop Shepherd)

같은 색 양을 셋 이상 부딪혀 터뜨리는 색깔 몰이 서바이벌. 스테이지 15개(약 32분), 캐릭터 4명, 무기 7종(갈래·진화), 보스 2종.
코어 시뮬레이션은 화면 없이 돌고 규칙은 자동 테스트로 묶여 있다. 그 위에 브라우저 화면(`web/`)이 있다.

설계 문서: "팝 셰퍼드 구조 트리와 로드맵" (코어 규칙 명세, 보스·엘리트·드롭 탭), "팝 셰퍼드 무기 밸런스" 시트.
작업 기록: `docs/` (날짜별).

## 하는 법 (브라우저판)

- 이동 WASD·방향키, 휘슬 Space, 일시정지 Esc, 카드 1·2·3, 소리 M
- **색 공 규칙** (기본 켜짐, 타이틀에서 끄기): 마우스로 조준하고 클릭으로 던진다. 같은 색 무리에 맞혀 공까지 3마리가 되면 터진다. 오른쪽 클릭·Q로 다음 공과 바꾼다. 공은 당구공처럼 굴러가다 멈추고, 울타리·바위·반사벽(쿠션)에서 튕기며 다른 색에 맞으면 맞고 튕긴다. 쿠션을 거친 팝은 보너스 (1쿠션 +30%, 2쿠션 +60%, 3쿠션 이상 +120%). 큐는 조준선이 늘 보이고 3쿠션까지 꺾여 보인다.
- **기존 규칙**: 무기가 자동으로 적을 날리고, 날아간 적이 같은 색에 세게 부딪혀야 터진다.
- 휴대폰: 누르고 끌면 이동, 톡 치면 그곳으로 던지기, 오른쪽 아래 버튼이 휘슬·바꾸기.
- 스테이지 시험: 타이틀의 "스테이지 시험"에서 캐릭터와 스테이지를 골라 바로 시작한다. 뒤 스테이지는 봇 런의 실제 빌드로 시작한다. 링크 끝에 `#stage15-cue`처럼 붙여도 된다 (기록·코인에는 넣지 않는다).
- 자동 플레이(점검용): 링크 끝에 `#auto-cue-s1-x3` (캐릭터, 시작 스테이지, 속도)를 붙이면 봇이 실제 화면에서 런을 한다.

## 실행

Node 22.18 이상 (TypeScript 파일을 Node가 직접 실행한다).

```bash
npm install
npm run check        # 타입 검사(코어 + 웹) + 전체 테스트
npm run build:web    # 브라우저판을 한 파일로: dist/pop-shepherd.html
npm run campaign -- --seeds 8 --character olly --ball   # 스테이지 1→15 런 시뮬 (--ball: 색 공 규칙, --meta-coins N: 영구 강화)
npm run progress -- --runs 20 --character shepherd,cue,olly,pale --ball   # 세이브를 이어 쓰는 연속 런 (트리가 차는 속도)
npm run sim -- --stage m1_proving --weapons kick:4B,shockwave:3,magnet_totem:evo   # 고정 구성 한 판
npm run calib -- paint_gun   # 무기 레벨별 실측 타격 수와 발사력(LP)
node tools/share.ts --weapons paint_gun:3,kick:3 --ball   # 팝을 누가 일으켰는지 (무기별 몫)
node tools/probe.ts --variant noTraits --ball --seeds 36 --seed-start 11   # 조건만 바꿔 완주 비교 (조건은 tools/variants.ts, 캐릭터 비교는 36시드 이상)
node tools/stage15.ts base 30 [스테이지] --pool <파일>   # 한 스테이지만 실제 빌드로 (빌드 묶음은 tools/dev-builds.ts --pool)
tools/runtune.sh base <폴더>   # 강화 0 완주 두 시드 벌(11~46, 47~82) × 캐릭터 4 병렬 + 무기별 완주·회오리 삭제·이동 속도 패시브 (조건은 tools/variants.ts)
node tools/shot-whirl.mjs docs/shots   # 회오리 동작 스크린샷 (build:web 뒤)
node tools/realtime.mjs --runs auto-cue-x3,auto-olly-s15 --out <폴더>   # 브라우저 실시간 점검 (오류·멈춤·프레임)
```

## 구조

| 경로 | 내용 | 구조 트리 |
| --- | --- | --- |
| `src/core/` | 규칙 수치(`rules.ts`), 시드 난수, 게임 상태와 고정 틱(`game.ts`) | 1.x, 5.3 |
| `src/world/` | 발사·감속·울타리·당구·겹침 해소, 바위, 공간 해시 | 1.2, 3.3, 5.4 |
| `src/combat/` | 매치(BFS), 팝·충격파·연쇄·폭탄, 출현, 엘리트·보스, 색 공 | 1.3–1.7, 3.2 |
| `src/weapons/` | 무기 동작 7종: pulse, directional, zone, pull, projectile, orbit, wall + 갈래·진화 효과 | 2.1 |
| `src/progression/` | 레벨업 카드, 패시브, 상점, 보물 상자, 영구 강화, 세이브 | 2.1–2.3, 5.5 |
| `src/sim/` | 봇, 한 판 시뮬, 스테이지 1→10 런 | 6.3 |
| `web/` | 캔버스 화면, 입력, 메뉴·카드·상점·영구 강화, 효과음 | 4.x |
| `data/` | 무기 7·캐릭터 4·패시브 10·적·스테이지 10·상점·영구 강화 트리 | 6.2 |
| `tools/` | 시뮬·측정·비교 도구, 웹 빌드 | 6.x |
| `tests/` | 규칙별 테스트 | |

## 원칙

- **시뮬레이션은 결정적이다.** 60Hz 고정 틱, 모든 무작위는 시드 난수 하나. 같은 시드면 상태 해시까지 같다.
- **무기·캐릭터·스테이지는 데이터다.** 무기 JSON의 LP가 목표 ±15%를 벗어나면 테스트가 실패한다.
- **수치는 시뮬로 정한다.** 바꿀 때는 측정 도구로 전후를 비교하고 작업 기록에 남긴다.
