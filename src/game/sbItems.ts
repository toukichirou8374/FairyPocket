// 貼紙簿的貼紙清單（精靈舞蹈的聲音玩法也用這份）。
// 字母、注音、假名本身就屬於某種語言，錄音不分語言；其他（數字、圖案、時間）各語言念法不同，錄音依語言分開存。

import type { Lang } from '../i18n';
import { DIGITS, KANA, LETTERS, LETTER_SAY, ZHUYIN, ZHUYIN_READ } from './keyGame';
import { matchesSticker, normalizeSpeech, STICKERS, type Sticker } from './stickers';

export type SbCat = 'letter' | 'digit' | 'zhuyin' | 'kana' | 'animal' | 'vehicle' | 'work' | 'food' | 'sport' | 'building' | 'feeling' | 'color' | 'shape' | 'time';
export const SB_CATS: SbCat[] = ['letter', 'digit', 'zhuyin', 'kana', 'animal', 'vehicle', 'work', 'food', 'sport', 'building', 'feeling', 'color', 'shape', 'time'];

/** 不分語言的類別 */
export const SHARED_CATS: readonly SbCat[] = ['letter', 'zhuyin', 'kana'];
/** 語音辨識很難分辨單一字母、注音、假名：聽到說話就算對 */
const LOOSE_CATS: readonly SbCat[] = ['letter', 'zhuyin', 'kana'];

interface Word {
  /** 貼紙上的大字 */
  face: string;
  /** 下面的小字（也是提示時念的字） */
  name: string;
  /** 語音辨識比對用的其他說法 */
  alias: string[];
}

export interface SbItem {
  id: string;
  cat: SbCat;
  /** 文字貼紙（字母、注音、假名） */
  label?: string;
  /** 圖案貼紙 */
  sticker?: Sticker;
  /** 依語言不同的文字貼紙（數字、月份、星期） */
  words?: Record<Lang, Word>;
}

const w = (face: string, name: string, alias: string[] = []): Word => ({ face, name, alias });

const ZH_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const JA_DIGIT: [string, string[]][] = [
  ['ぜろ', ['れい', 'ゼロ', '零']], ['いち', ['一']], ['に', ['二']], ['さん', ['三']], ['よん', ['し', '四']],
  ['ご', ['五']], ['ろく', ['六']], ['なな', ['しち', '七']], ['はち', ['八']], ['きゅう', ['く', '九']],
];
const EN_DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const JA_MONTH = ['いちがつ', 'にがつ', 'さんがつ', 'しがつ', 'ごがつ', 'ろくがつ', 'しちがつ', 'はちがつ', 'くがつ', 'じゅうがつ', 'じゅういちがつ', 'じゅうにがつ'];
const EN_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 星期（從星期一開始） */
const ZH_DAY = ['一', '二', '三', '四', '五', '六', '日'];
const JA_DAY: [string, string][] = [['月', 'げつ'], ['火', 'か'], ['水', 'すい'], ['木', 'もく'], ['金', 'きん'], ['土', 'ど'], ['日', 'にち']];
const EN_DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function digitItems(): SbItem[] {
  return DIGITS.map((d, i) => ({
    id: `digit:${d}`,
    cat: 'digit' as const,
    words: {
      zh_tw: w(d, ZH_NUM[i], i === 0 ? ['〇'] : i === 2 ? ['兩', '两'] : []),
      ja_jp: w(d, JA_DIGIT[i][0], JA_DIGIT[i][1]),
      en_us: w(d, EN_DIGIT[i], i === 0 ? ['oh'] : i === 2 ? ['to', 'too'] : i === 4 ? ['for'] : i === 8 ? ['ate'] : []),
    },
  }));
}

function timeItems(): SbItem[] {
  const months = EN_MONTH.map((en, i) => ({
    id: `month:${i + 1}`,
    cat: 'time' as const,
    words: {
      zh_tw: w(`${i + 1}月`, `${ZH_NUM[i + 1]}月`, [`${i + 1}月`]),
      ja_jp: w(`${i + 1}月`, JA_MONTH[i], [`${i + 1}月`, `${ZH_NUM[i + 1]}月`]),
      en_us: w(en.slice(0, 3), en),
    },
  }));
  const days = EN_DAY.map((en, i) => {
    const zh = ZH_DAY[i];
    const zhAlias = [`禮拜${zh}`, `礼拜${zh}`, `週${zh}`, `周${zh}`, `星期${zh}`];
    if (zh === '日') zhAlias.push('星期天', '禮拜天', '礼拜天');
    const [jk, jr] = JA_DAY[i];
    return {
      id: `day:${i + 1}`,
      cat: 'time' as const,
      words: {
        zh_tw: w(zh, `星期${zh}`, zhAlias),
        ja_jp: w(jk, `${jr}ようび`, [`${jk}曜日`, `${jk}曜`, `${jr}よう`]),
        en_us: w(en.slice(0, 3), en),
      },
    };
  });
  return [...months, ...days];
}

/** 貼紙簿的全部貼紙（不管語言全部列出） */
export function stickerBookItems(): SbItem[] {
  const pics = (['animal', 'vehicle', 'work', 'food', 'sport', 'building', 'feeling', 'color', 'shape'] as const).flatMap((cat) =>
    STICKERS.filter((s) => s.cat === cat).map((s) => ({ id: `pic:${s.id}`, cat, sticker: s }) as SbItem),
  );
  return [
    ...LETTERS.map((c) => ({ id: `letter:${c}`, cat: 'letter' as const, label: c })),
    ...digitItems(),
    ...Object.keys(ZHUYIN).map((c) => ({ id: `zhuyin:${c}`, cat: 'zhuyin' as const, label: c })),
    ...Object.keys(KANA).map((c) => ({ id: `kana:${c}`, cat: 'kana' as const, label: c })),
    ...pics,
    ...timeItems(),
  ];
}

/** 貼紙上的大字（圖案貼紙沒有） */
export function itemFace(it: SbItem, lang: Lang): string {
  return it.label ?? it.words?.[lang].face ?? '';
}

/** 貼紙下面的小字（字母、注音、假名沒有） */
export function itemName(it: SbItem, lang: Lang): string | undefined {
  return it.sticker?.names[lang] ?? it.words?.[lang].name;
}

/** 悅靈示範發音：要念的字和用哪種語言念（字母用英文、注音用中文、假名用日文） */
export function demoSpeech(it: SbItem, lang: Lang): { text: string; lang: Lang } {
  if (it.cat === 'letter') return { text: LETTER_SAY[it.label ?? ''] ?? it.label ?? '', lang: 'en_us' };
  if (it.cat === 'zhuyin') return { text: ZHUYIN_READ[it.label ?? ''] ?? it.label ?? '', lang: 'zh_tw' };
  if (it.cat === 'kana') return { text: it.label ?? '', lang: 'ja_jp' };
  // 加上「！」念起來比較有精神，不會像在朗讀
  const word = itemName(it, lang) ?? itemFace(it, lang);
  return { text: word + (lang === 'en_us' ? '!' : '！'), lang };
}

export function isShared(it: SbItem): boolean {
  return SHARED_CATS.includes(it.cat);
}

/** 錄音存檔用的名字：不分語言的直接用 id，其他前面加上語言 */
export function clipKey(it: SbItem, lang: Lang): string {
  return isShared(it) ? it.id : `${lang}/${it.id}`;
}

/** 聽到的話裡有沒有說到這張貼紙 */
export function matchesItem(heard: string, it: SbItem, lang: Lang): boolean {
  const h = normalizeSpeech(heard);
  if (!h) return false;
  if (LOOSE_CATS.includes(it.cat)) return true;
  if (it.sticker) return matchesSticker(heard, it.sticker, lang);
  const wd = it.words?.[lang];
  if (!wd) return false;
  // 星期的大字只有一個字（例如「一」），不拿來比對
  const list = [wd.name, ...wd.alias, ...(it.cat === 'digit' ? [wd.face] : [])];
  return list.some((n) => {
    const x = normalizeSpeech(n);
    return !!x && h.includes(x);
  });
}

/**
 * v0.25 的錄音不分語言；v0.26 起數字、圖案貼紙依語言分開。
 * 回傳要改名的錄音：舊的、需要分語言的那些，當作目前語言的錄音。
 */
export function legacyRenames(keys: string[], lang: Lang, items = stickerBookItems()): [string, string][] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: [string, string][] = [];
  for (const k of keys) {
    if (k.includes('/')) continue;
    const it = byId.get(k);
    if (it && !isShared(it)) out.push([k, clipKey(it, lang)]);
  }
  return out;
}

/** 精靈舞蹈聲音玩法：選到的類別裡、目前語言已經錄好的貼紙 */
export function recordedItems(clipKeys: Set<string>, cats: readonly SbCat[], lang: Lang, items = stickerBookItems()): SbItem[] {
  return items.filter((it) => cats.includes(it.cat) && clipKeys.has(clipKey(it, lang)));
}
