// 語音辨識（精靈舞蹈的「聲音」玩法）：用瀏覽器內建的語音辨識聽小朋友說的話。
// iPhone／iPad 的 Safari 與電腦的 Chrome、Edge 都有；不支援時由呼叫的地方改用「聽到聲音就算」。
// 聲音只交給瀏覽器辨識成文字，App 不會存起來。

interface RecResult extends ArrayLike<{ transcript: string }> {
  isFinal: boolean;
}
interface RecEvent {
  resultIndex: number;
  results: ArrayLike<RecResult>;
}
interface Rec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onnomatch?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecCtor = new () => Rec;

function ctor(): RecCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = (): boolean => !!ctor();

/** 中途結果停住多久就當作說完（毫秒） */
export const SETTLE_MS = 1300;

/** 辨識的每一步（AI 3.0：開發者區看得到卡在哪一步） */
export type RecStage = 'listening' | 'speech' | 'recognizing' | 'final' | 'nomatch' | 'error' | 'restart' | 'end';

/** 一定不能恢復的錯誤（沒有權限）；其他的（沒聽到、網路、麥克風暫時被占用）重新開始就好 */
const FATAL = new Set(['not-allowed', 'service-not-allowed']);
/** 麥克風暫時被占用（iPhone 播放語音時常常這樣）：連續幾次才放棄 */
const CAPTURE_TRIES = 3;
/** 自動重新開始失敗時，隔多久再試 */
const RESTART_BACKOFF = [300, 1000, 2500, 5000];

export class Recognizer {
  private rec: Rec | null = null;
  private settleTimer = 0;
  private restartTimer = 0;
  private running = false;
  private captureFails = 0;
  /** 沒有權限或發生無法恢復的錯誤 */
  failed: string | null = null;
  /** 每一步的通知（開發者區、觀察紀錄用） */
  onStage: ((stage: RecStage, detail?: string) => void) | null = null;

  /** onText(聽到的文字, 是否說完了, 其他可能聽成的說法（含第一個）) */
  start(lang: string, onText: (text: string, final: boolean, alts: string[]) => void, onFail?: (error: string) => void): boolean {
    const C = ctor();
    if (!C) return false;
    this.stop();
    const rec = new C();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    // 小朋友的發音不一定標準：多拿幾個可能的結果來比對
    rec.maxAlternatives = 5;
    const stage = (s: RecStage, d?: string) => {
      try {
        this.onStage?.(s, d);
      } catch {
        /* 診斷不影響辨識 */
      }
    };
    // 有些瀏覽器（特別是 iPhone 的 Safari）連續辨識時常常一直不給「說完了」：
    // 中途結果停住 SETTLE_MS 沒有變化，就當作說完了（之後如果又收到同一句的完成結果，不重複回答）
    let pending: { text: string; alts: string[] } | null = null;
    let settled = '';
    const settle = (): void => {
      this.settleTimer = 0;
      if (!pending || this.rec !== rec) return;
      const p = pending;
      pending = null;
      settled = p.text.trim();
      stage('final', 'settle');
      onText(p.text, true, p.alts);
    };
    rec.onstart = () => stage('listening');
    rec.onspeechstart = () => stage('speech');
    // 有聲音但認不出字：不是成功，也不送給 AI
    rec.onnomatch = () => stage('nomatch');
    rec.onresult = (e) => {
      // 已經停掉（或換了新的辨識）：舊的結果不要
      if (this.rec !== rec) return;
      this.captureFails = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alts: string[] = [];
        for (let k = 0; k < r.length; k++) if (r[k]?.transcript) alts.push(r[k].transcript);
        window.clearTimeout(this.settleTimer);
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) {
          pending = null;
          const same = settled && text.trim() === settled;
          settled = '';
          // 空的完成結果＝沒聽懂（NoMatch），不當成說了話
          if (!text.trim()) stage('nomatch', 'empty');
          else if (!same) {
            stage('final');
            onText(text, true, alts);
          }
        } else if (text.trim()) {
          pending = { text, alts };
          this.settleTimer = window.setTimeout(settle, SETTLE_MS);
          stage('recognizing');
          onText(text, false, alts);
        }
      }
    };
    rec.onerror = (e) => {
      if (this.rec !== rec) return;
      stage('error', e.error);
      const fatal = FATAL.has(e.error) || (e.error === 'audio-capture' && ++this.captureFails >= CAPTURE_TRIES);
      if (fatal) {
        this.failed = e.error;
        this.running = false;
        window.clearTimeout(this.restartTimer);
        onFail?.(e.error);
      }
      // 其他錯誤（no-speech、aborted、network、暫時的 audio-capture）：onend 之後自動重新開始
    };
    // 安靜一陣子後瀏覽器會自己停掉：遊戲還在進行就重新開始（失敗就隔久一點再試，不會默默停住）
    const restart = (tries: number): void => {
      if (!this.running || this.rec !== rec) return;
      try {
        rec.start();
        if (tries) stage('restart', String(tries));
      } catch {
        if (tries >= RESTART_BACKOFF.length) {
          this.failed = 'stalled';
          this.running = false;
          stage('error', 'stalled');
          onFail?.('stalled');
          return;
        }
        this.restartTimer = window.setTimeout(() => restart(tries + 1), RESTART_BACKOFF[tries]);
      }
    };
    rec.onend = () => {
      stage('end');
      // 還沒送出的中途結果：停掉時就當作說完（以前會在重新開始時遺失）
      if (pending && this.rec === rec) {
        window.clearTimeout(this.settleTimer);
        settle();
      }
      if (this.running && this.rec === rec) restart(0);
    };
    this.rec = rec;
    this.running = true;
    this.failed = null;
    this.captureFails = 0;
    try {
      rec.start();
    } catch {
      return false;
    }
    return true;
  }

  stop(): void {
    window.clearTimeout(this.settleTimer);
    window.clearTimeout(this.restartTimer);
    this.settleTimer = 0;
    this.running = false;
    const r = this.rec;
    this.rec = null;
    try {
      r?.abort();
    } catch {
      // 已經停了
    }
  }
}
