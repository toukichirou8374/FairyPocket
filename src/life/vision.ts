// AI 動態生命模式的「看畫面」：主人同意後（設定裡打開，預設關），偶爾把前鏡頭的低解析度截圖
// 送到家裡電腦的 AI（gemma3，經由 Tailscale），請它用一句話說出看到什麼。
// - 只送家裡電腦，不送雲端 AI；截圖不存檔，送完就丟。
// - 只在鏡頭前有人、App 在前景時才看，最多每 30 秒一次。
// - 看到的描述只給 AI 參考（可能看錯），新出現的東西才讓 AI 決定要不要說一句。
import type { Lang } from '../i18n';

/** 瀏覽器的 localStorage（測試環境、私密瀏覽沒有時，讀寫會在 try 裡失敗而用預設值） */
const browserStorage = (): Storage => globalThis.localStorage as Storage;

const KEY = 'fairypocket.lifevision.v1';

export function lifeVisionOn(storage: Pick<Storage, 'getItem'> = browserStorage()): boolean {
  try {
    return storage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function setLifeVision(on: boolean, storage: Pick<Storage, 'setItem'> = browserStorage()): void {
  try {
    storage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 存不了也沒關係 */
  }
}

/** 最多每幾秒看一次 */
export const LOOK_EVERY = 30;
/** 看到的描述幾秒內算「現在」 */
export const SIGHT_FRESH = 90;
/** 新東西的反應最少隔幾秒 */
export const SAW_EVERY = 90;

/** 請家裡電腦的 AI 看截圖（不是悅靈說話，只是描述畫面） */
export const VISION_PROMPT: Record<Lang, string> = {
  zh_tw:
    '這是手機前鏡頭拍到的畫面（拿著手機的人那邊）。用台灣的繁體中文回答，格式只有兩行：\n第一行：用一句很短的話說出看到的人在做什麼、手上或身邊明顯的東西。\n第二行：「東西：」後面列出明顯的物品名稱，最多 4 個，用「、」隔開；沒有就寫「東西：無」。\n看不清楚的不要寫，不要猜人的身分、長相或年紀。',
  ja_jp:
    'これはスマホの前カメラの画面です（スマホを持っている人のほう）。日本語で、2行だけで答えてください：\n1行目：見える人が何をしているか、手やまわりのはっきりした物をみじかい一文で。\n2行目：「もの：」のあとに、はっきり見える物の名前を4つまで「、」で区切って。なければ「もの：なし」。\nよく見えないものは書かず、人がだれか・顔・年れいは推測しないでください。',
  en_us:
    "This is the phone's front camera view (the side of the person holding the phone). Answer in English with exactly two lines:\nLine 1: one short sentence about what the person is doing and any clear objects in their hands or nearby.\nLine 2: \"Things:\" followed by up to 4 clear object names separated by commas; write \"Things: none\" if there are none.\nSkip anything unclear, and don't guess who the person is, their looks or age.",
};

export interface Sight {
  /** 一句話的描述 */
  desc: string;
  /** 明顯的東西（小寫、去掉空白） */
  things: string[];
}

const THINGS_LINE = /^\s*[-*・]?\s*(?:第二行[:：]?\s*)?(?:東西|物品|もの|物|things?)\s*[:：]\s*(.*)$/im;
const NONE = /^(?:無|没有|沒有|なし|ない|none|nothing|n\/a)\.?$/i;

/** 讀 AI 的回答：第一行是描述，「東西：」那行是物品清單 */
export function parseVision(raw: string): Sight | null {
  const text = raw.replace(/\r/g, '').trim();
  if (!text) return null;
  const m = THINGS_LINE.exec(text);
  const things = m
    ? m[1]
        .split(/[、，,;；\/]/)
        .map((s) => s.trim().replace(/[。.!！]+$/, '').toLowerCase())
        .filter((s) => s && !NONE.test(s))
        .slice(0, 4)
    : [];
  const desc =
    text
      .split('\n')
      .map((l) => l.replace(/^\s*(?:第一行|1行目|line\s*1)\s*[:：]\s*/i, '').replace(/^[-*・]\s*/, '').trim())
      .find((l) => l && !THINGS_LINE.test(l)) ?? '';
  // 太長的描述切短（給生命模式的 AI 參考就好）
  const short = desc.length > 80 ? `${desc.slice(0, 80)}…` : desc;
  if (!short && !things.length) return null;
  return { desc: short, things };
}

/** 這次看到、上次沒有的東西 */
export function newThings(before: string[], now: string[]): string[] {
  const had = new Set(before);
  return now.filter((t) => !had.has(t) && ![...had].some((h) => h.includes(t) || t.includes(h)));
}

/** 截圖：縮小成 320 寬的 JPEG（base64，不含開頭），前鏡頭照畫面上看到的方向（鏡像）；太大就降畫質 */
export function snapshot(video: HTMLVideoElement, mirror: boolean, maxBytes = 48_000): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || video.readyState < 2) return null;
  const w = 320;
  const h = Math.round((vh / vw) * w);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  for (const q of [0.6, 0.45, 0.3]) {
    const b64 = c.toDataURL('image/jpeg', q).split(',')[1] ?? '';
    if (b64 && b64.length <= maxBytes) return b64;
  }
  return null;
}
