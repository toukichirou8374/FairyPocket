// 聽到（或打字）的話是哪一種語言，以及「說日文」這類換語言的要求。
// 以設定的語言為主：分不出來的時候就當成設定的語言。

import type { Lang } from '../i18n';

/** 這句話是什麼語言：有平假名、片假名 → 日文；幾乎都是英文字母 → 英文；有漢字 → 中文（設定是日文時當成日文） */
export function textLang(text: string, base: Lang): Lang {
  const s = text.replace(/[\s\p{P}\p{S}\d]/gu, '');
  if (!s) return base;
  if (/[\u3040-\u30ff]/.test(s)) return 'ja_jp';
  const latin = (s.match(/[A-Za-z]/g) ?? []).length;
  if (latin / s.length >= 0.6 && !/\p{Script=Han}/u.test(s)) return 'en_us';
  if (/\p{Script=Han}/u.test(s)) return base === 'ja_jp' ? 'ja_jp' : 'zh_tw';
  return base;
}

/** 「說日文」「英語で話して」「speak Chinese」→ 要換的語言；沒有就 null */
export function askedLang(text: string): Lang | null {
  const t = text.toLowerCase();
  if (/(說|講|用|改|換)(成)?(日文|日語|日本話)|日本語で|にほんごで|speak japanese|in japanese/.test(t)) return 'ja_jp';
  if (/(說|講|用|改|換)(成)?(英文|英語)|英語で|えいごで|speak english|in english/.test(t)) return 'en_us';
  if (/(說|講|用|改|換)(成)?(中文|國語|華語)|中国語で|中文で|ちゅうごくごで|speak chinese|in chinese|speak mandarin|in mandarin/.test(t)) return 'zh_tw';
  return null;
}
