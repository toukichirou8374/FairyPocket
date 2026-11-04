// 變音器：把錄下的聲音變成精靈、小孩或少女的聲音（全部在這台裝置上處理）。
//
// 做法：
// 1. 估計每一小段的音高（自相關法），自動算出要把你的聲音提高多少，
//    這樣不管是爸爸或媽媽錄的，都會變成差不多高的聲音。
// 2. 用 PSOLA（逐個聲波週期剪下、重新排列疊加）改變音高，同時把聲音稍微拉長；
// 3. 再整段加快播放，讓「音色」（共振峰）也一起變高、長度回到原本的長度。
//    只提高音高聽起來會像「大人捏著嗓子」；音色也一起變高，才會像小孩、少女的聲音。
// 精靈再多加一點閃亮的回音與高八度的泛音。

export type VoiceStyle = 'fairy' | 'child' | 'girl';
export const VOICE_STYLES: VoiceStyle[] = ['fairy', 'child', 'girl'];

interface Preset {
  /** 目標平均音高（Hz） */
  target: number;
  /** 音色（共振峰）提高的倍率 */
  formant: number;
}

const PRESETS: Record<VoiceStyle, Preset> = {
  girl: { target: 250, formant: 1.17 },
  child: { target: 310, formant: 1.28 },
  fairy: { target: 400, formant: 1.38 },
};

/** 音高範圍（Hz） */
const MIN_F0 = 70;
const MAX_F0 = 500;
/** 分析間隔（秒） */
const HOP = 0.01;

/** 估計每 10ms 的音高（0 = 沒有音高，例如 ㄙ、ㄘ 之類的氣音或靜音） */
export function trackPitch(d: Float32Array, rate: number): Float32Array {
  // 降頻到約 12kHz 再算，快很多
  const step = Math.max(1, Math.floor(rate / 12000));
  const r = rate / step;
  const low = new Float32Array(Math.floor(d.length / step));
  for (let i = 0; i < low.length; i++) {
    let s = 0;
    for (let k = 0; k < step; k++) s += d[i * step + k];
    low[i] = s / step;
  }
  const n = Math.floor(r * 0.03);
  const minLag = Math.floor(r / MAX_F0);
  const maxLag = Math.ceil(r / MIN_F0);
  const frames = Math.floor(d.length / rate / HOP);
  const out = new Float32Array(frames);
  // 整段的音量，用來判斷哪裡是靜音
  let peak = 0;
  for (let i = 0; i < low.length; i++) peak = Math.max(peak, Math.abs(low[i]));
  for (let f = 0; f < frames; f++) {
    const s = Math.floor(f * HOP * r);
    if (s + n + maxLag >= low.length) break;
    let e0 = 0;
    for (let j = 0; j < n; j++) e0 += low[s + j] * low[s + j];
    if (Math.sqrt(e0 / n) < peak * 0.06) continue;
    const corr = new Float32Array(maxLag + 1);
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      let e1 = 0;
      for (let j = 0; j < n; j++) {
        const y = low[s + j + lag];
        c += low[s + j] * y;
        e1 += y * y;
      }
      corr[lag] = c / Math.sqrt(e0 * e1 + 1e-12);
      best = Math.max(best, corr[lag]);
    }
    // 取「最短」而且幾乎跟最好一樣像的週期（避免誤判成低八度、低兩倍的音）
    let bestLag = 0;
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (corr[lag] >= best * 0.9 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
        bestLag = lag;
        break;
      }
    }
    if (best > 0.55 && bestLag > 0) out[f] = r / bestLag;
  }
  // 去掉單獨跳動的值（取前後三格的中位數）
  const sm = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = [out[f - 1] ?? 0, out[f], out[f + 1] ?? 0];
    sm[f] = out[f] ? a.sort((x, y) => x - y)[1] || out[f] : 0;
  }
  return sm;
}

function median(v: Float32Array): number {
  const a = [...v].filter((x) => x > 0).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
}

/**
 * PSOLA：音高乘以 pitch、長度乘以 stretch（音色不變）。
 * 有音高的地方以一個聲波週期為單位剪貼；沒有音高的地方用固定 6ms 的小片段。
 */
function psola(d: Float32Array, rate: number, f0: Float32Array, pitch: number, stretch: number): Float32Array {
  const outLen = Math.floor(d.length * stretch);
  const out = new Float32Array(outLen + rate);
  const norm = new Float32Array(outLen + rate);
  const periodAt = (t: number) => {
    const f = f0[Math.min(f0.length - 1, Math.max(0, Math.floor(t / rate / HOP)))] ?? 0;
    return f > 0 ? rate / f : 0;
  };
  // 在原本的聲音上找每個週期的位置（對齊到波峰，剪起來比較乾淨）
  const marks: number[] = [];
  let t = 0;
  while (t < d.length) {
    const p = periodAt(t);
    const step = p || rate * 0.006;
    if (p) {
      let best = t;
      const end = Math.min(d.length - 1, t + Math.floor(p * 0.5));
      for (let i = Math.max(0, Math.floor(t - p * 0.25)); i < end; i++) if (d[i] > d[best]) best = i;
      t = Math.max(t, best);
    }
    marks.push(Math.floor(t));
    t += step;
  }
  if (!marks.length) return d;
  // 在新的時間軸上，依新的音高放上一個個週期
  let ts = 0;
  let mi = 0;
  while (ts < outLen) {
    const ta = ts / stretch;
    while (mi + 1 < marks.length && Math.abs(marks[mi + 1] - ta) <= Math.abs(marks[mi] - ta)) mi++;
    const m = marks[mi];
    const p = periodAt(m);
    const half = Math.floor(p || rate * 0.006);
    for (let k = -half; k < half; k++) {
      const src = m + k;
      const dst = Math.floor(ts) + k;
      if (src < 0 || src >= d.length || dst < 0) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * k) / half);
      out[dst] += d[src] * w;
      norm[dst] += w;
    }
    ts += p ? p / pitch : half;
  }
  const res = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) res[i] = norm[i] > 0.1 ? out[i] / Math.max(1, norm[i]) : out[i];
  return res;
}

/** 線性內插重新取樣：factor > 1 = 加快（音高與音色一起變高、變短） */
function resample(d: Float32Array, factor: number): Float32Array {
  const len = Math.floor(d.length / factor);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = i * factor;
    const a = Math.floor(x);
    const f = x - a;
    out[i] = (d[a] ?? 0) * (1 - f) + (d[a + 1] ?? 0) * f;
  }
  return out;
}

/** 精靈：加上輕輕的顫音與閃亮的短回音 */
function sparkle(d: Float32Array, rate: number): Float32Array {
  const echo = Math.floor(rate * 0.085);
  const out = new Float32Array(d.length + echo * 4);
  // 顫音：音量以每秒 6 次輕輕起伏
  for (let i = 0; i < d.length; i++) out[i] = d[i] * (0.88 + 0.12 * Math.sin((2 * Math.PI * 6 * i) / rate));
  // 回音：一次比一次小聲
  for (let k = 1; k <= 3; k++) {
    const g = 0.28 / k;
    for (let i = 0; i < d.length; i++) out[i + echo * k] += out[i] * g;
  }
  return out;
}

/** 調整音量：最大值調到 0.9，避免破音或太小聲 */
function normalize(d: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak < 1e-4) return d;
  const g = Math.min(4, 0.9 / peak);
  for (let i = 0; i < d.length; i++) d[i] *= g;
  return d;
}

/** 把一段錄音變聲 */
export function transform(d: Float32Array, rate: number, style: VoiceStyle): Float32Array<ArrayBuffer> {
  const pre = PRESETS[style];
  const f0 = trackPitch(d, rate);
  const mid = median(f0) || 140;
  // 總共要提高的音高：讓平均音高到目標（最少提高 1.15 倍，最多 3 倍）
  const total = Math.min(3, Math.max(1.15, pre.target / mid));
  const formant = Math.min(pre.formant, total);
  // PSOLA 負責「音高 ÷ 音色」那一部分，並先拉長；加快播放時音高、音色再一起乘上 formant
  let out = psola(d, rate, f0, total / formant, formant);
  out = resample(out, formant);
  if (style === 'fairy') out = sparkle(out, rate);
  return normalize(out) as Float32Array<ArrayBuffer>;
}
