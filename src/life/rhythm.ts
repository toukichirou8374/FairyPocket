// AI 生命模式第二階段：生活節奏、離開後回來、記憶影響行為。
// - 作息：依個性有大概的起床、睡覺時間，告訴 AI 現在是一天的什麼時候（要不要睡由 AI 決定）。
// - 離開後回來：告訴 AI 過了多久、有沒有跨過晚上；只知道時間過了，不編造這段時間發生的事。
// - 今天真的發生過的事（餵食、摸頭、看到的東西…）存在手機裡，AI 可以提起；不是真的發生過的不會有。
// - 最近常做的事＝她的喜好，會影響她想做什麼。
import type { Lang } from '../i18n';
import type { Personality } from '../game/state';
import type { Intent } from './life';

/** 瀏覽器的 localStorage（測試環境、私密瀏覽沒有時，讀寫會在 try 裡失敗而用預設值） */
const browserStorage = (): Storage => globalThis.localStorage as Storage;

export interface Habit {
  /** 平常起床、睡覺的時間（點） */
  wake: number;
  bed: number;
}
export const HABITS: Record<Personality, Habit> = {
  guardian: { wake: 6, bed: 21 },
  brave: { wake: 6, bed: 22 },
  cautious: { wake: 7, bed: 21 },
  playful: { wake: 8, bed: 23 },
};

/** 現在是不是平常睡覺的時間 */
export function sleepTime(hour: number, h: Habit): boolean {
  return h.bed > h.wake ? hour >= h.bed || hour < h.wake : hour >= h.bed && hour < h.wake;
}

export type DayPhase = 'morning' | 'day' | 'evening' | 'bedtime' | 'night';
export function dayPhase(hour: number, h: Habit): DayPhase {
  if (sleepTime(hour, h)) return 'night';
  if (hour >= h.bed - 1) return 'bedtime';
  if (hour < h.wake + 3) return 'morning';
  if (hour >= 18) return 'evening';
  return 'day';
}

const PHASE_HINT: Record<DayPhase, Record<Lang, string>> = {
  morning: { zh_tw: '早上剛開始，可以伸懶腰、整理翅膀，慢慢醒過來', ja_jp: '朝がはじまったところ。のびをしたり、はねをととのえたりして、ゆっくり目をさまして', en_us: 'the morning is starting; stretch, groom your wings and wake up slowly' },
  day: { zh_tw: '白天，精神好的話可以到處探索、玩', ja_jp: '昼間。元気ならあちこちたんけんしたり遊んだり', en_us: "it's daytime; if you have energy, explore and play" },
  evening: { zh_tw: '傍晚，可以慢下來、哼哼歌、發發呆', ja_jp: '夕方。ゆっくりして、はなうたやぼんやりもいい', en_us: "it's evening; slow down, hum or daydream" },
  bedtime: { zh_tw: '快到睡覺時間了，開始想睡也很自然', ja_jp: 'もうすぐねる時間。ねむくなってきてもいい', en_us: "it's almost bedtime; feeling sleepy is natural" },
  night: { zh_tw: '是你平常睡覺的時間，沒事的話就去睡吧；被叫醒可以先醒一下', ja_jp: 'いつもねている時間。用がなければねよう。起こされたらすこし起きていてもいい', en_us: "it's your usual sleeping time; go to sleep if nothing is happening, or stay up a bit if woken" },
};

/** 給 AI 看的作息說明 */
export function rhythmText(hour: number, h: Habit, lang: Lang): string {
  const hint = PHASE_HINT[dayPhase(hour, h)][lang];
  if (lang === 'ja_jp') return `生活リズム：いつもは ${h.wake} 時ごろ起きて、${h.bed} 時ごろねます。いまは ${hour} 時、${hint}。`;
  if (lang === 'en_us') return `Your rhythm: you usually wake around ${h.wake}:00 and sleep around ${h.bed}:00. It's ${hour}:00 now; ${hint}.`;
  return `作息：你平常大約 ${h.wake} 點起床、${h.bed} 點睡覺。現在 ${hour} 點，${hint}。`;
}

function duration(ms: number, lang: Lang): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  const [m, h, d] = lang === 'ja_jp' ? ['分', '時間', '日'] : lang === 'en_us' ? [' minutes', ' hours', ' days'] : [' 分鐘', ' 個小時', ' 天'];
  if (min < 60) return `${min}${m}`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}${h}`;
  return `${Math.round(hr / 24)}${d}`;
}

/** 離開的這段時間有沒有跨過她平常睡覺的時間 */
export function sleptWhileAway(from: number, to: number, h: Habit): boolean {
  for (let t = from; t <= to; t += 3600_000) if (sleepTime(new Date(t).getHours(), h)) return true;
  return sleepTime(new Date(to).getHours(), h) || to - from > 24 * 3600_000;
}

/** 家人離開一陣子再回來（交給 AI 的事） */
export function awayText(from: number, to: number, h: Habit, lang: Lang): string {
  const dur = duration(to - from, lang);
  const hour = new Date(to).getHours();
  const slept = sleptWhileAway(from, to, h);
  if (lang === 'ja_jp')
    return `（かぞくが ${dur}ぶりにもどってきてアプリをひらいた。いまは ${hour} 時。${slept ? 'そのあいだに夜があったので、あなたはねていたはず。' : ''}時間がたったことしかわからないので、そのあいだのできごとを作らないで。）`;
  if (lang === 'en_us')
    return `(Your friend came back and opened the app after about ${dur}. It's ${hour}:00 now. ${slept ? 'A night passed in between, so you were probably asleep. ' : ''}You only know that time passed; don't invent things that happened meanwhile.)`;
  return `（家人離開了大約 ${dur}，現在回來打開了 App。現在是 ${hour} 點。${slept ? '這段時間跨過了晚上，你那時應該在睡覺。' : ''}你只知道時間過了，不要編造這段時間具體發生的事。）`;
}

// ---------- 今天真的發生過的事（存在手機裡） ----------
export interface LogEntry {
  at: number;
  lang: Lang;
  text: string;
}
const LOG_KEY = 'fairypocket.lifelog.v1';
const MAX_LOG = 24;

export function loadLog(storage: Pick<Storage, 'getItem'> = browserStorage()): LogEntry[] {
  try {
    const a = JSON.parse(storage.getItem(LOG_KEY) ?? '[]') as LogEntry[];
    return Array.isArray(a) ? a.filter((e) => e && typeof e.text === 'string' && typeof e.at === 'number').slice(-MAX_LOG) : [];
  } catch {
    return [];
  }
}
export function saveLog(log: LogEntry[], storage: Pick<Storage, 'setItem'> = browserStorage()): void {
  try {
    storage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_LOG)));
  } catch {
    /* 存不了也沒關係 */
  }
}
/** 記一件發生的事（括號拿掉；10 分鐘內跟上一件一樣就不重複記） */
export function addLog(log: LogEntry[], text: string, lang: Lang, now = Date.now()): void {
  const t = text.replace(/^[（(]\s*|\s*[）)]$/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const last = log.at(-1);
  if (!t || (last && last.text === t && now - last.at < 10 * 60_000)) return;
  log.push({ at: now, lang, text: t });
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
}
/** 今天（同一天、同一個語言）的最後幾件事，前面加時間 */
export function todayLog(log: LogEntry[], lang: Lang, now = Date.now(), n = 6): string[] {
  const day = new Date(now).toDateString();
  return log
    .filter((e) => e.lang === lang && new Date(e.at).toDateString() === day && e.at <= now)
    .slice(-n)
    .map((e) => {
      const d = new Date(e.at);
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} ${e.text}`;
    });
}

// ---------- 喜好：最近常做的事 ----------
const LIKE_KEY = 'fairypocket.lifelikes.v1';
/** 不算喜好的（作息、回應家人） */
const NOT_LIKES = new Set<Intent>(['wake', 'sleep', 'rest', 'approach', 'stay', 'eat_cake']);

export type Likes = Partial<Record<Intent, number>>;
export function loadLikes(storage: Pick<Storage, 'getItem'> = browserStorage()): Likes {
  try {
    const o = JSON.parse(storage.getItem(LIKE_KEY) ?? '{}') as Likes;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}
export function saveLikes(l: Likes, storage: Pick<Storage, 'setItem'> = browserStorage()): void {
  try {
    storage.setItem(LIKE_KEY, JSON.stringify(l));
  } catch {
    /* 存不了也沒關係 */
  }
}
/** 做了一次：加一；全部慢慢變淡（舊的喜好會被新的取代） */
export function bumpLike(l: Likes, i: Intent): void {
  if (NOT_LIKES.has(i)) return;
  for (const k of Object.keys(l) as Intent[]) l[k] = Math.round((l[k] ?? 0) * 0.97 * 100) / 100;
  l[i] = (l[i] ?? 0) + 1;
}
/** 最喜歡的幾件事（做得夠多才算） */
export function topLikes(l: Likes, n = 3): Intent[] {
  return (Object.entries(l) as [Intent, number][])
    .filter(([k, v]) => v >= 3 && !NOT_LIKES.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// ---------- 最後一次在生命模式的時間（重新打開 App 時算離開多久） ----------
const SEEN_KEY = 'fairypocket.lifeseen.v1';
export function lastLifeSeen(storage: Pick<Storage, 'getItem'> = browserStorage()): number {
  try {
    return Number(storage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
export function markLifeSeen(now = Date.now(), storage: Pick<Storage, 'setItem'> = browserStorage()): void {
  try {
    storage.setItem(SEEN_KEY, String(now));
  } catch {
    /* 存不了也沒關係 */
  }
}

// ---------- 收藏：在地上找東西時偶爾真的找到（存在手機裡，會影響她之後想做什麼） ----------
export type TreasureKind = 'shard' | 'feather' | 'bead';
export const TREASURE_NAME: Record<TreasureKind, Record<Lang, string>> = {
  shard: { zh_tw: '紫水晶碎片', ja_jp: 'アメジストのかけら', en_us: 'an amethyst shard' },
  feather: { zh_tw: '小羽毛', ja_jp: '小さなはね', en_us: 'a little feather' },
  bead: { zh_tw: '亮晶晶的玻璃珠', ja_jp: 'きらきらのビーズ', en_us: 'a shiny bead' },
};
const TREASURE_KEY = 'fairypocket.lifetreasures.v1';
export type Treasures = Partial<Record<TreasureKind, number>>;
export function loadTreasures(storage: Pick<Storage, 'getItem'> = browserStorage()): Treasures {
  try {
    const o = JSON.parse(storage.getItem(TREASURE_KEY) ?? '{}') as Treasures;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}
export function saveTreasures(t: Treasures, storage: Pick<Storage, 'setItem'> = browserStorage()): void {
  try {
    storage.setItem(TREASURE_KEY, JSON.stringify(t));
  } catch {
    /* 存不了也沒關係 */
  }
}
export function treasureCount(t: Treasures): number {
  return Object.values(t).reduce((s, n) => s + (n ?? 0), 0);
}
/** 給 AI 看的收藏清單（例如「小羽毛×2」） */
export function treasureList(t: Treasures, lang: Lang): string[] {
  return (Object.entries(t) as [TreasureKind, number][]).filter(([, n]) => n > 0).map(([k, n]) => (n > 1 ? `${TREASURE_NAME[k][lang]}×${n}` : TREASURE_NAME[k][lang]));
}
