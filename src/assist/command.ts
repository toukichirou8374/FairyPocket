// 助理指令：從聽到（或打字）的一句話找出「要悅靈幫忙做的事」。
// 找不到就回傳 null，交給原本的聊天（talk.ts）。

import type { Lang } from '../i18n';

export type MusicApp = 'youtube' | 'ytmusic' | 'nintendo';

export type Command =
  | { kind: 'weather'; day: 0 | 1 }
  | { kind: 'time' }
  | { kind: 'date' }
  | { kind: 'timer'; seconds: number }
  | { kind: 'music'; app: MusicApp | null; query: string }
  | { kind: 'lookup'; query: string };

const ZH_DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const JA_DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const EN_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, half: 0.5,
};

/** 中文、日文數字（阿拉伯數字、一～九十九、半） */
export function parseNumber(s: string): number | null {
  s = s.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === '半') return 0.5;
  const d = { ...ZH_DIGIT, ...JA_DIGIT };
  const m = s.match(/^([一二兩两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0);
  if (s.length === 1 && s in d) return d[s];
  const half = s.match(/^(.+?)(個?半)$/);
  if (half) {
    const n = parseNumber(half[1]);
    return n == null ? null : n + 0.5;
  }
  return null;
}

const NUM = '(\\d+(?:\\.\\d+)?|[零一二兩两三四五六七八九十]+(?:個?半)?|半)';

function timer(text: string, lang: Lang): number | null {
  const unit = (u: string): number => (/秒|sec/i.test(u) ? 1 : /時|hour/i.test(u) ? 3600 : 60);
  if (lang === 'en_us') {
    const m = text.match(/(?:timer for|remind me in|in|alarm for|wake me in|call me in)\s+(\d+|[a-z]+)\s*(seconds?|secs?|minutes?|mins?|hours?)/i);
    if (m && /timer|remind|call|wake|alarm/i.test(text)) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : EN_NUM[m[1].toLowerCase()];
      if (n) return Math.round(n * unit(m[2]));
    }
    const h = text.match(/(?:timer for|remind me in) half an hour/i);
    return h ? 1800 : null;
  }
  if (lang === 'ja_jp') {
    const m = text.match(new RegExp(`${NUM}\\s*(秒|分|時間)(?:後|ご|たったら|経ったら)?.*(?:教えて|知らせて|呼んで|起こして|タイマー)|タイマー.*?${NUM}\\s*(秒|分|時間)`));
    if (!m) return null;
    const n = parseNumber(m[1] ?? m[3]);
    return n ? Math.round(n * unit(m[2] ?? m[4])) : null;
  }
  const m = text.match(new RegExp(`${NUM}\\s*(秒鐘?|分鐘|分|個?小時|個?鐘頭)(?:後|以後|之後)?.*?(?:叫我|提醒我|告訴我|跟我說|喊我)|(?:計時|倒數|設定?.*?計時器?)\\s*${NUM}\\s*(秒鐘?|分鐘|分|個?小時)`));
  if (!m) return null;
  const n = parseNumber(m[1] ?? m[3]);
  return n ? Math.round(n * unit(m[2] ?? m[4])) : null;
}

function musicApp(text: string): MusicApp | null {
  if (/nintendo\s*music|任天堂.?(音樂|ミュージック)|ニンテンドー.?ミュージック/i.test(text)) return 'nintendo';
  if (/(youtube|yt|油管|ユーチューブ)\s*(music|音樂|ミュージック)/i.test(text)) return 'ytmusic';
  if (/youtube|yt\b|油管|ユーチューブ|ようつべ/i.test(text)) return 'youtube';
  return null;
}

/** 把 App 名稱、助詞拿掉，剩下要找的歌名 */
function cleanQuery(q: string): string {
  return q
    .replace(/nintendo\s*music|任天堂.?音樂|ニンテンドー.?ミュージック|youtube\s*music|yt\s*music|youtube|油管|ユーチューブ|\byt\b/gi, '')
    .trim()
    .replace(/^(用|在|從|開|打開|上|で|の|on|in|from|with|by)\s*/i, '')
    .replace(/\s*(上|裡|的歌|的音樂|歌曲|音樂|一下|給我聽|來聽|を|の曲|の音楽|曲|で|on|in|please|for me)$/i, '')
    .replace(/^(一首|首|一下|點|些|個)\s*/, '')
    .replace(/[。！!？?、，,]+$/, '')
    .trim();
}

function music(text: string, lang: Lang): Command | null {
  const app = musicApp(text);
  let m: RegExpMatchArray | null;
  if (lang === 'en_us') {
    m = text.match(/^(?:please\s+)?(?:play|put on|i want to (?:hear|listen to)|let'?s listen to)\s*(.*)$/i);
    if (!m && app && /\bopen\b/i.test(text)) return { kind: 'music', app, query: '' };
    if (!m) return null;
    const q = cleanQuery(m[1].replace(/^(some|a song|the song|music)\b\s*/i, ''));
    return { kind: 'music', app, query: /^(music|songs?)$/i.test(q) ? '' : q };
  }
  if (lang === 'ja_jp') {
    m = text.match(/^(.*?)(?:を|の曲を)?(?:かけて|流して|再生して|聴きたい|聞きたい)/);
    if (!m && app && /開いて|ひらいて/.test(text)) return { kind: 'music', app, query: '' };
    if (!m) return null;
    const q = cleanQuery(m[1]);
    return { kind: 'music', app, query: /^(音楽|曲|なにか|何か)$/.test(q) ? '' : q };
  }
  // 「唱歌給我聽」是要悅靈自己唱，交給聊天
  if (/唱/.test(text) && !app) return null;
  m = text.match(/(?:幫我|請)?(?:播放|播|放|來點|來首|我想聽|我要聽|想聽|聽)\s*(.*)$/);
  if (!m && app && /打開|開啟|開/.test(text)) return { kind: 'music', app, query: '' };
  if (!m) return null;
  if (!app && !/播|音樂|歌/.test(text)) return null;
  const q = cleanQuery(m[1]);
  return { kind: 'music', app, query: /^(音樂|歌|首歌|一首歌|歌曲)?$/.test(q) ? '' : q };
}

/** 不算「查資料」的主詞（你是誰、這是什麼…交給聊天） */
const NOT_TOPIC = /^(你|妳|我|他|她|牠|它|這|那|這個|那個|這裡|那裡|現在|今天|你的名字|名字|悅靈|あなた|わたし|僕|ぼく|これ|それ|あれ|ここ|名前|きみ|君|今|今日|it|this|that|you|your name|me|i|this thing|today|now)$/i;

function lookup(text: string, lang: Lang): string | null {
  let m: RegExpMatchArray | null;
  let q: string | null = null;
  if (lang === 'en_us') {
    m = text.match(/^(?:look up|search(?: for)?|tell me about|google)\s+(.+)$/i) ?? text.match(/^(?:what|who)(?:'s| is| are| was| were)\s+(?:an?\s+|the\s+)?(.+?)\??$/i);
    q = m?.[1] ?? null;
  } else if (lang === 'ja_jp') {
    m = text.match(/^(.+?)(?:って|とは|は)(?:なに|何|なん|だれ|誰|どんな)/) ?? text.match(/^(.+?)(?:を|について)?(?:調べて|検索して|教えて)/);
    q = m?.[1] ?? null;
  } else {
    m =
      text.match(/(?:幫我|請)?(?:查一下|查查|查詢|查|搜尋|搜一下|上網查)\s*(?:一下)?\s*(.+)$/) ??
      text.match(/^(?:什麼是|誰是)\s*(.+?)[？?]?$/) ??
      text.match(/^(.+?)\s*是(?:什麼|甚麼|啥|誰)(?:東西|動物|意思|人)?(?:呀|啊|呢|啦)?[？?]?$/) ??
      text.match(/^(?:告訴我|跟我說|介紹)(?:一下)?(.+?)(?:是什麼|的事)?[？?]?$/);
    q = m?.[1] ?? null;
  }
  if (!q) return null;
  q = q.replace(/[？?。！!]+$/, '').replace(/^(the|a|an)\s+/i, '').replace(/(について|のこと)$/, '').trim();
  if (!q || NOT_TOPIC.test(q) || q.length > 30) return null;
  return q;
}

/** 找出要幫忙做的事（找不到回傳 null） */
export function detectCommand(raw: string, lang: Lang): Command | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  // 天氣
  const weatherZh = /天氣|氣溫|幾度|會不會下雨|會下雨嗎|要不要帶傘|要帶傘嗎|冷不冷|熱不熱/;
  const weatherJa = /天気|気温|何度|雨(が)?降る|傘(が)?(いる|必要)/;
  const weatherEn = /\bweather\b|\btemperature\b|will it rain|is it going to rain|need an umbrella|how (hot|cold) is it/i;
  const w = lang === 'en_us' ? weatherEn : lang === 'ja_jp' ? weatherJa : weatherZh;
  if (w.test(text)) return { kind: 'weather', day: /明天|明日|あした|tomorrow/i.test(text) ? 1 : 0 };
  // 時間、日期
  if (lang === 'en_us' ? /what time is it|what'?s the time|tell me the time/i.test(text) : lang === 'ja_jp' ? /(今|いま)(なん|何)時/.test(text) : /(現在)?幾點(了|鐘)?(呢|啊|呀)?[？?]?$|現在.*幾點|現在時間/.test(text))
    return { kind: 'time' };
  if (lang === 'en_us' ? /what day is (it|today)|what'?s (the|today'?s) date/i.test(text) : lang === 'ja_jp' ? /(今日|きょう)(は)?(何日|なんにち|何曜日|なんようび)/.test(text) : /今天(是)?(幾號|幾月幾號|星期幾|禮拜幾)|今天日期/.test(text))
    return { kind: 'date' };
  const sec = timer(text, lang);
  if (sec) return { kind: 'timer', seconds: Math.min(sec, 24 * 3600) };
  const mus = music(text, lang);
  if (mus) return mus;
  const q = lookup(text, lang);
  if (q) return { kind: 'lookup', query: q };
  return null;
}
