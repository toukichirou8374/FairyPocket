// AI 3.0 語音修復：生命模式「聽」的判斷（純邏輯，可以單獨測試）。
//
// 2026-11-15 的生命觀察紀錄找到的根本原因（詳見 docs/ai3/AI3-REPORT.md）：
// 1. 同一句話送了兩次：中途結果停住 1.3 秒先當作說完（「1時」），370 毫秒後瀏覽器又給了較長的完成結果（「1時マイク」）→ 兩個 AI 回合、她回了兩次
// 2. 家人說的話被當成「她自己的回音」丟掉：舊的比對用「字的重複比例」，日文假名跟她剛說的長句幾乎都有重疊 → 家人得重講一次
// 3. 她說話（神經語音 6～12 秒）＋1.5 秒的期間，所有辨識結果直接丟掉：家人在她說話時開口，整句就消失
// 4. AI 正在想的時候家人又說了一句：被降級成「發生的事」另外再問一次，兩個回答重疊

/** 去掉空白、標點、符號，轉小寫 */
export const normHeard = (s: string): string => s.toLowerCase().replace(/[\s\p{P}\p{S}ー〜～]/gu, '');

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** 兩句話有多像（相鄰兩個字的組合重疊比例，0～1）；只看單字會讓日文假名幾乎都「很像」 */
export function similarity(a: string, b: string): number {
  const x = bigrams(normHeard(a));
  const y = bigrams(normHeard(b));
  if (!x.length || !y.length) return 0;
  const pool = [...y];
  let same = 0;
  for (const g of x) {
    const i = pool.indexOf(g);
    if (i >= 0) {
      same++;
      pool.splice(i, 1);
    }
  }
  return (2 * same) / (x.length + y.length);
}

/**
 * 麥克風聽到的是不是她自己剛說的話（喇叭的聲音又被收進來）。
 * 是她說的話的一段（2 字以上）、或整體很像（≥ 0.5），才算回音。
 */
export function echoOf(heard: string, said: readonly string[]): boolean {
  const h = normHeard(heard);
  if (h.length < 2) return false;
  return said.some((x) => {
    const s = normHeard(x);
    if (s.length < 2) return false;
    if (s.includes(h)) return true;
    // 聽到的比她說的長：要她說的話夠長（4 字以上）才算包含（不然「嗯」「好」到處都有）
    if (s.length >= 4 && h.includes(s)) return true;
    return h.length >= 3 && similarity(h, s) >= 0.5;
  });
}

export type FinalVerdict = 'new' | 'extend' | 'dup';

/**
 * 同一句話不要送兩次：上一句送出後 3 秒內又來一句，
 * 一樣（或是上一句的一部分）＝重複；開頭就是上一句、只是更長＝同一句的修正（換掉還沒回答的那一句）。
 */
export class FinalGate {
  private last: { norm: string; at: number } | null = null;
  constructor(private windowMs = 3000) {}
  offer(text: string, now: number): FinalVerdict {
    const n = normHeard(text);
    const prev = this.last;
    if (prev && now - prev.at < this.windowMs && n) {
      if (n === prev.norm || prev.norm.includes(n)) return 'dup';
      if (n.startsWith(prev.norm) || (prev.norm.length >= 2 && similarity(n, prev.norm) >= 0.6 && n.length > prev.norm.length)) {
        this.last = { norm: n, at: now };
        return 'extend';
      }
    }
    this.last = { norm: n, at: now };
    return 'new';
  }
  reset(): void {
    this.last = null;
  }
}

/** 她說話時聽到的完成結果：先留著（只留最新的一句），她說完才處理；太舊（10 秒）就不要了 */
export class HeldFinal {
  private held: { text: string; alts: string[]; at: number } | null = null;
  constructor(private maxAgeMs = 10_000) {}
  hold(text: string, alts: string[], now: number): void {
    this.held = { text, alts, at: now };
  }
  take(now: number): { text: string; alts: string[] } | null {
    const h = this.held;
    this.held = null;
    if (!h || now - h.at > this.maxAgeMs) return null;
    return { text: h.text, alts: h.alts };
  }
  get waiting(): boolean {
    return !!this.held;
  }
  clear(): void {
    this.held = null;
  }
}

// ---------- 可觀察的階段（開發者區看的；不存聲音、不存完整對話） ----------
export type HearStage =
  | 'permission' // 1 麥克風權限已取得
  | 'listening' // 2 開始收音
  | 'speech' // 3 偵測到有人說話
  | 'recognizing' // 4 辨識中（中途結果）
  | 'final' // 5 取得完成的文字
  | 'routed' // 6 送進路由
  | 'accepted' // 7 AI 接受並產生回應
  | 'shown' // 8 回應已顯示或念出
  | 'nomatch'
  | 'error'
  | 'echo'
  | 'dup'
  | 'extend'
  | 'held'
  | 'stale'
  | 'restart'
  | 'end';

export interface HearMark {
  stage: HearStage;
  at: number;
  /** 簡短說明（錯誤代碼、來源、長度…）；不放家人說的完整內容 */
  detail?: string;
}

/** 最近 40 個階段（環狀紀錄，只在記憶體） */
export class HearTrace {
  readonly marks: HearMark[] = [];
  readonly counts: Partial<Record<HearStage, number>> = {};
  lastError = '';
  mark(stage: HearStage, at: number, detail?: string): void {
    this.marks.push({ stage, at, detail });
    if (this.marks.length > 40) this.marks.shift();
    this.counts[stage] = (this.counts[stage] ?? 0) + 1;
    if (stage === 'error' && detail) this.lastError = detail;
  }
  /** 最後一次走到哪一步（1～8），還沒開始＝0 */
  reached(): number {
    const order: HearStage[] = ['permission', 'listening', 'speech', 'recognizing', 'final', 'routed', 'accepted', 'shown'];
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const k = order.indexOf(this.marks[i].stage);
      if (k >= 0) return k + 1;
    }
    return 0;
  }
  /** 開發者區的一行摘要 */
  summary(): string {
    const c = this.counts;
    return `step ${this.reached()}/8 · final ${c.final ?? 0} · sent ${c.routed ?? 0} · reply ${c.accepted ?? 0} · echo ${c.echo ?? 0} · dup ${c.dup ?? 0} · held ${c.held ?? 0} · nomatch ${c.nomatch ?? 0} · err ${c.error ?? 0}${this.lastError ? ` (${this.lastError})` : ''}`;
  }
}

/** 文字長度描述（紀錄用，不放內容） */
export const lenTag = (s: string): string => `${normHeard(s).length}ch`;

/** 整個 App 共用一份（main.ts 記錄、開發者區顯示） */
export const hearTrace = new HearTrace();
/** 開發者區顯示用的其他資訊（main.ts 填） */
export const hearInfo = { stt: '', lang: '', control: '', epoch: 0 };
