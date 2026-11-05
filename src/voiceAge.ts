// 說話者辨識・第一步：聽聲音的高低，猜是大人還是小朋友。
// 小朋友的聲音（基本頻率）大約 250–400Hz（開心的成年女性也可能到 250 左右，所以門檻抓 265），成年女性約 165–255Hz，成年男性約 85–180Hz。
// 中間重疊的範圍不硬猜（回傳 null）。只在裝置上即時計算，不錄音、不存聲音，只留下幾個數字在記憶體裡。

import { trackPitch } from './voicefx';

export type AgeGuess = 'child' | 'adult' | null;

const KEY = 'fairypocket.voiceage.v1';

/** 設定：要不要分辨大人小孩（預設開） */
export function voiceAgeOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}
export function setVoiceAgeOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 存不了也沒關係 */
  }
}

/** 至少要有這麼多「有音高」的片段（每段 10ms）才判斷 */
const MIN_VOICED = 25;
export const CHILD_HZ = 265;
export const ADULT_HZ = 205;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 用一段話裡每 10ms 的音高猜年紀；回傳中位數音高與判斷 */
export function classifyPitch(f0: ArrayLike<number>): { hz: number; guess: AgeGuess } {
  const voiced: number[] = [];
  for (let i = 0; i < f0.length; i++) if (f0[i] > 0) voiced.push(f0[i]);
  if (voiced.length < MIN_VOICED) return { hz: 0, guess: null };
  const hz = median(voiced);
  return { hz, guess: hz >= CHILD_HZ ? 'child' : hz <= ADULT_HZ ? 'adult' : null };
}

/** 一整段聲音（例如錄到的一句話） → 判斷 */
export function classifySamples(d: Float32Array, rate: number): { hz: number; guess: AgeGuess } {
  return classifyPitch(trackPitch(d, rate));
}

/**
 * 跟語音辨識一起開著，持續算最近幾秒的音高（語音辨識本身拿不到聲音，所以另外聽）。
 * 每 0.4 秒算一次，記住最近 5 秒內「有音高」的值。
 */
export class VoiceAge {
  private stream: MediaStream | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunk: Float32Array[] = [];
  private chunkLen = 0;
  private f0: { t: number; hz: number }[] = [];
  /** 最近幾秒「有人在說話」的聲音片段（認人用；只在記憶體裡，6 秒後就丟掉） */
  private voiced: { t: number; d: Float32Array }[] = [];
  private rate = 48000;
  /** 最近一次算出來的音高（測試畫面用） */
  lastHz = 0;
  /** 悅靈自己說話時先不算（悅靈的聲音很高，會被當成小朋友） */
  pausedUntil = 0;

  get on(): boolean {
    return !!this.stream;
  }

  async start(ctx: AudioContext): Promise<boolean> {
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return false;
    }
    const rate = ctx.sampleRate;
    this.rate = rate;
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      if (performance.now() < this.pausedUntil) {
        this.chunk = [];
        this.chunkLen = 0;
        this.voiced = [];
        return;
      }
      const d = e.inputBuffer.getChannelData(0);
      this.chunk.push(d.slice());
      this.chunkLen += d.length;
      if (this.chunkLen < rate * 0.4) return;
      const all = new Float32Array(this.chunkLen);
      let o = 0;
      for (const c of this.chunk) {
        all.set(c, o);
        o += c.length;
      }
      this.chunk = [];
      this.chunkLen = 0;
      // 太小聲（沒人說話）就不算
      let sum = 0;
      for (let i = 0; i < all.length; i++) sum += all[i] * all[i];
      if (Math.sqrt(sum / all.length) < 0.01) return;
      const now = performance.now();
      this.voiced.push({ t: now, d: all });
      while (this.voiced.length && now - this.voiced[0].t > 6000) this.voiced.shift();
      const track = trackPitch(all, rate);
      for (const hz of track) if (hz > 0) this.f0.push({ t: now, hz });
      while (this.f0.length && now - this.f0[0].t > 5000) this.f0.shift();
      const c = classifyPitch(track);
      if (c.hz) this.lastHz = c.hz;
    };
    this.src.connect(this.node);
    this.node.connect(ctx.destination);
    return true;
  }

  /** 最近幾秒說話的人，像大人還是小朋友 */
  guess(windowMs = 5000): { hz: number; guess: AgeGuess } {
    const now = performance.now();
    return classifyPitch(this.f0.filter((p) => now - p.t <= windowMs).map((p) => p.hz));
  }

  /** 最近幾秒有人說話的聲音（接在一起），拿來認是誰；拿過就清掉，同一段話不會用兩次 */
  takeRecent(windowMs = 6000): { data: Float32Array; rate: number } | null {
    const now = performance.now();
    const parts = this.voiced.filter((p) => now - p.t <= windowMs);
    this.voiced = [];
    if (!parts.length) return null;
    const data = new Float32Array(parts.reduce((n, p) => n + p.d.length, 0));
    let o = 0;
    for (const p of parts) {
      data.set(p.d, o);
      o += p.d.length;
    }
    return { data, rate: this.rate };
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.src?.disconnect();
    this.node?.disconnect();
    this.stream = null;
    this.src = null;
    this.node = null;
    this.chunk = [];
    this.chunkLen = 0;
    this.f0 = [];
    this.voiced = [];
  }
}
