// 感應的靈敏度（麥克風聽說話、前鏡頭看揮手），設定頁可以調整，只存在這台裝置。
// 1 = 標準；數字越大越容易觸發（安靜的地方可以調高），越小越不容易誤判（吵的地方調低）。

const KEY = 'fairypocket.sense.v1';

export interface Sense {
  mic: number;
  wave: number;
}

export const SENSE_MIN = 0.5;
export const SENSE_MAX = 1.5;

function load(): Sense {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Sense> | null;
    const ok = (v: unknown) => (typeof v === 'number' && v >= SENSE_MIN && v <= SENSE_MAX ? v : 1);
    return { mic: ok(s?.mic), wave: ok(s?.wave) };
  } catch {
    return { mic: 1, wave: 1 };
  }
}

/** 目前的靈敏度（大家共用同一份，改了馬上生效） */
export const sense: Sense = typeof localStorage === 'undefined' ? { mic: 1, wave: 1 } : load();

export function setSense(k: keyof Sense, v: number): void {
  sense[k] = Math.min(SENSE_MAX, Math.max(SENSE_MIN, v));
  try {
    localStorage.setItem(KEY, JSON.stringify(sense));
  } catch {
    /* 存不了也沒關係 */
  }
}

/**
 * 揮手判斷：記錄最近 2 秒「動作的左右位置」，左右來回夠多次、幅度夠大才算揮手。
 * 整個畫面一起變（開關燈、鏡頭自動調亮度、手機晃動）不算。
 */
export class WaveDetector {
  private xs: { t: number; x: number }[] = [];
  private lastWave = -Infinity;

  /**
   * 每次偵測到動作時呼叫；回傳這次是不是揮手。
   * x：動作位置（-1 左 ~ 1 右）；area：在動的畫面比例（0–1）；sens：靈敏度
   */
  push(t: number, x: number, area: number, sens = sense.wave): boolean {
    // 整個畫面都在變：燈光、晃動，不是揮手
    if (area > 0.42) {
      this.xs = [];
      return false;
    }
    this.xs.push({ t, x });
    this.xs = this.xs.filter((p) => t - p.t < 2000);
    if (t - this.lastWave < 2500 || this.xs.length < 6) return false;
    const needTurns = sens >= 1.25 ? 2 : sens >= 0.75 ? 3 : 4;
    const minSpan = 0.32 - (sens - 1) * 0.16; // 標準 0.32（畫面寬度的 16%）
    const step = 0.05;
    let turns = 0;
    let dir = 0;
    // 每一段往同一個方向移動的距離也要夠（避免抖動被當成來回）
    let run = 0;
    const runs: number[] = [];
    for (let i = 1; i < this.xs.length; i++) {
      const d = this.xs[i].x - this.xs[i - 1].x;
      if (Math.abs(d) < step) continue;
      const s = Math.sign(d);
      if (dir && s !== dir) {
        runs.push(run);
        run = 0;
        turns++;
      }
      run += Math.abs(d);
      dir = s;
    }
    runs.push(run);
    const xs = this.xs.map((p) => p.x);
    const span = Math.max(...xs) - Math.min(...xs);
    const bigRuns = runs.filter((r) => r >= minSpan * 0.5).length;
    if (turns >= needTurns && span >= minSpan && bigRuns >= needTurns) {
      this.lastWave = t;
      this.xs = [];
      return true;
    }
    return false;
  }
}

/**
 * 說話偵測的門檻：會跟著環境的吵雜程度自動調整。
 * 安靜時用基本門檻；有背景聲（音樂、冷氣、電視）時，門檻跟著墊高。
 */
export class NoiseGate {
  /** 環境聲音的大小（0–1） */
  floor = 0.02;
  private settled = 0;

  /** 基本門檻（音量 0–1） */
  static readonly BASE = 0.12;

  threshold(sens = sense.mic): number {
    return Math.max(NoiseGate.BASE / sens, this.floor * 2.4 + 0.04 / sens);
  }

  /** 沒在說話時，用目前音量更新環境聲音；dt 是這段聲音的秒數 */
  update(level: number, dt: number, talking: boolean): void {
    if (talking) return;
    // 剛開始的 0.8 秒快速學習環境聲音；之後慢慢跟上（變小較快、變大較慢，避免把說話學進去）
    this.settled += dt;
    const k = this.settled < 0.8 ? 0.35 : level < this.floor ? 0.08 : 0.012;
    this.floor += (level - this.floor) * k;
  }

  /** 剛開始的校正時間內不判斷說話 */
  get calibrating(): boolean {
    return this.settled < 0.8;
  }
}

/** 比對時，把聽到的幾個可能結果都試試看 */
export function anyHeard(alts: readonly string[], test: (text: string) => boolean): string | null {
  for (const a of alts) if (a.trim() && test(a)) return a;
  return null;
}
