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

export class Recognizer {
  private rec: Rec | null = null;
  private settleTimer = 0;
  private running = false;
  /** 沒有權限或發生無法恢復的錯誤 */
  failed: string | null = null;

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
      onText(p.text, true, p.alts);
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alts: string[] = [];
        for (let k = 0; k < r.length; k++) if (r[k]?.transcript) alts.push(r[k].transcript);
        window.clearTimeout(this.settleTimer);
        if (r.isFinal) {
          pending = null;
          const same = settled && r[0].transcript.trim() === settled;
          settled = '';
          if (!same) onText(r[0].transcript, true, alts);
        } else {
          pending = { text: r[0].transcript, alts };
          this.settleTimer = window.setTimeout(settle, SETTLE_MS);
          onText(r[0].transcript, false, alts);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        this.failed = e.error;
        this.running = false;
        onFail?.(e.error);
      }
    };
    // 安靜一陣子後瀏覽器會自己停掉：遊戲還在進行就重新開始
    rec.onend = () => {
      if (this.running && this.rec === rec) {
        try {
          rec.start();
        } catch {
          // 稍後再試
          window.setTimeout(() => this.running && this.rec === rec && rec.start(), 400);
        }
      }
    };
    this.rec = rec;
    this.running = true;
    this.failed = null;
    try {
      rec.start();
    } catch {
      return false;
    }
    return true;
  }

  stop(): void {
    window.clearTimeout(this.settleTimer);
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
