// 語音辨識（精靈舞蹈的「聲音」玩法）：用瀏覽器內建的語音辨識聽小朋友說的話。
// iPhone／iPad 的 Safari 與電腦的 Chrome、Edge 都有；不支援時由呼叫的地方改用「聽到聲音就算」。
// 聲音只交給瀏覽器辨識成文字，App 不會存起來。

interface RecResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecEvent {
  resultIndex: number;
  results: ArrayLike<RecResult>;
}
interface Rec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
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

export class Recognizer {
  private rec: Rec | null = null;
  private running = false;
  /** 沒有權限或發生無法恢復的錯誤 */
  failed: string | null = null;

  /** onText(聽到的文字, 是否說完了) */
  start(lang: string, onText: (text: string, final: boolean) => void, onFail?: (error: string) => void): boolean {
    const C = ctor();
    if (!C) return false;
    this.stop();
    const rec = new C();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        onText(r[0].transcript, r.isFinal);
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
