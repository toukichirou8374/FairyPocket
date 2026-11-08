// 說話者辨識・第二步（模糊認人）：記住家人聲音的「音色＋高低」，聽到時大概猜是誰。
// 刻意不做得很準（只是讓悅靈更像認得你，不能拿來當安全鎖）；第一次聽到的聲音，悅靈會在對話裡問名字。
// 只存聲音的特徵數字（無法還原成聲音），只存在這台裝置，不放進備份、不上傳。

import { trackPitch } from './voicefx';

const KEY = 'fairypocket.voices.v1';
const ON_KEY = 'fairypocket.voiceid.v1';

/** 設定：要不要認人（預設開） */
export function voiceIdOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setVoiceIdOn(on: boolean): void {
  try {
    localStorage.setItem(ON_KEY, on ? '1' : '0');
  } catch {
    /* 存不了也沒關係 */
  }
}
export const MAX_PEOPLE = 6;
/** 一段話裡至少要有這麼多「有聲音」的片段（每段 10ms），太短不判斷 */
const MIN_FRAMES = 60;

export interface Person {
  id: string;
  name: string;
  /** 平均的聲音特徵 */
  feat: number[];
  /** 累積了幾段話 */
  n: number;
  createdAt: number;
  lastHeard: number;
  /** 最近幾段話的聲音特徵（只存在這台裝置；比只用平均準，例如同一個人大聲、小聲、近、遠） */
  samples?: number[][];
}

/** 每個人最多記幾段話的特徵 */
export const MAX_SAMPLES = 24;

/** 跟這個人有多不像：平均聲音，和最像的 3 段話的平均，取比較像的那個 */
export function personDistance(p: Person, feat: number[]): number {
  const centroid = voiceDistance(p.feat, feat);
  const s = (p.samples ?? []).map((x) => voiceDistance(x, feat)).sort((a, b) => a - b);
  if (s.length < 3) return centroid;
  const near = (s[0] + s[1] + s[2]) / 3;
  return Math.min(centroid, near);
}

// ---------- 聲音特徵：MFCC（音色）平均與變化 + 音高 ----------
const SR = 16000;
const FFT = 512;
const HOP = 160; // 10ms
const WIN = 400; // 25ms
const MELS = 26;
const CEPS = 12;

function resample(d: Float32Array, rate: number): Float32Array {
  if (rate === SR) return d;
  const k = rate / SR;
  const out = new Float32Array(Math.floor(d.length / k));
  for (let i = 0; i < out.length; i++) {
    const p = i * k;
    const j = Math.floor(p);
    const t = p - j;
    out[i] = d[j] * (1 - t) + (d[j + 1] ?? d[j]) * t;
  }
  return out;
}

function fftMag(re: Float32Array): Float32Array {
  const n = re.length;
  const im = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k);
        const s = Math.sin(a * k);
        const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s;
        const xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
  const mag = new Float32Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) mag[i] = re[i] * re[i] + im[i] * im[i];
  return mag;
}

let melBank: Float32Array[] | null = null;
function mel(): Float32Array[] {
  if (melBank) return melBank;
  const toMel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const toHz = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const lo = toMel(80);
  const hi = toMel(7600);
  const pts = Array.from({ length: MELS + 2 }, (_, i) => Math.floor(((FFT + 1) * toHz(lo + ((hi - lo) * i) / (MELS + 1))) / SR));
  melBank = [];
  for (let m = 1; m <= MELS; m++) {
    const f = new Float32Array(FFT / 2 + 1);
    for (let k = pts[m - 1]; k < pts[m]; k++) f[k] = (k - pts[m - 1]) / Math.max(1, pts[m] - pts[m - 1]);
    for (let k = pts[m]; k < pts[m + 1]; k++) f[k] = (pts[m + 1] - k) / Math.max(1, pts[m + 1] - pts[m]);
    melBank.push(f);
  }
  return melBank;
}

/**
 * 一段話 → 聲音特徵（25 個數字）：12 個 MFCC 的平均、12 個的變化量、音高（對數）。
 * 有聲音的片段不夠（太短、太小聲）回傳 null。
 */
export function voiceFeatures(d: Float32Array, rate: number): number[] | null {
  const x = resample(d, rate);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak < 0.02) return null;
  const bank = mel();
  const frames: number[][] = [];
  const buf = new Float32Array(FFT);
  for (let s = 0; s + WIN <= x.length; s += HOP) {
    let e = 0;
    for (let i = 0; i < WIN; i++) e += x[s + i] * x[s + i];
    // 只用有聲音的片段（安靜的地方不算）
    if (Math.sqrt(e / WIN) < peak * 0.08) continue;
    buf.fill(0);
    for (let i = 0; i < WIN; i++) buf[i] = (x[s + i] - 0.97 * (x[s + i - 1] ?? 0)) * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
    const mag = fftMag(buf);
    const logMel = bank.map((f) => {
      let v = 0;
      for (let k = 0; k < f.length; k++) v += f[k] * mag[k];
      return Math.log(v + 1e-10);
    });
    const c: number[] = [];
    for (let k = 1; k <= CEPS; k++) {
      let v = 0;
      for (let m = 0; m < MELS; m++) v += logMel[m] * Math.cos((Math.PI * k * (m + 0.5)) / MELS);
      c.push(v);
    }
    frames.push(c);
  }
  if (frames.length < MIN_FRAMES) return null;
  const mean = Array.from({ length: CEPS }, (_, k) => frames.reduce((s, f) => s + f[k], 0) / frames.length);
  const sd = Array.from({ length: CEPS }, (_, k) => Math.sqrt(frames.reduce((s, f) => s + (f[k] - mean[k]) ** 2, 0) / frames.length));
  const f0 = [...trackPitch(d, rate)].filter((v) => v > 0).sort((a, b) => a - b);
  const hz = f0.length ? f0[Math.floor(f0.length / 2)] : 150;
  return [...mean, ...sd, Math.log2(hz / 150) * 8];
}

/** 兩個聲音特徵有多像（0 = 一樣，越大越不像）：各部分分開算，避免某一種數字太大壓過其他 */
export function voiceDistance(a: number[], b: number[]): number {
  let dm = 0;
  let ds = 0;
  for (let k = 0; k < CEPS; k++) {
    dm += ((a[k] - b[k]) / (1 + k * 0.15)) ** 2;
    ds += (a[CEPS + k] - b[CEPS + k]) ** 2;
  }
  const dp = (a[2 * CEPS] - b[2 * CEPS]) ** 2;
  return Math.sqrt(dm / CEPS) + 0.5 * Math.sqrt(ds / CEPS) + 0.6 * Math.sqrt(dp);
}

/** 「是這個人」的距離上限；超過就當成還不認識的聲音（實測：同一人約 3.6–5.3、不同人約 4.4–14；刻意抓寬一點＝模糊認人） */
export const SAME_PERSON = 5.6;

/** 猜是誰：最像的人夠像、而且明顯比第二像的人更像，才算認得 */
export function identify(people: readonly Person[], feat: number[]): { person: Person | null; dist: number } {
  const scored = people.map((p) => ({ p, d: personDistance(p, feat) })).sort((x, y) => x.d - y.d);
  const best = scored[0];
  if (!best || best.d > SAME_PERSON) return { person: null, dist: best?.d ?? Infinity };
  const second = scored[1];
  if (second && second.d - best.d < 0.35) return { person: null, dist: best.d };
  return { person: best.p, dist: best.d };
}

/** 認得之後，慢慢更新這個人的聲音（小朋友的聲音會長大） */
export function learn(p: Person, feat: number[], now = Date.now()): void {
  const w = 1 / Math.min(p.n + 1, 12);
  p.feat = p.feat.map((v, i) => v * (1 - w) + feat[i] * w);
  p.n++;
  p.lastHeard = now;
  p.samples = [...(p.samples ?? []), [...feat]].slice(-MAX_SAMPLES);
}

// ---------- 存取 ----------
export function loadPeople(): Person[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Person[];
    return Array.isArray(v)
      ? v
          .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.feat) && p.feat.length === 2 * CEPS + 1)
          .map((p) => ({ ...p, samples: Array.isArray(p.samples) ? p.samples.filter((s) => Array.isArray(s) && s.length === 2 * CEPS + 1).slice(-MAX_SAMPLES) : [] }))
      : [];
  } catch {
    return [];
  }
}

export function savePeople(people: Person[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(people.slice(0, MAX_PEOPLE)));
  } catch {
    /* 存不了也沒關係 */
  }
}

export function addPerson(people: Person[], name: string, feat: number[], now = Date.now()): Person {
  const same = people.find((p) => p.name === name);
  if (same) {
    learn(same, feat, now);
    return same;
  }
  const p: Person = { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, feat: [...feat], n: 1, createdAt: now, lastHeard: now, samples: [[...feat]] };
  people.push(p);
  // 太多人：忘記最久沒聽到的
  if (people.length > MAX_PEOPLE) people.sort((a, b) => b.lastHeard - a.lastHeard).splice(MAX_PEOPLE);
  return p;
}

// ---------- 從自我介紹裡找名字 ----------
const NAME_STOP = /^(你|妳|我|他|她|誰|什麼|不要|不用|不知道|沒有|好|好啊|可以|悅靈|アレイ|だれ|なに|no|nope|nobody|you|me|what|who|allay)$/i;

/** 「我是小明」「我叫小明」「叫我小明」「小明」「I'm Ken」「わたしはケンです」 → 名字（找不到回傳 null） */
export function nameFrom(text: string): string | null {
  let t = text.trim().replace(/[。！!？?、，,.~～…]+$/g, '').trim();
  const pats = [
    /^(?:我是|我叫做|我叫|我的名字是|我的名字叫|叫我|你可以叫我|我是你的)\s*(.+)$/,
    /^(?:わたしは|わたしの名前は|私は|私の名前は|ぼくは|僕は|おれは|俺は)\s*(.+?)(?:です|だよ|だ|っていいます|と言います)?$/,
    /^(.+?)(?:です|だよ|っていいます|と申します)$/,
    /^(?:i'?m|i am|my name is|my name's|call me|it'?s|this is)\s+(.+)$/i,
  ];
  for (const p of pats) {
    const m = p.exec(t);
    if (m) {
      t = m[1].trim();
      break;
    }
  }
  t = t.replace(/^(?:the\s+)/i, '').replace(/(啦|喔|哦|呀|啊|耶|唷|ね|よ)$/, '').trim();
  if (!t || NAME_STOP.test(t)) return null;
  // 名字不會太長：中日文 1–6 個字，英文 1–3 個字
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー・]{1,6}$/u.test(t)) return t;
  if (/^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}$/.test(t) && t.length <= 20) return t.replace(/\b\w/g, (c) => c.toUpperCase());
  return null;
}

/**
 * 只認「明確的自我介紹」裡的名字（生命模式用）：一定要有「我是／我叫／叫我／わたしは／my name is…」這類開頭，
 * 而且名字不能像一句話。nameFrom 是在「問了名字之後」用的，單獨一句「好累」「嗨」也會被當成名字。
 */
const INTRO = /^(?:我是|我叫做|我叫|我的名字是|我的名字叫|叫我|你可以叫我|わたしは|わたしの名前は|私は|私の名前は|ぼくは|僕は|おれは|俺は|my name is|my name's|call me|i'?m|i am)\s*/i;
const NOT_NAME = /[說想要很累了的嗎呢吧啊不沒會]|覺得|今天|明天|昨天|現在|[、，,。！？!?]/;
export function introName(text: string): string | null {
  const t = text.trim();
  if (!INTRO.test(t)) return null;
  const n = nameFrom(t);
  if (!n) return null;
  const rest = t.replace(INTRO, '').replace(/(?:です|だよ|だ|っていいます|と言います|喔|哦|啦|呀|啊|耶|唷|ね|よ)?[。！!.~～…]*$/, '').trim();
  // 「我是說今天好累」這種：剩下的部分像一句話就不算
  if (NOT_NAME.test(rest.replace(/喔|哦|啦|呀|耶|唷/g, ''))) return null;
  if (/^[\p{Script=Han}]{5,}$/u.test(n)) return null;
  return n;
}

/** 明顯不是名字的（v0.57.1 的錯誤可能把「嗨」「好累」記成名字）：啟動時清掉 */
const JUNK_NAMES = new Set(['嗨', '嗯', '喔', '哦', '好', '對', '哈囉', '你好', '謝謝', '晚安', '早安', 'はい', 'うん', 'ええ', 'Hi', 'Hello', 'Ok', 'Okay', 'Yes', 'No']);
export function junkName(name: string): boolean {
  const n = name.trim();
  return !n || JUNK_NAMES.has(n) || NOT_NAME.test(n);
}
