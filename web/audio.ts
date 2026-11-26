/**
 * 효과음 (트리 4.2 손맛). 파일 없이 WebAudio로 합성한다.
 * 브라우저는 사용자가 한 번 누른 뒤에야 소리를 낼 수 있으므로, 첫 클릭·키 입력 때 unlock()을 부른다.
 * 콤보 음정: 연쇄 단계마다 5음계로 한 칸씩 올라간다 (도 레 미 솔 라 …).
 */

const PENTA = [0, 2, 4, 7, 9];
const MUTE_KEY = "pop-shepherd-mute";

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    // 기억하지 못해도 지금은 적용된다
  }
  if (master) master.gain.value = m ? 0 : 0.5;
}

export function unlock(): void {
  if (ac) {
    if (ac.state === "suspended") void ac.resume();
    return;
  }
  try {
    ac = new AudioContext();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ac.destination);
  } catch {
    ac = null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
  if (!ac || !master || muted) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const gn = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number): void {
  if (!ac || !master || muted) return;
  const t = ac.currentTime;
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  const gn = ac.createGain();
  gn.gain.value = vol;
  src.connect(f).connect(gn).connect(master);
  src.start(t);
}

/** 연쇄 단계 step의 음 (Hz). 단계가 오를수록 5음계로 한 칸씩 */
export function comboPitch(step: number): number {
  const octave = Math.floor(step / PENTA.length);
  const semis = (PENTA[step % PENTA.length] as number) + 12 * octave;
  return 523.25 * Math.pow(2, semis / 12);
}

let lastPop = 0;
export const sfx = {
  pop(size: number, chainDepth: number): void {
    // 한 프레임에 팝이 몰리면 몇 개만 소리 낸다
    const now = performance.now();
    if (now - lastPop < 25) return;
    lastPop = now;
    const f = comboPitch(chainDepth);
    tone(f, 0.12 + size * 0.015, "triangle", 0.35);
    tone(f * 1.5, 0.08, "sine", 0.15, undefined, 0.03);
  },
  throwBall(): void {
    noise(0.07, 0.25, 1800);
  },
  stick(): void {
    tone(330, 0.08, "sine", 0.2);
  },
  hit(): void {
    tone(140, 0.18, "square", 0.25, 60);
  },
  whistle(): void {
    tone(1800, 0.12, "sine", 0.2, 2400);
    tone(2400, 0.16, "sine", 0.18, 2000, 0.12);
  },
  levelUp(): void {
    [0, 2, 4].forEach((s, i) => tone(comboPitch(s + 5), 0.18, "triangle", 0.25, undefined, i * 0.07));
  },
  /** 스테이지 끝 카운트다운: 짧은 틱 (마지막 1초는 한 음 높게) */
  tick(last = false): void {
    tone(last ? 880 : 660, 0.08, "sine", 0.22);
  },
  /** 보스 공격 예고: 낮게 두 번 */
  warn(): void {
    tone(220, 0.12, "square", 0.12, 200);
    tone(220, 0.12, "square", 0.12, 200, 0.16);
  },
  boss(): void {
    tone(98, 0.9, "sawtooth", 0.18, 73);
  },
  chest(): void {
    [4, 7, 9, 12].forEach((s, i) => tone(comboPitch(s), 0.2, "sine", 0.2, undefined, i * 0.06));
  },
  clear(): void {
    [0, 2, 4, 7, 9, 10].forEach((s, i) => tone(comboPitch(s), 0.22, "triangle", 0.22, undefined, i * 0.08));
  },
};
