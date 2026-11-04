// 悅靈的記憶（離線、存在存檔裡）：記得你餵過什麼、上次一起玩是什麼時候、
// 連續見面幾天，以及值得紀念的次數（第 100 次摸摸…）。對話會依這些記憶挑話題。

import { FOOD_IDS, type Food, type PetState } from './state';

export interface Memory {
  /** 每種食物吃過幾次 */
  foods: Partial<Record<Food, number>>;
  lastFood: Food | null;
  lastFoodAt: number;
  lastPlayAt: number;
  lastDanceAt: number;
  /** 上次見面的日期（本地時間 YYYY-MM-DD） */
  lastDay: string;
  /** 連續見面天數 */
  streak: number;
  /** 一共見過幾天 */
  days: number;
  /** 已經慶祝過的紀念（例如 petted:100） */
  told: string[];
}

const DAY = 86400_000;

export function emptyMemory(): Memory {
  return { foods: {}, lastFood: null, lastFoodAt: 0, lastPlayAt: 0, lastDanceAt: 0, lastDay: '', streak: 0, days: 0, told: [] };
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** 從存檔讀回記憶（舊存檔沒有就從零開始） */
export function parseMemory(v: unknown): Memory {
  const m = (v ?? {}) as Partial<Memory>;
  const foods: Memory['foods'] = {};
  for (const f of FOOD_IDS) if (num(m.foods?.[f])) foods[f] = Math.round(num(m.foods?.[f]));
  return {
    foods,
    lastFood: FOOD_IDS.includes(m.lastFood as Food) ? (m.lastFood as Food) : null,
    lastFoodAt: num(m.lastFoodAt),
    lastPlayAt: num(m.lastPlayAt),
    lastDanceAt: num(m.lastDanceAt),
    lastDay: typeof m.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.lastDay) ? m.lastDay : '',
    streak: Math.round(num(m.streak)),
    days: Math.round(num(m.days)),
    told: Array.isArray(m.told) ? m.told.filter((x): x is string => typeof x === 'string').slice(-100) : [],
  };
}

export function dayKey(now = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 記下今天見面了；回傳是不是今天第一次見面 */
export function visitDay(m: Memory, now = Date.now()): boolean {
  const today = dayKey(now);
  if (m.lastDay === today) return false;
  m.streak = m.lastDay === dayKey(now - DAY) ? m.streak + 1 : 1;
  m.days++;
  m.lastDay = today;
  return true;
}

export function rememberFood(m: Memory, f: Food, now = Date.now()): void {
  m.foods[f] = (m.foods[f] ?? 0) + 1;
  m.lastFood = f;
  m.lastFoodAt = now;
}

/** 最常吃的食物（至少吃過 3 次才算） */
export function mostEaten(m: Memory): Food | null {
  let best: Food | null = null;
  for (const f of FOOD_IDS) if ((m.foods[f] ?? 0) >= 3 && (!best || m.foods[f]! > m.foods[best]!)) best = f;
  return best;
}

export type TimeOfDay = 'greetMorning' | 'greetAfternoon' | 'greetEvening';

export function timeGreeting(now = Date.now()): TimeOfDay {
  const h = new Date(now).getHours();
  return h >= 5 && h < 11 ? 'greetMorning' : h >= 11 && h < 17 ? 'greetAfternoon' : 'greetEvening';
}

export type MemoryLine = 'remFood' | 'mostFood' | 'missPlay' | 'missDance' | 'streak' | 'together';
export type MilestoneLine = 'mFed' | 'mPetted' | 'mPlayed' | 'mDays' | 'mStreak';

/** 紀念次數：達到時慶祝一次 */
const MILESTONES: [MilestoneLine, (s: PetState) => number, number[]][] = [
  ['mFed', (s) => s.stats.fed, [10, 50, 100, 300, 1000]],
  ['mPetted', (s) => s.stats.petted, [20, 100, 500, 1000]],
  ['mPlayed', (s) => s.stats.played, [10, 50, 200, 500]],
  ['mDays', (s) => s.memory.days, [3, 7, 30, 100, 365]],
  ['mStreak', (s) => s.memory.streak, [3, 7, 14, 30]],
];

/** 有沒有剛達成、還沒慶祝的紀念；有的話記下並回傳 */
export function takeMilestone(s: PetState, only?: MilestoneLine[]): { kind: MilestoneLine; n: number } | null {
  for (const [kind, get, steps] of MILESTONES) {
    if (only && !only.includes(kind)) continue;
    const v = get(s);
    for (const n of steps) {
      const key = `${kind}:${n}`;
      if (v >= n && !s.memory.told.includes(key)) {
        // 一次補上所有已經超過的門檻，只慶祝最高的那個
        const reached = steps.filter((x) => v >= x);
        for (const x of reached) if (!s.memory.told.includes(`${kind}:${x}`)) s.memory.told.push(`${kind}:${x}`);
        return { kind, n: reached[reached.length - 1] };
      }
    }
  }
  return null;
}

/** 依記憶找一個可以聊的話題 */
export function memoryTopic(s: PetState, now = Date.now(), rnd = Math.random): { kind: MemoryLine; food?: Food; d?: number } | null {
  const m = s.memory;
  const opts: { kind: MemoryLine; food?: Food; d?: number }[] = [];
  if (m.lastFood && now - m.lastFoodAt < 2 * DAY && now - m.lastFoodAt > 30 * 60_000) opts.push({ kind: 'remFood', food: m.lastFood });
  const most = mostEaten(m);
  if (most) opts.push({ kind: 'mostFood', food: most });
  if (m.lastPlayAt && now - m.lastPlayAt > DAY) opts.push({ kind: 'missPlay' });
  if (m.lastDanceAt && now - m.lastDanceAt > DAY) opts.push({ kind: 'missDance' });
  if (m.streak >= 2) opts.push({ kind: 'streak', d: m.streak });
  const together = Math.floor((now - s.createdAt) / DAY) + 1;
  if (together >= 2) opts.push({ kind: 'together', d: together });
  return opts.length ? opts[Math.floor(rnd() * opts.length)] : null;
}
