// 悅靈的數值狀態。純函式為主，方便單元測試。

export type Personality = 'guardian' | 'brave' | 'cautious' | 'playful';

export const PERSONALITY_IDS: Personality[] = ['guardian', 'brave', 'cautious', 'playful'];

/** 個性代表色：用於原版彩色粉塵粒子與發光輪廓 */
export const PERSONALITY_COLOR: Record<Personality, string> = {
  guardian: '#8fd6ff', // 淺藍
  brave: '#ffb238', // 金橘
  cautious: '#9fe89a', // 淺綠
  playful: '#e6a2ff', // 粉紫
};

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_ENERGY = 100;
export const MAX_AFFECTION = 100;
export const MAX_MOOD = 100;
export const NAME_MAX = 12;

export interface PetState {
  version: 1;
  /** 這隻悅靈的 ID：同一個 ID 在不同裝置上就是同一隻，可以互相連動 */
  id: string;
  name: string;
  personality: Personality;
  health: number;
  hunger: number;
  energy: number;
  affection: number;
  /** 心情 0–100：照顧、陪玩會變好；肚子餓、很久沒理牠會變差 */
  mood: number;
  asleep: boolean;
  onboarded: boolean;
  createdAt: number;
  lastSeen: number;
  stats: { fed: number; petted: number; played: number };
  /** 物品欄裡每種食物的數量（會隨時間慢慢補充） */
  bag: Record<Food, number>;
  /** 上次補充食物的時間 */
  bagAt: number;
}

/** 跳舞時給紫水晶碎片會暫時複製出一隻夥伴，陪你 5 分鐘後飛走（不存檔、不會一直多一隻） */
export const MAX_FRIENDS = 1;
export const FRIEND_STAY_MS = 5 * 60_000;

/** 背包裡的食物；飢餓度回復量與原版相同，圖示為 textures/item/<id>.png，名稱見 i18n.ts */
export const FOODS = {
  apple: { hunger: 4, health: 2, color: '#e0303a' },
  bread: { hunger: 5, health: 1, color: '#c48a3a' },
  cookie: { hunger: 2, health: 1, color: '#b0743a' },
  carrot: { hunger: 3, health: 1, color: '#f08a20' },
  baked_potato: { hunger: 5, health: 1, color: '#d8a850' },
  sweet_berries: { hunger: 2, health: 1, color: '#c02040' },
  glow_berries: { hunger: 2, health: 1, color: '#f8b030' },
  melon_slice: { hunger: 2, health: 1, color: '#e04848' },
  cooked_chicken: { hunger: 6, health: 2, color: '#d89048' },
  pumpkin_pie: { hunger: 8, health: 2, color: '#e09030' },
  honey_bottle: { hunger: 6, health: 2, color: '#f8c030' },
  golden_carrot: { hunger: 6, health: 4, color: '#f8d848' },
  golden_apple: { hunger: 4, health: 10, color: '#f8d020' },
} as const;
export type Food = keyof typeof FOODS;
export const FOOD_IDS = Object.keys(FOODS) as Food[];

/** 每種食物最多幾個（金色的比較珍貴） */
export function bagMax(f: Food): number {
  return f === 'golden_apple' ? 4 : f === 'golden_carrot' ? 8 : 16;
}

export function fullBag(): Record<Food, number> {
  return Object.fromEntries(FOOD_IDS.map((f) => [f, bagMax(f)])) as Record<Food, number>;
}

/** 每 10 分鐘每種食物補 1 個（App 關著時也會補） */
export const BAG_REFILL_MS = 10 * 60_000;

export function refillBag(s: PetState, now = Date.now()): void {
  const n = Math.floor((now - s.bagAt) / BAG_REFILL_MS);
  if (n <= 0) return;
  for (const f of FOOD_IDS) s.bag[f] = Math.min(bagMax(f), s.bag[f] + n);
  s.bagAt += n * BAG_REFILL_MS;
}

/** 每種個性最喜歡的食物（吃到時好感度加更多） */
export const FAVORITE_FOOD: Record<Personality, Food> = {
  guardian: 'bread',
  brave: 'cooked_chicken',
  cautious: 'honey_bottle',
  playful: 'cookie',
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 例如 K7QM-3XWD（不含容易看錯的 0/O、1/I/L） */
export function newPetId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(b, (x) => ID_CHARS[x % ID_CHARS.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function createPet(now = Date.now()): PetState {
  return {
    version: 1,
    id: newPetId(),
    name: '小悅',
    personality: 'playful',
    health: MAX_HEALTH,
    hunger: 16,
    energy: 90,
    affection: 10,
    mood: 70,
    asleep: false,
    onboarded: false,
    createdAt: now,
    lastSeen: now,
    stats: { fed: 0, petted: 0, played: 0 },
    bag: fullBag(),
    bagAt: now,
  };
}

/** 個性對睡意的倍率 */
export function sleepiness(p: Personality): number {
  return p === 'cautious' ? 1.3 : p === 'brave' ? 0.85 : p === 'playful' ? 1.1 : 1;
}

/** 作息：就寢時間（時）到起床時間（就寢 + 8 小時）之間是晚上 */
export const BEDTIMES = [20, 21, 22, 23] as const;
export type Bedtime = (typeof BEDTIMES)[number];
export const SLEEP_HOURS = 8;

export function wakeHour(bed: Bedtime): number {
  return (bed + SLEEP_HOURS) % 24;
}

export function isNight(date = new Date(), bed: Bedtime = 22): boolean {
  const h = date.getHours() + date.getMinutes() / 60;
  const wake = wakeHour(bed);
  return bed > wake ? h >= bed || h < wake : h >= bed && h < wake;
}

/** 心情階段：0 = 低落、1 = 普通、2 = 開心 */
export function moodLevel(m: number): 0 | 1 | 2 {
  return m < 30 ? 0 : m > 70 ? 2 : 1;
}

/** 讓心情變好（或變差，n 為負） */
export function cheer(s: PetState, n: number): void {
  s.mood = clamp(s.mood + n, 0, MAX_MOOD);
}

/** 離開多久的重逢反應：greet < 1 小時、welcomeBack < 8 小時、missed < 3 天、longAway 以上 */
export function reunionKind(ms: number): 'greet' | 'welcomeBack' | 'missed' | 'longAway' {
  const h = ms / 3600_000;
  return h < 1 ? 'greet' : h < 8 ? 'welcomeBack' : h < 72 ? 'missed' : 'longAway';
}

/** App 關閉期間經過的時間：溫和地消耗飽食度，並假設悅靈有休息 */
export function applyElapsed(s: PetState, ms: number): PetState {
  if (!(ms > 0)) return s;
  const minutes = ms / 60000;
  const floor = Math.min(s.hunger, 6); // 離線期間不會餓到 6 以下（若原本更低則維持）
  s.hunger = clamp(s.hunger - minutes / 30, floor, MAX_HUNGER);
  s.energy = clamp(s.energy + minutes * 20, 0, MAX_ENERGY);
  if (s.hunger >= 17) s.health = clamp(s.health + minutes / 5, 0, MAX_HEALTH);
  // 不在身邊時會慢慢想你：心情下降，但不會低於 25（原本更低則維持）
  s.mood = clamp(s.mood - minutes / 20, Math.min(s.mood, 25), MAX_MOOD);
  return s;
}

/** 遊戲進行中每幀呼叫 */
export function tickPet(s: PetState, dt: number, night: boolean): void {
  if (s.asleep) {
    s.hunger -= dt / 240;
    s.energy += dt * 0.8;
  } else {
    s.hunger -= dt / 120;
    s.energy -= dt * 0.1 * (night ? 1.6 : 1) * sleepiness(s.personality);
  }
  if (s.hunger >= 17 && s.health < MAX_HEALTH) s.health += dt / 15;
  if (s.hunger <= 0) s.health = Math.max(1, s.health - dt / 30);
  s.hunger = clamp(s.hunger, 0, MAX_HUNGER);
  s.energy = clamp(s.energy, 0, MAX_ENERGY);
  s.health = clamp(s.health, 1, MAX_HEALTH);
  // 心情：肚子餓、很睏時變差；睡覺時慢慢回到平穩；平常也會隨時間慢慢想要人陪
  if (s.asleep) s.mood += (60 - s.mood) * dt * 0.002;
  else s.mood -= dt / 150 + (s.hunger < 6 ? dt / 40 : 0) + (s.energy < 20 ? dt / 90 : 0);
  s.mood = clamp(s.mood, 0, MAX_MOOD);
}

export function feed(s: PetState, food: Food): 'ok' | 'full' {
  if (s.hunger >= MAX_HUNGER - 0.5) return 'full';
  const f = FOODS[food];
  s.hunger = clamp(s.hunger + f.hunger, 0, MAX_HUNGER);
  s.health = clamp(s.health + f.health, 0, MAX_HEALTH);
  const fav = FAVORITE_FOOD[s.personality] === food;
  s.affection = clamp(s.affection + (fav ? 6 : 3), 0, MAX_AFFECTION);
  cheer(s, fav ? 12 : 6);
  s.stats.fed++;
  return 'ok';
}

export function pet(s: PetState): void {
  s.affection = clamp(s.affection + 1.5, 0, MAX_AFFECTION);
  cheer(s, 3);
  s.stats.petted++;
}

export function play(s: PetState): void {
  s.affection = clamp(s.affection + 4, 0, MAX_AFFECTION);
  cheer(s, 8);
  s.energy = clamp(s.energy - 3, 0, MAX_ENERGY);
  s.hunger = clamp(s.hunger - 0.5, 0, MAX_HUNGER);
  s.stats.played++;
}

/** 0..20 的數值轉成 10 格圖示：2=滿、1=半、0=空 */
export function toIcons(value: number): number[] {
  const v = Math.round(clamp(value, 0, 20));
  return Array.from({ length: 10 }, (_, i) => clamp(v - i * 2, 0, 2));
}

/** 關係階段 0–3（初識、熟悉、好朋友、形影不離） */
export function affectionLevel(a: number): 0 | 1 | 2 | 3 {
  if (a >= 80) return 3;
  if (a >= 50) return 2;
  if (a >= 20) return 1;
  return 0;
}
