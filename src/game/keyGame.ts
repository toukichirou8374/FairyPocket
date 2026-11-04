// 精靈舞蹈（按鍵遊戲，給小朋友認識鍵盤與控制器按鈕）。
// 不用跟節奏：畫面上出現一個按鍵，按對了就換下一個並加分；按錯了悅靈懊惱，題目不換，直到按對為止。
// 一首歌放完就結束，看這首歌答對幾個。這個檔案只有規則與題目，畫面在 ui/keyGameUI.ts。

import type { Lang } from '../i18n';

export type KeyGameMode = 'keyboard' | 'gamepad' | 'tap' | 'voice' | 'motion';

/** 小遊戲的 3 首輕快歌曲（原版唱片） */
export const KG_SONGS = [
  { id: 'cat', path: 'sounds/records/cat', title: 'C418 - cat' },
  { id: 'chirp', path: 'sounds/records/chirp', title: 'C418 - chirp' },
  { id: 'wait', path: 'sounds/records/wait', title: 'C418 - wait' },
] as const;
export type KgSong = (typeof KG_SONGS)[number]['id'];

/** 一題：要按的按鍵 */
export interface Prompt {
  /** 判定用：鍵盤是 KeyboardEvent.code，控制器是按鈕編號，點一下固定為 'tap' */
  id: string;
  /** 畫面上的大字 */
  label: string;
  /** 下面的小字（名稱），沒有就不顯示 */
  name?: string;
  /** 念出來的字 */
  speak: string;
  /** 控制器按鈕的顏色 */
  color?: string;
}

// ---------- 鍵盤 ----------

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const DIGITS = '0123456789'.split('');

/** 十字鍵的名稱 */
const KEY_NAMES: Record<Lang, Record<string, string>> = {
  zh_tw: { ArrowUp: '上', ArrowDown: '下', ArrowLeft: '左', ArrowRight: '右' },
  ja_jp: { ArrowUp: 'うえ', ArrowDown: 'した', ArrowLeft: 'ひだり', ArrowRight: 'みぎ' },
  en_us: { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' },
};
const ARROWS: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

/** 注音符號在鍵盤上的位置（台灣常用的大千排列，37 個聲母韻母，不含聲調） */
export const ZHUYIN: Record<string, string> = {
  ㄅ: 'Digit1', ㄉ: 'Digit2', ㄓ: 'Digit5', ㄚ: 'Digit8', ㄞ: 'Digit9', ㄢ: 'Digit0', ㄦ: 'Minus',
  ㄆ: 'KeyQ', ㄊ: 'KeyW', ㄍ: 'KeyE', ㄐ: 'KeyR', ㄔ: 'KeyT', ㄗ: 'KeyY', ㄧ: 'KeyU', ㄛ: 'KeyI', ㄟ: 'KeyO', ㄣ: 'KeyP',
  ㄇ: 'KeyA', ㄋ: 'KeyS', ㄎ: 'KeyD', ㄑ: 'KeyF', ㄕ: 'KeyG', ㄘ: 'KeyH', ㄨ: 'KeyJ', ㄜ: 'KeyK', ㄠ: 'KeyL', ㄤ: 'Semicolon',
  ㄈ: 'KeyZ', ㄌ: 'KeyX', ㄏ: 'KeyC', ㄒ: 'KeyV', ㄖ: 'KeyB', ㄙ: 'KeyN', ㄩ: 'KeyM', ㄝ: 'Comma', ㄡ: 'Period', ㄥ: 'Slash',
};

/** 假名在日文鍵盤（JIS かな入力）上的位置：あいうえお 46 音（不含を） */
export const KANA: Record<string, string> = {
  あ: 'Digit3', い: 'KeyE', う: 'Digit4', え: 'Digit5', お: 'Digit6',
  か: 'KeyT', き: 'KeyG', く: 'KeyH', け: 'Quote', こ: 'KeyB',
  さ: 'KeyX', し: 'KeyD', す: 'KeyR', せ: 'KeyP', そ: 'KeyC',
  た: 'KeyQ', ち: 'KeyA', つ: 'KeyZ', て: 'KeyW', と: 'KeyS',
  な: 'KeyU', に: 'KeyI', ぬ: 'Digit1', ね: 'Comma', の: 'KeyK',
  は: 'KeyF', ひ: 'KeyV', ふ: 'Digit2', へ: 'Equal', ほ: 'Minus',
  ま: 'KeyJ', み: 'KeyN', む: 'Backslash', め: 'Slash', も: 'KeyM',
  や: 'Digit7', ゆ: 'Digit8', よ: 'Digit9',
  ら: 'KeyO', り: 'KeyL', る: 'Period', れ: 'Semicolon', ろ: 'IntlRo',
  わ: 'Digit0', ん: 'KeyY',
};

/**
 * 鍵盤題目：英文字母與數字；繁中版再加注音符號、日文版再加假名（英文版只有英文與數字）。
 * 判定用實體按鍵的位置，所以不管有沒有開輸入法都能判斷。
 */
export function keyboardPrompts(lang: Lang): Prompt[] {
  const list: Prompt[] = [
    ...LETTERS.map((c) => ({ id: `Key${c}`, label: c, speak: c })),
    ...DIGITS.map((d) => ({ id: `Digit${d}`, label: d, speak: d })),
  ];
  const extra = lang === 'zh_tw' ? ZHUYIN : lang === 'ja_jp' ? KANA : null;
  if (extra) for (const [ch, code] of Object.entries(extra)) list.push({ id: code, label: ch, speak: ch });
  return list;
}

/** 鍵盤事件對應到題目 id（數字鍵盤的數字也算） */
export function keyId(code: string): string {
  const m = /^Numpad(\d)$/.exec(code);
  if (m) return `Digit${m[1]}`;
  return code;
}

/** 只按 Shift、Ctrl 這類輔助鍵不算按錯 */
export function isModifier(code: string): boolean {
  return /^(Shift|Control|Alt|Meta|CapsLock|Fn|OS)/.test(code) || code === '' || code === 'Unidentified';
}

// ---------- 控制器 ----------

export type PadFamily = 'xbox' | 'playstation' | 'nintendo';

/** 依控制器名稱判斷是哪一家的（按鈕上的字不一樣）；認不出來時以 PS5 為準 */
export function padFamily(id: string): PadFamily {
  const s = id.toLowerCase();
  if (/xbox|045e|xinput/.test(s)) return 'xbox';
  if (/nintendo|switch|pro controller|joy-con|057e/.test(s)) return 'nintendo';
  return 'playstation';
}

/** 標準按鈕編號：0 下、1 右、2 左、3 上（臉部按鈕），4／5 肩鍵，12–15 十字鍵 */
const FACE: Record<PadFamily, { label: string; color: string; speak: Record<Lang, string> }[]> = {
  xbox: [
    { label: 'A', color: '#5cb85c', speak: { zh_tw: 'A', ja_jp: 'A', en_us: 'A' } },
    { label: 'B', color: '#e05050', speak: { zh_tw: 'B', ja_jp: 'B', en_us: 'B' } },
    { label: 'X', color: '#4a90e2', speak: { zh_tw: 'X', ja_jp: 'X', en_us: 'X' } },
    { label: 'Y', color: '#f0c419', speak: { zh_tw: 'Y', ja_jp: 'Y', en_us: 'Y' } },
  ],
  playstation: [
    { label: '✕', color: '#7aa7ff', speak: { zh_tw: '叉叉', ja_jp: 'バツ', en_us: 'Cross' } },
    { label: '○', color: '#ff6b6b', speak: { zh_tw: '圈圈', ja_jp: 'マル', en_us: 'Circle' } },
    { label: '□', color: '#ff8fd0', speak: { zh_tw: '方塊', ja_jp: 'シカク', en_us: 'Square' } },
    { label: '△', color: '#4fd1a5', speak: { zh_tw: '三角形', ja_jp: 'サンカク', en_us: 'Triangle' } },
  ],
  nintendo: [
    { label: 'B', color: '#d0d0d0', speak: { zh_tw: 'B', ja_jp: 'B', en_us: 'B' } },
    { label: 'A', color: '#d0d0d0', speak: { zh_tw: 'A', ja_jp: 'A', en_us: 'A' } },
    { label: 'Y', color: '#d0d0d0', speak: { zh_tw: 'Y', ja_jp: 'Y', en_us: 'Y' } },
    { label: 'X', color: '#d0d0d0', speak: { zh_tw: 'X', ja_jp: 'X', en_us: 'X' } },
  ],
};
const SHOULDER: Record<PadFamily, [string, string]> = { xbox: ['LB', 'RB'], playstation: ['L1', 'R1'], nintendo: ['L', 'R'] };
const DPAD = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** 判定用的按鈕編號 */
export const PAD_BUTTONS = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15];

export function gamepadPrompts(family: PadFamily, lang: Lang): Prompt[] {
  const n = KEY_NAMES[lang];
  const dpadName: Record<Lang, string> = { zh_tw: '十字鍵', ja_jp: '十字キー', en_us: 'D-pad' };
  return [
    ...FACE[family].map((f, i) => ({ id: String(i), label: f.label, speak: f.speak[lang], color: f.color })),
    ...SHOULDER[family].map((s, i) => ({ id: String(4 + i), label: s, speak: s, color: '#9a9a9a' })),
    ...DPAD.map((d, i) => ({ id: String(12 + i), label: ARROWS[d], name: `${dpadName[lang]} ${n[d]}`, speak: n[d], color: '#5a5a5a' })),
  ];
}

// ---------- 出題與計分 ----------

export class KeyRound {
  score = 0;
  misses = 0;
  current: Prompt | null = null;

  constructor(private prompts: Prompt[], private random: () => number = Math.random) {}

  /** 出下一題（不會跟上一題一樣） */
  next(): Prompt {
    const prev = this.current;
    // 不跟上一題一樣（同一個按鍵、或畫面上一樣的字）；過濾完沒有東西就全部都可以
    const others = this.prompts.filter((p) => p.id !== prev?.id && !(p.label && p.label === prev?.label));
    const list = others.length ? others : this.prompts;
    this.current = list[Math.floor(this.random() * list.length)];
    return this.current;
  }

  /** 按下某個按鍵：對了加分回傳 true；錯了題目不換，回傳 false */
  press(id: string): boolean {
    if (!this.current) return false;
    if (id === this.current.id) {
      this.score++;
      return true;
    }
    this.misses++;
    return false;
  }
}

// ---------- 最高紀錄 ----------

const BEST_KEY = 'fairypocket.keygame.v1';

export function loadBest(storage: Pick<Storage, 'getItem'>, mode: KeyGameMode, song: KgSong): number {
  try {
    const d = JSON.parse(storage.getItem(BEST_KEY) ?? '{}') as Record<string, number>;
    return Number(d[`${mode}:${song}`]) || 0;
  } catch {
    return 0;
  }
}

/** 存最高紀錄；破紀錄回傳 true */
export function saveBest(storage: Pick<Storage, 'getItem' | 'setItem'>, mode: KeyGameMode, song: KgSong, score: number): boolean {
  let d: Record<string, number> = {};
  try {
    d = JSON.parse(storage.getItem(BEST_KEY) ?? '{}') as Record<string, number>;
  } catch {
    // 壞掉就重新記
  }
  const k = `${mode}:${song}`;
  if (score <= (Number(d[k]) || 0)) return false;
  d[k] = score;
  storage.setItem(BEST_KEY, JSON.stringify(d));
  return true;
}

// ---------- 開發選項：觸碰測試 ----------

const DEV_TAP_KEY = 'fairypocket.dev.tap.v1';

/** 觸碰測試：所有玩法（鍵盤、控制器、聲音、體感）都可以用點的代替 */
export function loadDevTap(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(DEV_TAP_KEY) === '1';
}

export function saveDevTap(storage: Pick<Storage, 'setItem'>, on: boolean): void {
  storage.setItem(DEV_TAP_KEY, on ? '1' : '0');
}
