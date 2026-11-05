// 麥克風：選起麥克風格後悅靈會一直聽，自己判斷你什麼時候說完，然後回應你。
// 回應用玩家在設定頁錄的話（每種語言 5 句，隨機挑一句，變聲成精靈、小孩或少女的聲音）；
// 沒錄的話用原本的悅靈叫聲＋紫水晶鈴聲。聽到的聲音只拿來判斷說話的開始與結束，不會存起來。
// 設定頁錄的回應只存在這台裝置（IndexedDB）。

import type { Lang } from './i18n';
import { transform, VOICE_STYLES, type VoiceStyle } from './voicefx';
import { NoiseGate, sense } from './sense';

/** 安靜多久算說完（秒） */
const END_SILENCE = 0.7;
/** 最短、最長的一段話（秒） */
const MIN_SPEECH = 0.35;
const MAX_SPEECH = 6;

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

function setSession(type: string): void {
  const s = (navigator as AudioSessionNav).audioSession;
  if (s) s.type = type;
}

export interface ListenEvents {
  /** 開始說話 */
  start(): void;
  /** 說完了：這段話的聲音資料 */
  end(samples: Float32Array, rate: number): void;
}

/** 持續聽麥克風，用音量判斷說話的開始與結束 */
export class Listener {
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private speech: Float32Array[] = [];
  private speechLen = 0;
  private quiet = 0;
  private loud = 0;
  private talking = false;
  /** 悅靈自己說話時暫停聽（避免聽到自己的聲音） */
  pausedUntil = 0;
  /** 目前音量 0–1（給動畫用） */
  level = 0;
  /** 說話門檻（跟著環境聲音自動調整） */
  gate = new NoiseGate();

  get on(): boolean {
    return !!this.stream;
  }

  async start(ctx: AudioContext, ev: ListenEvents): Promise<void> {
    if (this.stream) return;
    // iPhone 錄音時要切到可錄音的音訊模式，結束後再切回來
    setSession('play-and-record');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setSession('ambient');
      throw e;
    }
    // 每次開始都重新聽環境聲音
    this.gate = new NoiseGate();
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = ctx.createScriptProcessor(2048, 1, 1);
    const rate = ctx.sampleRate;
    this.node.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      this.level = Math.min(1, Math.sqrt(sum / d.length) * 8);
      if (performance.now() < this.pausedUntil) {
        this.reset();
        return;
      }
      const sec = d.length / rate;
      this.gate.update(this.level, sec, this.talking || this.loud > 0);
      // 剛開始先聽一下環境聲音，這段時間不判斷
      if (this.gate.calibrating) return;
      const loud = this.level > this.gate.threshold();
      if (loud) {
        this.loud += sec;
        this.quiet = 0;
      } else this.quiet += sec;
      // 要大聲持續一小段時間才算開始說話（碰撞聲、拍手這種很短的聲音不算）
      if (!this.talking && this.loud > 0.2 / sense.mic) {
        this.talking = true;
        ev.start();
      }
      if (this.talking || loud) {
        this.speech.push(d.slice());
        this.speechLen += d.length;
      } else if (this.quiet > 0.3) this.reset();
      const len = this.speechLen / rate;
      if (this.talking && (this.quiet > END_SILENCE || len > MAX_SPEECH)) {
        const all = join(this.speech, this.speechLen);
        this.reset();
        if (len > MIN_SPEECH) ev.end(all, rate);
      }
    };
    this.src.connect(this.node);
    // ScriptProcessor 要接到輸出才會運作（輸出是靜音）
    this.node.connect(ctx.destination);
  }

  private reset(): void {
    this.speech = [];
    this.speechLen = 0;
    this.loud = 0;
    this.talking = false;
  }

  stop(): void {
    if (!this.stream) return;
    this.stream.getTracks().forEach((t) => t.stop());
    this.src?.disconnect();
    this.node?.disconnect();
    this.stream = null;
    this.level = 0;
    this.reset();
    setSession('ambient');
  }
}

function join(chunks: Float32Array[], len: number): Float32Array {
  const all = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return all;
}

/** 去掉前後的靜音（前後各留 0.05 秒）；太短或幾乎沒聲音時回傳 null */
export function trimSilence(d: Float32Array, rate: number, silence = 0.02): Float32Array<ArrayBuffer> | null {
  let a = 0;
  while (a < d.length && Math.abs(d[a]) < silence) a++;
  let b = d.length - 1;
  while (b > a && Math.abs(d[b]) < silence) b--;
  if (b - a < rate * 0.15) return null;
  const pad = Math.floor(rate * 0.05);
  return d.slice(Math.max(0, a - pad), Math.min(d.length, b + 1 + pad));
}

// ---------- 設定頁錄的回應（每種語言 5 句，只存在這台裝置） ----------

export const REPLY_SLOTS = 5;
const REPLY_MAX_SEC = 4;

export interface Clip {
  rate: number;
  data: Float32Array;
}
type Replies = (Clip | null)[];

const DB = 'fairypocket-voice';
const STORE = 'phrases';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  } finally {
    d.close();
  }
}

export async function loadReplies(lang: Lang): Promise<Replies> {
  try {
    const r = ((await run('readonly', (s) => s.get(`replies:${lang}`))) as Replies | undefined) ?? [];
    return Array.from({ length: REPLY_SLOTS }, (_, i) => r[i] ?? null);
  } catch {
    return Array(REPLY_SLOTS).fill(null);
  }
}

export async function saveReplies(lang: Lang, r: Replies): Promise<void> {
  await run('readwrite', (s) => s.put(r, `replies:${lang}`));
}

/** 變聲後的錄音（同一句同一種聲音只算一次） */
const fxCache = new WeakMap<Clip, Map<VoiceStyle, Float32Array<ArrayBuffer>>>();

/** style 為 null 時播放原本的聲音 */
export function clipBuffer(ctx: AudioContext, c: Clip, style: VoiceStyle | null): AudioBuffer {
  let d: Float32Array<ArrayBuffer>;
  if (!style) d = new Float32Array(c.data);
  else {
    let m = fxCache.get(c);
    if (!m) fxCache.set(c, (m = new Map()));
    let v = m.get(style);
    if (!v) m.set(style, (v = transform(c.data, c.rate, style)));
    d = v;
  }
  const buf = ctx.createBuffer(1, d.length, c.rate);
  buf.copyToChannel(d, 0);
  return buf;
}

// ---------- 貼紙簿的錄音（每張貼紙一段，只存在這台裝置） ----------

const STICKER_PREFIX = 'sticker:';

/** 讀出所有貼紙的錄音：貼紙 id → 錄音 */
export async function loadStickerClips(): Promise<Map<string, Clip>> {
  const out = new Map<string, Clip>();
  try {
    const keys = (await run('readonly', (s) => s.getAllKeys())) as IDBValidKey[];
    for (const k of keys) {
      if (typeof k !== 'string' || !k.startsWith(STICKER_PREFIX)) continue;
      const c = (await run('readonly', (s) => s.get(k))) as Clip | undefined;
      if (c) out.set(k.slice(STICKER_PREFIX.length), c);
    }
  } catch {
    // 讀不到就當作還沒有錄音
  }
  return out;
}

export async function saveStickerClip(id: string, c: Clip | null): Promise<void> {
  if (c) await run('readwrite', (s) => s.put(c, STICKER_PREFIX + id));
  else await run('readwrite', (s) => s.delete(STICKER_PREFIX + id));
}

/** 改錄音的名字（舊版不分語言的錄音 → 依語言分開） */
export async function renameStickerClips(pairs: [string, string][]): Promise<void> {
  for (const [a, b] of pairs) {
    const c = await run('readonly', (s) => s.get(STICKER_PREFIX + a));
    if (c) await run('readwrite', (s) => s.put(c, STICKER_PREFIX + b));
    await run('readwrite', (s) => s.delete(STICKER_PREFIX + a));
  }
}

// ---------- 匯出存檔用：錄音資料庫的全部內容 ----------

export async function allVoiceEntries(): Promise<[string, unknown][]> {
  const keys = (await run('readonly', (s) => s.getAllKeys())) as IDBValidKey[];
  const out: [string, unknown][] = [];
  for (const k of keys) if (typeof k === 'string') out.push([k, await run('readonly', (s) => s.get(k))]);
  return out;
}

/** 還原錄音（同名的會被存檔裡的取代，其他的保留） */
export async function putVoiceEntries(entries: [string, unknown][]): Promise<void> {
  for (const [k, v] of entries) if (v !== null && v !== undefined) await run('readwrite', (s) => s.put(v, k));
}

// ---------- 變聲的種類（存在這台裝置） ----------

const STYLE_KEY = 'fairypocket.voicestyle.v1';

export function loadVoiceStyle(storage: Pick<Storage, 'getItem'>): VoiceStyle {
  const v = storage.getItem(STYLE_KEY) as VoiceStyle | null;
  return v && VOICE_STYLES.includes(v) ? v : 'fairy';
}

export function saveVoiceStyle(storage: Pick<Storage, 'setItem'>, v: VoiceStyle): void {
  storage.setItem(STYLE_KEY, v);
}

/**
 * 錄一句回應：開始後一直錄到說完（安靜 0.7 秒）、按停止或滿 4 秒為止。
 * 回傳 stop 函式與結果。
 */
export async function recordClip(ctx: AudioContext, maxSec = REPLY_MAX_SEC): Promise<{ stop: () => void; done: Promise<Clip | null> }> {
  setSession('play-and-record');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    setSession('ambient');
    throw e;
  }
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(2048, 1, 1);
  const chunks: Float32Array[] = [];
  let len = 0, quiet = 0, heard = false;
  let finish!: () => void;
  const done = new Promise<Clip | null>((resolve) => {
    finish = () => {
      stream.getTracks().forEach((t) => t.stop());
      src.disconnect();
      node.disconnect();
      setSession('ambient');
      const t = trimSilence(join(chunks, len), ctx.sampleRate);
      resolve(t ? { rate: ctx.sampleRate, data: t } : null);
    };
  });
  let ended = false;
  const stop = () => {
    if (ended) return;
    ended = true;
    finish();
  };
  node.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    const loud = Math.sqrt(sum / d.length) * 8 > NoiseGate.BASE;
    chunks.push(d.slice());
    len += d.length;
    if (loud) {
      heard = true;
      quiet = 0;
    } else quiet += d.length / ctx.sampleRate;
    if ((heard && quiet > END_SILENCE) || len / ctx.sampleRate > maxSec) stop();
  };
  src.connect(node);
  node.connect(ctx.destination);
  return { stop, done };
}
