// AI 3.0：三個 AI 來源的路由（本機 AI／既有雲端 AI（Haiku）／Claude（Sonnet・Opus・Fable））。
// 每一次互動只選「一個」主要來源；失敗才依序換下一個（一次只叫一個，不會同時叫好幾個付費模型）。
// 路由本身是規則（不呼叫任何 AI），不會為了決定用誰而花錢。

import type { Lang } from '../i18n';

export type AiSource = 'local' | 'cloud' | 'claude';
/** AI 運作方式（設定） */
export type AiMode = 'auto' | 'local-first' | 'cloud-first' | 'claude-first' | 'local-only';
/** Claude 深度（設定）：Fable 只在製作人明確選擇時使用 */
export type ClaudeDepth = 'sonnet' | 'opus' | 'fable';
export type AskHow = 'chat' | 'event' | 'notice' | 'decide';

export const AI_MODES: AiMode[] = ['auto', 'local-first', 'cloud-first', 'claude-first', 'local-only'];
export const CLAUDE_DEPTHS: ClaudeDepth[] = ['sonnet', 'opus', 'fable'];

export interface RouteSettings {
  mode: AiMode;
  depth: ClaudeDepth;
}
export const DEFAULT_ROUTE: RouteSettings = { mode: 'auto', depth: 'sonnet' };

const KEY = 'fp.aiRoute';
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
export function loadRoute(): RouteSettings {
  try {
    const j = JSON.parse(store()?.getItem(KEY) ?? 'null') as Partial<RouteSettings> | null;
    return {
      mode: AI_MODES.includes(j?.mode as AiMode) ? (j!.mode as AiMode) : DEFAULT_ROUTE.mode,
      depth: CLAUDE_DEPTHS.includes(j?.depth as ClaudeDepth) ? (j!.depth as ClaudeDepth) : DEFAULT_ROUTE.depth,
    };
  } catch {
    return { ...DEFAULT_ROUTE };
  }
}
export function saveRoute(s: RouteSettings): void {
  try {
    store()?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 存不了就只在這次有效 */
  }
}

/** 這句話需不需要想比較多（只看文字本身，不問 AI） */
export function complexity(text: string, lang: Lang): 'simple' | 'complex' {
  const t = text.trim();
  const long = lang === 'en_us' ? t.length > 120 : t.length > 45;
  const ask =
    lang === 'en_us'
      ? /\b(why|how come|how do|how does|explain|plan|compare|difference|should i|what if|help me think)\b/i
      : lang === 'ja_jp'
        ? /(どうして|なんで|なぜ|どうやって|説明|せつめい|くらべ|比べ|ちがい|違い|計画|けいかく|相談|そうだん|考えて|かんがえて|どう思う)/
        : /(為什麼|为什么|怎麼會|怎麼做|怎麼辦|解釋|說明|比較|差別|計畫|規劃|商量|幫我想|你覺得|如果)/;
  return long || (ask.test(t) && t.length >= 6) ? 'complex' : 'simple';
}

export interface RouteInput {
  settings: RouteSettings;
  how: AskHow;
  text: string;
  lang: Lang;
  online: boolean;
  /** 各來源現在能不能用（設定好、沒有在冷卻、沒用完預算） */
  avail: Record<AiSource, boolean>;
}
export interface RoutePlan {
  /** 依序嘗試（第一個＝主要來源；後面的只在前一個失敗時才用） */
  order: AiSource[];
  /** 用 Claude 時的深度 */
  depth: ClaudeDepth;
  why: string;
}

/**
 * 選來源（規則）：
 * - 自己決定下一步、只是看到聽到什麼（decide／notice）：一律本機（不花錢，跟以前一樣）
 * - 家人做了什麼（event）：本機（跟以前一樣）；「僅本機」以外也不升到付費
 * - 家人說的話（chat）：
 *   - 自動：簡單的話 → 既有雲端 → 本機；需要想的話 → Claude → 既有雲端 → 本機（Claude 沒開就跟以前完全一樣）
 *   - 優先本機：本機 → 既有雲端 → Claude
 *   - 優先既有雲端：既有雲端 → 本機
 *   - 優先 Claude：Claude → 既有雲端 → 本機
 *   - 僅本機：本機
 * - Claude 深度：Sonnet＝都用 Sonnet；Opus＝需要想的話用 Opus、其他用 Sonnet；Fable＝製作人選了才用（只用在 Claude 那一步）
 */
export function route(i: RouteInput): RoutePlan {
  const depthFor = (): ClaudeDepth => {
    if (i.settings.depth === 'fable') return 'fable';
    if (i.settings.depth === 'opus') return complexity(i.text, i.lang) === 'complex' ? 'opus' : 'sonnet';
    return 'sonnet';
  };
  if (!i.online) return { order: [], depth: 'sonnet', why: 'offline' };
  let order: AiSource[];
  let why: string;
  const m = i.settings.mode;
  if (i.how !== 'chat' || m === 'local-only') {
    order = ['local'];
    why = m === 'local-only' ? 'local-only' : `${i.how}:local`;
  } else if (m === 'local-first') {
    order = ['local', 'cloud', 'claude'];
    why = 'local-first';
  } else if (m === 'cloud-first') {
    order = ['cloud', 'local'];
    why = 'cloud-first';
  } else if (m === 'claude-first') {
    order = ['claude', 'cloud', 'local'];
    why = 'claude-first';
  } else {
    const c = complexity(i.text, i.lang);
    order = c === 'complex' ? ['claude', 'cloud', 'local'] : ['cloud', 'local'];
    why = `auto:${c}`;
  }
  order = order.filter((s) => i.avail[s]);
  return { order, depth: depthFor(), why };
}

// ---------- Claude 只拿到最少的內容 ----------
const FAMILY_WORD: Record<Lang, string> = { zh_tw: '家人', ja_jp: 'かぞく', en_us: 'family' };

/** 家人的名字換成「家人」（預設不把家人資訊送到 Claude） */
export function redactNames(text: string, names: readonly string[], lang: Lang): string {
  let out = text;
  for (const n of [...names].filter((x) => x && x.trim().length >= 1).sort((a, b) => b.length - a.length)) out = out.split(n).join(FAMILY_WORD[lang]);
  return out;
}

// ---------- 候選回覆的限制（不管哪個來源） ----------
export interface Candidate {
  text: string;
  intent: string | null;
  actions: string[];
  notes: string[];
}
/**
 * Claude（或任何雲端）的回答只是「候選」：
 * - 不能寫記憶（notes 全部拿掉；記憶只由本機規則處理）
 * - 身體正被別的地方控制（例如 Minecraft 那邊持有控制權）時，不帶任何動作或意圖
 */
export function limitCandidate<T extends Candidate>(c: T, source: AiSource, bodyLocked: boolean): T {
  let out = c;
  if (source === 'claude') out = { ...out, notes: [] };
  if (bodyLocked) out = { ...out, intent: null, actions: [] };
  return out;
}

/** 回答裡有沒有明確寫意圖標籤（[意圖：…]、意圖：…）。Claude 會照格式寫標籤，所以不用從句子裡猜：
 *  實測 2026-11-17：20 句裡沒有一句寫意圖標籤，但從句子猜出了 4 個意圖，全部猜錯（「Did you sleep okay?」→睡覺、「好像在跳舞」→跳舞） */
export function explicitIntent(raw: string): boolean {
  return /(?:意圖|意図|いと|intent)\s*[:：]/i.test(raw);
}

/** 說「已經做好了」但其實沒有做（計時、鬧鐘、音樂、查資料由小助手功能真的做；AI 只能說想做） */
const CLAIM: Record<Lang, RegExp> = {
  zh_tw: /(已經|已)(幫你|替你)?(設好|設定好|開好|定好|放好|播放|查好)(了)?/,
  ja_jp: /(セットしたよ|セットしておいた|かけておいた|ながしたよ|流したよ|しらべておいた|調べておいた|予約したよ)/,
  en_us: /\b(i(?:'ve| have) (?:set|started|scheduled|played|booked|looked up))\b/i,
};
export function claimsDone(text: string, lang: Lang): boolean {
  return CLAIM[lang].test(text);
}
/** 拿掉「說已經做好了」的句子（其他句子留著） */
export function dropClaims(text: string, lang: Lang): string {
  const parts = text.match(/[^。！？!?.\n]+[。！？!?.\n]*/g) ?? [text];
  return parts
    .filter((p) => !claimsDone(p, lang))
    .join('')
    .trim();
}

// ---------- 開發者區的診斷（只在記憶體） ----------
export interface AiDiag {
  reqId: string;
  how: AskHow | '';
  why: string;
  tried: AiSource[];
  source: AiSource | '';
  model: string;
  fallback: boolean;
  ms: number;
  tokens: string;
  result: string;
}
export const aiDiag: AiDiag = { reqId: '', how: '', why: '', tried: [], source: '', model: '', fallback: false, ms: 0, tokens: '', result: '' };

let seq = 0;
export function newReqId(now = Date.now()): string {
  seq = (seq + 1) % 1e6;
  return `fp${now.toString(36)}${seq.toString(36)}`;
}
