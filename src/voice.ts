// 麥克風：選起麥克風格後悅靈會一直聽，自己判斷你什麼時候說完，然後回應你。
// 回應用原本的悅靈叫聲＋紫水晶鈴聲。聽到的聲音只拿來判斷說話的開始與結束，不會存起來。

/** 說話音量門檻（0–1） */
const SPEAK = 0.12;
/** 安靜多久算說完（秒） */
const END_SILENCE = 0.7;
/** 最短、最長的一段話（秒） */
const MIN_SPEECH = 0.25;
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
      const loud = this.level > SPEAK;
      if (loud) {
        this.loud += sec;
        this.quiet = 0;
      } else this.quiet += sec;
      if (!this.talking && this.loud > 0.12) {
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

// ---------- 舊版留下的錄音 ----------

/** 刪掉舊版「學人說話」「錄音回應」存在裝置上的錄音 */
export function forgetVoiceData(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('fairypocket-voice');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
