import { RULES } from "../src/core/rules.ts";
import type { Color, Enemy, Game } from "../src/core/types.ts";
import { BLADE_RADIUS } from "../src/weapons/weapons.ts";
import { predictBallPath } from "../src/combat/ball.ts";

/**
 * 캔버스 그리기. 시뮬 상태를 읽기만 한다.
 * 화면은 1280×720 월드 단위를 캔버스에 맞춰 늘리고(가로세로 비율 유지), 플레이어를 따라간다.
 * 색약을 위해 색마다 모양 표식을 함께 그린다 (빨강 ●, 파랑 ■, 노랑 ▲, 초록 ◆).
 */

export const PALETTE: Record<Color, string> = {
  red: "#ff5a5f",
  blue: "#3d8bff",
  yellow: "#ffd23f",
  green: "#3ccf7a",
  rainbow: "#ffffff",
  gray: "#8a8f98",
};

const GRASS_A = "#16302a";
const GRASS_B = "#1a372f";
const FENCE = "#c99a5b";
const INK = "#0d1b17";

export interface Fx {
  kind: "ring" | "text" | "line" | "spark";
  x: number;
  y: number;
  t: number;
  life: number;
  color: string;
  radius?: number;
  text?: string;
  /** line: 끝점 */
  x2?: number;
  y2?: number;
  /** spark: 속도 */
  vx?: number;
  vy?: number;
}

/** 화면 모드의 추가 정보 (색 공 조준) */
export interface Aim {
  x: number;
  y: number;
  /** 조준선을 그리는지 (스테이지 1은 늘, 2~3은 처음 25초, 그 뒤로는 없음. 큐는 늘) */
  line: boolean;
  /** 조준선이 보여 주는 쿠션 수 (큐는 3, 나머지는 1) */
  cushions: number;
  /** 지금 공과 같은 색으로 2마리 이상 닿은 무리 (반짝임) */
  ready: Set<number>;
}

export interface View {
  scale: number;
  ox: number;
  oy: number;
  camX: number;
  camY: number;
}

/**
 * 화면 배율: 기본은 1280×720 월드를 캔버스에 맞춘다. 세로 화면(휴대폰)에서는 그러면 너무 작아서,
 * 짧은 변에 월드 620px이 들어오도록 키운다 (보이는 범위는 좁아진다).
 */
export function computeView(g: Game, cw: number, ch: number): View {
  const vw = RULES.view.w;
  const vh = RULES.view.h;
  const scale = Math.max(Math.min(cw / vw, ch / vh), Math.min(cw, ch) / 620);
  const hw = cw / scale / 2;
  const hh = ch / scale / 2;
  const clamp = (c: number, half: number, size: number): number => (half * 2 >= size ? size / 2 : Math.min(size - half, Math.max(half, c)));
  return { scale, ox: cw / 2, oy: ch / 2, camX: clamp(g.player.x, hw, g.arena.w), camY: clamp(g.player.y, hh, g.arena.h) };
}

function toScreen(v: View, x: number, y: number): [number, number] {
  return [v.ox + (x - v.camX) * v.scale, v.oy + (y - v.camY) * v.scale];
}

function glyph(ctx: CanvasRenderingContext2D, color: Color, x: number, y: number, s: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  switch (color) {
    case "red":
      ctx.arc(x, y, s * 0.32, 0, Math.PI * 2);
      break;
    case "blue":
      ctx.rect(x - s * 0.3, y - s * 0.3, s * 0.6, s * 0.6);
      break;
    case "yellow":
      ctx.moveTo(x, y - s * 0.38);
      ctx.lineTo(x + s * 0.36, y + s * 0.28);
      ctx.lineTo(x - s * 0.36, y + s * 0.28);
      break;
    case "green":
      ctx.moveTo(x, y - s * 0.4);
      ctx.lineTo(x + s * 0.34, y);
      ctx.lineTo(x, y + s * 0.4);
      ctx.lineTo(x - s * 0.34, y);
      break;
    default:
      return;
  }
  ctx.closePath();
  ctx.fill();
}

function drawEnemy(ctx: CanvasRenderingContext2D, v: View, e: Enemy, time: number): void {
  const [x, y] = toScreen(v, e.x, e.y);
  const r = e.radius * v.scale;
  if (e.state === "launched") {
    // 발사 잔상
    ctx.strokeStyle = e.color === "rainbow" ? "rgba(255,255,255,0.35)" : PALETTE[e.color] + "66";
    ctx.lineWidth = r * 1.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - e.vx * 0.06 * v.scale, y - e.vy * 0.06 * v.scale);
    ctx.stroke();
  }
  if (e.color === "rainbow") {
    const grad = ctx.createConicGradient(time * 2, x, y);
    for (const [i, c] of ["#ff5a5f", "#ffd23f", "#3ccf7a", "#3d8bff", "#ff5a5f"].entries()) grad.addColorStop(i / 4, c);
    ctx.fillStyle = grad;
  } else ctx.fillStyle = PALETTE[e.color];
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // 윤기
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.38, r * 0.24, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, 2 * v.scale);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  if ((e.slowT ?? 0) > 0) {
    // 회오리 둔화: 하늘색 서리 테
    ctx.strokeStyle = "rgba(170,225,255,0.85)";
    ctx.lineWidth = Math.max(1.5, 3 * v.scale);
    ctx.setLineDash([4 * v.scale, 3 * v.scale]);
    ctx.beginPath();
    ctx.arc(x, y, r + 4 * v.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if ((e.bladeHits ?? 0) > 0 && e.rank === "normal") {
    // 회오리에 맞은 횟수: 머리 위 작은 점 (다 차면 사라진다)
    ctx.fillStyle = "rgba(230,245,255,0.95)";
    const n = e.bladeHits ?? 0;
    for (let k = 0; k < n; k++) {
      ctx.beginPath();
      ctx.arc(x + (k - (n - 1) / 2) * 6 * v.scale, y - r - 6 * v.scale, 2.2 * v.scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (e.trait === "spiky") {
    // 가시: 무기로 밀리지 않는다는 표시
    ctx.fillStyle = INK;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a - 0.2) * r, y + Math.sin(a - 0.2) * r);
      ctx.lineTo(x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35);
      ctx.lineTo(x + Math.cos(a + 0.2) * r, y + Math.sin(a + 0.2) * r);
      ctx.fill();
    }
  } else if (e.trait === "runner") {
    // 귀 두 개: 도망가는 양
    ctx.fillStyle = PALETTE[e.color === "rainbow" ? "yellow" : e.color];
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + s * r * 0.55, y - r * 0.95, r * 0.22, r * 0.42, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  if (e.wetT > 0) {
    ctx.strokeStyle = "rgba(255,143,216,0.8)";
    ctx.setLineDash([3 * v.scale, 3 * v.scale]);
    ctx.beginPath();
    ctx.arc(x, y, r + 4 * v.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  glyph(ctx, e.color, x, y + r * 0.1, r);
  if (e.state === "stunned") {
    ctx.fillStyle = "#fff6b0";
    for (let k = 0; k < 3; k++) {
      const a = time * 5 + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.9, y - r * 1.1 + Math.sin(a) * r * 0.25, Math.max(1.5, 2.5 * v.scale), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (e.rank !== "normal") {
    // 엘리트·보스: 금테와 체력 막대
    ctx.strokeStyle = e.rank === "boss" ? "#ffcf5a" : "#f1e3b5";
    ctx.lineWidth = Math.max(2, (e.rank === "boss" ? 5 : 3) * v.scale);
    ctx.beginPath();
    ctx.arc(x, y, r + 3 * v.scale, 0, Math.PI * 2);
    ctx.stroke();
    const b = e.boss;
    if (b && b.shield > 0) {
      // 보호막: 무지개 띠 + 남은 쿠션 수만큼 점
      ctx.lineWidth = 5 * v.scale;
      const cols = ["#ff5a5f", "#ffd23f", "#3ccf7a", "#3d8bff"];
      for (let k = 0; k < 4; k++) {
        ctx.strokeStyle = cols[k]!;
        ctx.beginPath();
        const a0 = time * 2 + (k * Math.PI) / 2;
        ctx.arc(x, y, r + 12 * v.scale, a0, a0 + Math.PI / 2);
        ctx.stroke();
      }
      ctx.fillStyle = "#ffffff";
      for (let k = 0; k < b.shield; k++) {
        ctx.beginPath();
        ctx.arc(x + (k - (b.shield - 1) / 2) * 14 * v.scale, y + r + 18 * v.scale, 4.5 * v.scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (b && b.groggy > 0) {
      // 그로기: 머리 위로 도는 별 다섯 + 노란 테
      ctx.strokeStyle = `rgba(255,236,120,${0.6 + 0.4 * Math.sin(time * 14)})`;
      ctx.lineWidth = 4 * v.scale;
      ctx.beginPath();
      ctx.arc(x, y, r + 8 * v.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fff6b0";
      // 화면 위쪽에 붙어 있으면 (울타리에 박힌 경우) 별을 몸 아래에 그린다 (HUD와 겹치지 않게)
      const sy = y - r < 70 * v.scale ? y + r + 10 * v.scale : y - r - 6 * v.scale;
      for (let k = 0; k < 5; k++) {
        const a = time * 4 + (k * Math.PI * 2) / 5;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r * 0.9, sy + Math.sin(a) * r * 0.25, Math.max(2, 3.5 * v.scale), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (b && b.weak) {
      // 약점 색: 머리 위 공 표식 (그 색 공을 맞히면 큰 피해). 깜빡이는 테로 눈에 띄게
      const wy = y - r - (e.rank === "elite" ? 26 : 22) * v.scale;
      const wr = Math.max(7, (e.rank === "boss" ? 13 : 10) * v.scale);
      ctx.fillStyle = PALETTE[b.weak];
      ctx.beginPath();
      ctx.arc(x, wy, wr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.45 * Math.sin(time * 6)})`;
      ctx.lineWidth = Math.max(1.5, 2.5 * v.scale);
      ctx.stroke();
      glyph(ctx, b.weak, x, wy, wr);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(x - wr * 0.5, wy + wr + 1);
      ctx.lineTo(x + wr * 0.5, wy + wr + 1);
      ctx.lineTo(x, wy + wr * 1.6);
      ctx.fill();
    }
    if (e.rank === "elite") {
      const w = r * 2;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x - w / 2, y - r - 12 * v.scale, w, 5 * v.scale);
      ctx.fillStyle = "#f1e3b5";
      ctx.fillRect(x - w / 2, y - r - 12 * v.scale, (w * Math.max(0, e.hp)) / e.maxHp, 5 * v.scale);
    }
  }
}

/** 보스·엘리트 공격 예고: 바닥 빨간 영역이 차오른다 (가득 차면 판정). 탄은 털뭉치 */
function drawHazards(ctx: CanvasRenderingContext2D, g: Game, v: View, time: number): void {
  for (const h of g.hazards) {
    const k = Math.max(0, Math.min(1, 1 - h.t / h.total));
    const [x, y] = toScreen(v, h.x, h.y);
    const pulse = 0.5 + 0.5 * Math.sin(time * 18);
    ctx.save();
    ctx.beginPath();
    if (h.kind === "circle") ctx.arc(x, y, h.r * v.scale, 0, Math.PI * 2);
    else if (h.kind === "line") {
      ctx.translate(x, y);
      ctx.rotate(h.ang);
      ctx.rect(0, -h.r * v.scale, h.len * v.scale, h.r * 2 * v.scale);
    } else {
      ctx.moveTo(x, y);
      ctx.arc(x, y, h.len * v.scale, h.ang - h.spread, h.ang + h.spread);
      ctx.closePath();
    }
    ctx.fillStyle = `rgba(255,60,60,${0.12 + 0.1 * k})`;
    ctx.fill();
    // 테두리는 실선: 무기 영역(토템·충격파)은 점선이라 위험 경고와 헷갈리지 않게
    ctx.strokeStyle = `rgba(255,80,80,${0.6 + 0.4 * pulse})`;
    ctx.lineWidth = Math.max(2.5, 3.5 * v.scale);
    ctx.stroke();
    // 차오르는 안쪽: 다 차면 터진다
    ctx.beginPath();
    if (h.kind === "circle") ctx.arc(x, y, h.r * v.scale * k, 0, Math.PI * 2);
    else if (h.kind === "line") ctx.rect(0, -h.r * v.scale, h.len * v.scale * k, h.r * 2 * v.scale);
    else {
      ctx.moveTo(x, y);
      ctx.arc(x, y, h.len * v.scale * k, h.ang - h.spread, h.ang + h.spread);
      ctx.closePath();
    }
    ctx.fillStyle = `rgba(255,70,70,${0.28 + 0.2 * k})`;
    ctx.fill();
    ctx.restore();
  }
  for (const s of g.shots) {
    const [x, y] = toScreen(v, s.x, s.y);
    const r = s.r * v.scale;
    ctx.fillStyle = "#f4efe4";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE[s.color];
    ctx.lineWidth = Math.max(2, 3 * v.scale);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,80,80,0.9)";
    ctx.lineWidth = Math.max(1, 1.5 * v.scale);
    ctx.beginPath();
    ctx.arc(x, y, r + 3 * v.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * 풀밭(바탕색 + 바둑판)을 경기장 크기로 한 번 그려 둔 그림. 배율이 바뀔 때만 다시 그린다.
 * 너무 크면(고해상도 데스크톱, 800만 픽셀 넘음) 만들지 않고 예전처럼 칸마다 칠한다.
 */
let grassCache: { canvas: HTMLCanvasElement; key: string } | null = null;
function grassImage(aw: number, ah: number, tile: number, scale: number): HTMLCanvasElement | null {
  const w = Math.ceil(aw * scale);
  const h = Math.ceil(ah * scale);
  if (w * h > 8_000_000 || typeof document === "undefined") return null;
  const key = `${aw}x${ah}@${scale}`;
  if (grassCache?.key === key) return grassCache.canvas;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { alpha: false });
  if (!x) return null;
  x.fillStyle = GRASS_A;
  x.fillRect(0, 0, w, h);
  x.fillStyle = GRASS_B;
  for (let i = 0; i < aw / tile; i++) {
    for (let j = 0; j < ah / tile; j++) {
      if ((i + j) % 2) continue;
      x.fillRect(i * tile * scale, j * tile * scale, tile * scale + 0.5, tile * scale + 0.5);
    }
  }
  grassCache = { canvas: c, key };
  return c;
}

export function drawWorld(ctx: CanvasRenderingContext2D, g: Game, v: View, fx: Fx[], time: number, aim: Aim | null = null): void {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  // 풀밭: 바둑판 무늬 (움직임이 보이게)
  const tile = 80;
  const [ax, ay] = toScreen(v, 0, 0);
  const [bx, by] = toScreen(v, g.arena.w, g.arena.h);
  // 바깥 어둠은 울타리 밖 띠만 칠한다 (예전에는 화면 전체를 먼저 칠했다: 폰에서는 캔버스 픽셀이 병목이라 전체 칠하기 한 번이 크다)
  ctx.fillStyle = "#08110e";
  if (ay > 0) ctx.fillRect(0, 0, cw, Math.ceil(ay));
  if (by < ch) ctx.fillRect(0, Math.floor(by), cw, ch - Math.floor(by));
  if (ax > 0) ctx.fillRect(0, 0, Math.ceil(ax), ch);
  if (bx < cw) ctx.fillRect(Math.floor(bx), 0, cw - Math.floor(bx), ch);
  const grass = grassImage(g.arena.w, g.arena.h, tile, v.scale);
  if (grass) {
    // 미리 그려 둔 풀밭에서 보이는 부분만 복사 (매 프레임 바둑판 칸 수십 개를 칠하지 않게)
    const dx = Math.round(ax);
    const dy = Math.round(ay);
    const sx = Math.max(0, -dx);
    const sy = Math.max(0, -dy);
    const sw = Math.min(grass.width - sx, cw - Math.max(0, dx));
    const sh = Math.min(grass.height - sy, ch - Math.max(0, dy));
    if (sw > 0 && sh > 0) ctx.drawImage(grass, sx, sy, sw, sh, Math.max(0, dx), Math.max(0, dy), sw, sh);
  } else {
    ctx.fillStyle = GRASS_A;
    ctx.fillRect(ax, ay, bx - ax, by - ay);
    ctx.fillStyle = GRASS_B;
    const x0 = Math.max(0, Math.floor((v.camX - cw / v.scale / 2) / tile));
    const x1 = Math.min(g.arena.w / tile, Math.ceil((v.camX + cw / v.scale / 2) / tile));
    const y0 = Math.max(0, Math.floor((v.camY - ch / v.scale / 2) / tile));
    const y1 = Math.min(g.arena.h / tile, Math.ceil((v.camY + ch / v.scale / 2) / tile));
    for (let i = x0; i < x1; i++) {
      for (let j = y0; j < y1; j++) {
        if ((i + j) % 2) continue;
        const [sx, sy] = toScreen(v, i * tile, j * tile);
        ctx.fillRect(sx, sy, tile * v.scale + 0.5, tile * v.scale + 0.5);
      }
    }
  }
  // 울타리
  ctx.strokeStyle = FENCE;
  ctx.lineWidth = 8 * v.scale;
  ctx.strokeRect(ax, ay, bx - ax, by - ay);

  // 개울 (맵 기믹)
  for (const st of g.stage?.streams ?? []) {
    const [sx0, sy0] = toScreen(v, 0, st.y);
    const [sx1, sy1] = toScreen(v, g.arena.w, st.y + st.h);
    ctx.fillStyle = "rgba(61,139,255,0.22)";
    ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    ctx.strokeStyle = "rgba(159,227,255,0.35)";
    ctx.lineWidth = 2 * v.scale;
    for (let k = 0; k < 4; k++) {
      const yy = sy0 + ((k + 0.5) / 4) * (sy1 - sy0);
      ctx.beginPath();
      for (let x = sx0; x <= sx1; x += 24 * v.scale) ctx.lineTo(x, yy + Math.sin(x / (40 * v.scale) + time * 2 + k) * 4 * v.scale);
      ctx.stroke();
    }
  }
  // 바위 (맵 기믹)
  for (const rk of g.stage?.rocks ?? []) {
    const [x, y] = toScreen(v, rk.x, rk.y);
    if (rk.bumper) {
      // 꽃 범퍼: 꽃잎 여섯 장
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + time * 0.6;
        ctx.fillStyle = "#ff9fcf";
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * rk.r * 0.6 * v.scale, y + Math.sin(a) * rk.r * 0.6 * v.scale, rk.r * 0.45 * v.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      ctx.arc(x, y, rk.r * 0.45 * v.scale, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.fillStyle = "#5b5f58";
    ctx.beginPath();
    ctx.arc(x, y, rk.r * v.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#71766d";
    ctx.beginPath();
    ctx.arc(x - rk.r * 0.25 * v.scale, y - rk.r * 0.25 * v.scale, rk.r * 0.6 * v.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2c2f2a";
    ctx.lineWidth = 4 * v.scale;
    ctx.beginPath();
    ctx.arc(x, y, rk.r * v.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 토템 범위
  for (const t of g.totems) {
    const [x, y] = toScreen(v, t.x, t.y);
    ctx.fillStyle = PALETTE[t.color] + "22";
    ctx.strokeStyle = PALETTE[t.color] + "aa";
    ctx.lineWidth = 2 * v.scale;
    ctx.setLineDash([8 * v.scale, 6 * v.scale]);
    ctx.beginPath();
    ctx.arc(x, y, t.radius * v.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#e9d8a6";
    ctx.fillRect(x - 5 * v.scale, y - 22 * v.scale, 10 * v.scale, 30 * v.scale);
    ctx.fillStyle = PALETTE[t.color];
    ctx.beginPath();
    ctx.arc(x, y - 24 * v.scale, 8 * v.scale, 0, Math.PI * 2);
    ctx.fill();
  }
  // 반사벽: 공과 날아온 양이 튕기는 단단한 쿠션 (캐릭터는 지나간다). 어두운 테두리 + 밝은 면 + 양끝 기둥
  for (const w of g.walls) {
    const [x1, y1] = toScreen(v, w.x1, w.y1);
    const [x2, y2] = toScreen(v, w.x2, w.y2);
    const core = w.boost > 1 ? "#ff9f43" : "#9fe3ff";
    // 사라지기 0.5초 전부터 깜빡인다 (언제 공 길이 열리는지 보이게)
    ctx.globalAlpha = w.t < 0.5 ? (Math.floor(w.t * 12) % 2 === 0 ? 0.25 : 0.9) : 1;
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 14 * v.scale;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = core;
    ctx.lineWidth = 8 * v.scale;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2 * v.scale;
    ctx.stroke();
    ctx.fillStyle = INK;
    for (const [qx, qy] of [[x1, y1], [x2, y2]] as const) {
      ctx.beginPath();
      ctx.arc(qx, qy, 8 * v.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // 바닥 아이템
  for (const m of g.milks) {
    const [x, y] = toScreen(v, m.x, m.y);
    ctx.fillStyle = "#f7f4ea";
    ctx.fillRect(x - 6 * v.scale, y - 9 * v.scale, 12 * v.scale, 18 * v.scale);
    ctx.fillStyle = "#5ab0ff";
    ctx.fillRect(x - 6 * v.scale, y - 2 * v.scale, 12 * v.scale, 5 * v.scale);
  }
  for (const gp of g.golds) {
    const [x, y] = toScreen(v, gp.x, gp.y);
    ctx.globalAlpha = gp.t < 4 ? 0.5 + 0.5 * Math.sin(time * 12) : 1;
    ctx.fillStyle = "#ffcf5a";
    ctx.beginPath();
    ctx.arc(x, y, (6 + Math.min(6, gp.amount)) * v.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#a7731d";
    ctx.lineWidth = 2 * v.scale;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const b of g.bombs) {
    const [x, y] = toScreen(v, b.x, b.y);
    ctx.fillStyle = "#1b1b1f";
    ctx.beginPath();
    ctx.arc(x, y, 12 * v.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE[b.color];
    ctx.lineWidth = 4 * v.scale;
    ctx.stroke();
  }
  for (const c of g.chests) {
    const [x, y] = toScreen(v, c.x, c.y);
    const s = (c.kind === "boss" ? 22 : 16) * v.scale;
    ctx.fillStyle = "#8a5a2b";
    ctx.fillRect(x - s, y - s * 0.7, s * 2, s * 1.4);
    ctx.fillStyle = "#ffcf5a";
    ctx.fillRect(x - s, y - s * 0.15, s * 2, s * 0.3);
    ctx.strokeStyle = `rgba(255,220,120,${0.4 + 0.4 * Math.sin(time * 6)})`;
    ctx.lineWidth = 3 * v.scale;
    ctx.strokeRect(x - s - 4 * v.scale, y - s * 0.7 - 4 * v.scale, s * 2 + 8 * v.scale, s * 1.4 + 8 * v.scale);
  }

  // 지금 공으로 터뜨릴 수 있는 무리: 바닥에 빛
  if (aim && aim.ready.size > 0) {
    ctx.fillStyle = `rgba(255,243,196,${0.22 + 0.12 * Math.sin(time * 8)})`;
    for (const e of g.enemies) {
      if (!aim.ready.has(e.id)) continue;
      const [x, y] = toScreen(v, e.x, e.y);
      ctx.beginPath();
      ctx.arc(x, y, (e.radius + 9) * v.scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 바닥 경고는 적 아래, 탄은 적 위에 (drawHazards가 둘 다 그리므로 경고 먼저)
  drawHazards(ctx, g, v, time);
  // 적 (보스는 맨 위에)
  // 화면 밖 적은 건너뛴다 (폰 세로 화면은 경기장의 1/3쯤만 보인다). 잔상·가시·표식이 닿는 여유를 두어 보이는 것은 그대로
  const onScreen = (e: Enemy): boolean => {
    const [x, y] = toScreen(v, e.x, e.y);
    const m = (e.radius * 2.2 + 40 + Math.hypot(e.vx, e.vy) * 0.06) * v.scale;
    return x > -m && y > -m && x < cw + m && y < ch + m;
  };
  for (const e of g.enemies) if (e.rank === "normal" && onScreen(e)) drawEnemy(ctx, v, e, time);
  for (const e of g.enemies) if (e.rank !== "normal") drawEnemy(ctx, v, e, time);

  // 회오리 칼날: 지나간 자리에 바람 꼬리. 색 공 규칙에서 이번 바퀴 cap을 다 쓰면 무뎌져 흐려진다
  const p = g.player;
  for (const w of g.weapons) {
    if (w.def.behavior !== "orbit") continue;
    const radius = (w.level.params.radius ?? 80) * p.stats.area;
    const blades = w.level.params.blades ?? 1;
    const dull = g.ballMode && (w.bite ?? 0) >= (w.level.params.cap ?? 3);
    const [cx, cy] = toScreen(v, p.x, p.y);
    for (let k = 0; k < blades; k++) {
      const a = (w.angle ?? 0) + (k / blades) * Math.PI * 2;
      ctx.strokeStyle = dull ? "rgba(200,240,255,0.12)" : "rgba(200,240,255,0.35)";
      ctx.lineWidth = BLADE_RADIUS * p.stats.area * v.scale * 0.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, radius * v.scale, a - 0.9, a);
      ctx.stroke();
      const [x, y] = toScreen(v, p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius);
      ctx.fillStyle = dull ? "rgba(200,240,255,0.3)" : "rgba(200,240,255,0.9)";
      ctx.beginPath();
      ctx.arc(x, y, BLADE_RADIUS * p.stats.area * v.scale * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 날아가는 색 공
  for (const b of g.balls) {
    const [x, y] = toScreen(v, b.x, b.y);
    // 꼬리: 빠를수록 길다 (굴러가며 느려지는 게 보이게)
    ctx.strokeStyle = PALETTE[b.color];
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = RULES.ball.radius * 1.4 * v.scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - b.vx * 0.045 * v.scale, y - b.vy * 0.045 * v.scale);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE[b.color];
    ctx.beginPath();
    ctx.arc(x, y, RULES.ball.radius * v.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 * v.scale;
    ctx.stroke();
    glyph(ctx, b.color, x, y, RULES.ball.radius * v.scale);
  }

  // 플레이어
  const [px, py] = toScreen(v, p.x, p.y);
  const pr = p.radius * v.scale;
  // 조준선과 손에 든 공
  if (aim && g.ball) {
    const ang = Math.atan2(aim.y - p.y, aim.x - p.x);
    if (aim.line) {
      // 당구 조준선: 쿠션(울타리·바위·반사벽)에서 꺾이는 길을 미리 보여 준다. 꺾인 곳마다 작은 점
      const pts = predictBallPath(g, ang, aim.cushions);
      ctx.strokeStyle = g.ball.cd > 0 ? "rgba(244,239,225,0.18)" : "rgba(244,239,225,0.5)";
      ctx.setLineDash([6 * v.scale, 8 * v.scale]);
      ctx.lineWidth = 2 * v.scale;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (const q of pts.slice(1)) {
        const [qx, qy] = toScreen(v, q.x, q.y);
        ctx.lineTo(qx, qy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#9fe3ff";
      for (const q of pts.slice(1, -1)) {
        const [qx, qy] = toScreen(v, q.x, q.y);
        ctx.beginPath();
        ctx.arc(qx, qy, 4 * v.scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const hx = px + Math.cos(ang) * (pr + 12 * v.scale);
    const hy = py + Math.sin(ang) * (pr + 12 * v.scale);
    const hr = RULES.ball.radius * v.scale * (g.ball.cd > 0 ? 0.7 : 1);
    ctx.fillStyle = PALETTE[g.ball.current];
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 * v.scale;
    ctx.stroke();
    glyph(ctx, g.ball.current, hx, hy, hr);
  }
  if (!(p.iframes > 0 && Math.floor(time * 20) % 2 === 0)) {
    ctx.fillStyle = "#f4efe1";
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5 * v.scale;
    ctx.stroke();
    // 바라보는 방향
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(px + p.faceX * pr * 0.55, py + p.faceY * pr * 0.55, pr * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  // 돌풍: 바람 방향 줄무늬
  if (g.wind.t > 0) {
    ctx.strokeStyle = "rgba(230,240,235,0.25)";
    ctx.lineWidth = 2 * v.scale;
    const len = 60 * v.scale;
    for (let k = 0; k < 40; k++) {
      const sx = ((k * 211 + time * 600 * g.wind.dx) % cw + cw) % cw;
      const sy = ((k * 137 + time * 600 * g.wind.dy) % ch + ch) % ch;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + g.wind.dx * len, sy + g.wind.dy * len);
      ctx.stroke();
    }
  }
  // 안개 (맵 기믹, 화면 전용): 플레이어 둘레만 밝다
  if (g.stage?.fog) {
    const fr = RULES.terrain.fogRadius * v.scale;
    const grad = ctx.createRadialGradient(px, py, fr * 0.55, px, py, fr);
    grad.addColorStop(0, "rgba(8,17,14,0)");
    grad.addColorStop(1, "rgba(8,17,14,0.88)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);
  }

  // 화면 밖 엘리트·보스: 가장자리에 방향 표시 (그로기면 노랗게 깜빡임: 지금 때릴 틈)
  for (const e of g.enemies) {
    if (e.dead || e.rank === "normal") continue;
    const [ex, ey] = toScreen(v, e.x, e.y);
    const m = e.radius * v.scale * 0.5;
    if (ex > -m && ex < cw + m && ey > -m && ey < ch + m) continue;
    const pad = 26 * v.scale;
    const dx = ex - cw / 2;
    const dy = ey - ch / 2;
    const k = Math.min((cw / 2 - pad) / Math.max(1e-6, Math.abs(dx)), (ch / 2 - pad) / Math.max(1e-6, Math.abs(dy)));
    const ax = cw / 2 + dx * k;
    const ay = ch / 2 + dy * k;
    const a = Math.atan2(dy, dx);
    const groggy = (e.boss?.groggy ?? 0) > 0;
    const sz = (e.rank === "boss" ? 16 : 12) * v.scale;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(a);
    ctx.fillStyle = groggy ? `rgba(255,236,120,${0.6 + 0.4 * Math.sin(time * 14)})` : e.rank === "boss" ? "#ffcf5a" : "#f1e3b5";
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, 2 * v.scale);
    ctx.beginPath();
    ctx.moveTo(sz, 0);
    ctx.lineTo(-sz * 0.7, sz * 0.75);
    ctx.lineTo(-sz * 0.7, -sz * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 효과
  for (const f of fx) {
    const [x, y] = toScreen(v, f.x, f.y);
    const k = f.t / f.life;
    if (f.kind === "ring") {
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 4 * v.scale * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(x, y, (f.radius ?? 60) * v.scale * (0.3 + 0.7 * k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (f.kind === "line") {
      const [x2, y2] = toScreen(v, f.x2 ?? f.x, f.y2 ?? f.y);
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = (f.radius ?? 3) * v.scale;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (f.kind === "spark") {
      const sx = x + (f.vx ?? 0) * f.t * v.scale;
      const sy = y + (f.vy ?? 0) * f.t * v.scale;
      ctx.fillStyle = f.color;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.arc(sx, sy, (f.radius ?? 4) * v.scale * (1 - k * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (f.text) {
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      ctx.font = `${Math.round(22 * v.scale)}px Jua, "Gowun Dodum", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(f.text, x, y - 30 * v.scale * k);
      ctx.globalAlpha = 1;
    }
  }
}
