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
export const NAME_MAX = 12;

export interface PetState {
  version: 1;
  name: string;
  personality: Personality;
  health: number;
  hunger: number;
  energy: number;
  affection: number;
  asleep: boolean;
  onboarded: boolean;
  createdAt: number;
  lastSeen: number;
  stats: { fed: number; petted: number; played: number };
  /** 跳舞時給紫水晶碎片複製出來的悅靈數量 */
  friends: number;
}

/** 最多能複製出幾隻悅靈夥伴 */
export const MAX_FRIENDS = 3;

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

export function createPet(now = Date.now()): PetState {
  return {
    version: 1,
    name: '小悅',
    personality: 'playful',
    health: MAX_HEALTH,
    hunger: 16,
    energy: 90,
    affection: 10,
    asleep: false,
    onboarded: false,
    createdAt: now,
    lastSeen: now,
    stats: { fed: 0, petted: 0, played: 0 },
    friends: 0,
  };
}

/** 個性對睡意的倍率 */
export function sleepiness(p: Personality): number {
  return p === 'cautious' ? 1.3 : p === 'brave' ? 0.85 : p === 'playful' ? 1.1 : 1;
}

export function isNight(date = new Date()): boolean {
  const h = date.getHours();
  return h >= 22 || h < 6;
}

/** App 關閉期間經過的時間：溫和地消耗飽食度，並假設悅靈有休息 */
export function applyElapsed(s: PetState, ms: number): PetState {
  if (!(ms > 0)) return s;
  const minutes = ms / 60000;
  const floor = Math.min(s.hunger, 6); // 離線期間不會餓到 6 以下（若原本更低則維持）
  s.hunger = clamp(s.hunger - minutes / 30, floor, MAX_HUNGER);
  s.energy = clamp(s.energy + minutes * 20, 0, MAX_ENERGY);
  if (s.hunger >= 17) s.health = clamp(s.health + minutes / 5, 0, MAX_HEALTH);
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
}

export function feed(s: PetState, food: Food): 'ok' | 'full' {
  if (s.hunger >= MAX_HUNGER - 0.5) return 'full';
  const f = FOODS[food];
  s.hunger = clamp(s.hunger + f.hunger, 0, MAX_HUNGER);
  s.health = clamp(s.health + f.health, 0, MAX_HEALTH);
  s.affection = clamp(s.affection + (FAVORITE_FOOD[s.personality] === food ? 6 : 3), 0, MAX_AFFECTION);
  s.stats.fed++;
  return 'ok';
}

export function pet(s: PetState): void {
  s.affection = clamp(s.affection + 1.5, 0, MAX_AFFECTION);
  s.stats.petted++;
}

export function play(s: PetState): void {
  s.affection = clamp(s.affection + 4, 0, MAX_AFFECTION);
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
