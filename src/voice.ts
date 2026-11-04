// 麥克風：按住快捷欄的麥克風格說話，悅靈會專心聽，放開後用悅靈的高音學你說一次。
// 學到的話（最多 5 句、每句最長 5 秒）只存在這台裝置（IndexedDB），之後打招呼時偶爾會說。
// 錄音直接收原始聲音資料，不經過任何網路服務。

const MAX_SEC = 5;
const MAX_PHRASES = 5;
const SILENCE = 0.02;

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

function setSession(type: string): void {
  const s = (navigator as AudioSessionNav).audioSession;
  if (s) s.type = type;
}

export class Voice {
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private samples = 0;
  /** 目前音量 0–1（給動畫用） */
  level = 0;

  get recording(): boolean {
    return !!this.stream;
  }

  /** 開始錄音；使用者拒絕麥克風權限時會丟出錯誤 */
  async start(ctx: AudioContext): Promise<void> {
    if (this.stream) return;
    // iPhone 錄音時要切到可錄音的音訊模式，結束後再切回來
    setSession('play-and-record');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setSession('ambient');
      throw e;
    }
    this.chunks = [];
    this.samples = 0;
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = ctx.createScriptProcessor(4096, 1, 1);
    const max = ctx.sampleRate * MAX_SEC;
    this.node.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      this.level = Math.min(1, Math.sqrt(sum / d.length) * 8);
      if (this.samples < max) {
        this.chunks.push(d.slice());
        this.samples += d.length;
      }
    };
    this.src.connect(this.node);
    // ScriptProcessor 要接到輸出才會運作（輸出是靜音）
    this.node.connect(ctx.destination);
  }

  /** 停止錄音，回傳去掉前後靜音的聲音；沒錄到聲音時回傳 null */
  stop(ctx: AudioContext): AudioBuffer | null {
    if (!this.stream) return null;
    this.stream.getTracks().forEach((t) => t.stop());
    this.src?.disconnect();
    this.node?.disconnect();
    this.stream = null;
    this.level = 0;
    setSession('ambient');
    const all = new Float32Array(this.samples);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c.subarray(0, Math.min(c.length, all.length - o)), o);
      o += c.length;
      if (o >= all.length) break;
    }
    const trimmed = trimSilence(all, ctx.sampleRate);
    if (!trimmed) return null;
    const buf = ctx.createBuffer(1, trimmed.length, ctx.sampleRate);
    buf.copyToChannel(trimmed, 0);
    return buf;
  }
}

/** 去掉前後的靜音（前後各留 0.05 秒）；太短或幾乎沒聲音時回傳 null */
export function trimSilence(d: Float32Array, rate: number): Float32Array<ArrayBuffer> | null {
  let a = 0;
  while (a < d.length && Math.abs(d[a]) < SILENCE) a++;
  let b = d.length - 1;
  while (b > a && Math.abs(d[b]) < SILENCE) b--;
  if (b - a < rate * 0.15) return null;
  const pad = Math.floor(rate * 0.05);
  return d.slice(Math.max(0, a - pad), Math.min(d.length, b + 1 + pad));
}

// ---------- 學會的話（存在這台裝置） ----------

interface Phrase {
  rate: number;
  data: Float32Array;
}

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

export async function loadPhrases(): Promise<Phrase[]> {
  try {
    return ((await run('readonly', (s) => s.get('list'))) as Phrase[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/** 記住一句話（超過 5 句時忘掉最舊的）；回傳現在學會幾句 */
export async function learnPhrase(buf: AudioBuffer): Promise<number> {
  const list = await loadPhrases();
  list.push({ rate: buf.sampleRate, data: buf.getChannelData(0).slice() });
  while (list.length > MAX_PHRASES) list.shift();
  await run('readwrite', (s) => s.put(list, 'list'));
  return list.length;
}

export async function forgetPhrases(): Promise<void> {
  await run('readwrite', (s) => s.delete('list'));
}

export function phraseBuffer(ctx: AudioContext, p: Phrase): AudioBuffer {
  const buf = ctx.createBuffer(1, p.data.length, p.rate);
  buf.copyToChannel(new Float32Array(p.data), 0);
  return buf;
}
