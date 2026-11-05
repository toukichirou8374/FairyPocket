// 助理用到的外部服務（都免費、不用帳號）：
// 天氣：Open-Meteo（https://open-meteo.com，CC BY 4.0）
// 查資料：維基百科（CC BY-SA 4.0）
// 音樂：打開 YouTube、YouTube Music 的搜尋頁；Nintendo Music 沒有公開的連結，改用「捷徑」打開。

import type { Lang } from '../i18n';
import type { MusicApp } from './command';

// ---------- 位置（只存在這台裝置，只取到約 1 公里的精度） ----------
const POS_KEY = 'fairypocket.assist.pos.v1';

export async function position(): Promise<{ lat: number; lon: number } | null> {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as { lat: number; lon: number; at: number } | null;
    if (saved && Date.now() - saved.at < 6 * 3600_000) return saved;
  } catch {
    /* 沒存過 */
  }
  if (!navigator.geolocation) return null;
  return new Promise((done) =>
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 };
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({ ...pos, at: Date.now() }));
        } catch {
          /* 存不了也沒關係 */
        }
        done(pos);
      },
      () => done(null),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 3600_000 },
    ),
  );
}

// ---------- 天氣 ----------
export interface Weather {
  day: 0 | 1;
  code: number;
  now: number | null;
  max: number;
  min: number;
  rain: number;
}

export async function weather(day: 0 | 1, pos: { lat: number; lon: number }): Promise<Weather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}` +
    '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2';
  try {
    const j = await fetch(url).then((r) => (r.ok ? r.json() : null));
    if (!j?.daily) return null;
    const d = j.daily;
    return {
      day,
      code: day === 0 && j.current ? j.current.weather_code : d.weather_code[day],
      now: day === 0 ? (j.current?.temperature_2m ?? null) : null,
      max: d.temperature_2m_max[day],
      min: d.temperature_2m_min[day],
      rain: d.precipitation_probability_max[day] ?? 0,
    };
  } catch {
    return null;
  }
}

/** 天氣代碼（WMO）→ 文字 */
export function weatherWord(code: number, lang: Lang): string {
  const W: Record<Lang, string[]> = {
    zh_tw: ['是晴天', '是晴時多雲', '是多雲', '是陰天', '會起霧', '會下毛毛雨', '會下雨', '會下大雨', '會下雪', '會有陣雨', '會有雷雨'],
    ja_jp: ['晴れ', '晴れときどきくもり', 'くもり', 'くもり', '霧', '霧雨', '雨', '大雨', '雪', 'にわか雨', '雷雨'],
    en_us: ['sunny', 'mostly sunny', 'partly cloudy', 'cloudy', 'foggy', 'drizzly', 'rainy', 'very rainy', 'snowy', 'showery', 'stormy'],
  };
  const i =
    code === 0 ? 0 : code === 1 ? 1 : code === 2 ? 2 : code === 3 ? 3 : code <= 48 ? 4 : code <= 57 ? 5 : code <= 63 || code === 66 ? 6 : code <= 67 ? 7 : code <= 77 || code === 85 || code === 86 ? 8 : code <= 82 ? 9 : 10;
  return W[lang][i];
}

const r = (n: number): number => Math.round(n);

/** 天氣的回答（悅靈說的話） */
export function weatherLine(w: Weather, lang: Lang): string {
  const word = weatherWord(w.code, lang);
  const tips: string[] = [];
  if (lang === 'zh_tw') {
    if (w.rain >= 50) tips.push('記得帶傘喔！');
    else if (w.max >= 30) tips.push('很熱，要多喝水喔！');
    else if (w.min <= 12) tips.push('有點冷，多穿一件喔！');
    const when = w.day ? '明天' : '今天';
    const now = w.now != null ? `現在${r(w.now)}度，` : '';
    return `${when}${word}，${now}最高${r(w.max)}度、最低${r(w.min)}度，下雨機率${r(w.rain)}%。${tips.join('')}`;
  }
  if (lang === 'ja_jp') {
    if (w.rain >= 50) tips.push('かさを忘れないでね！');
    else if (w.max >= 30) tips.push('暑いから、お水をたくさん飲んでね！');
    else if (w.min <= 12) tips.push('寒いから、一枚多く着てね！');
    const when = w.day ? 'あした' : 'きょう';
    const now = w.now != null ? `今は${r(w.now)}度、` : '';
    return `${when}は${word}。${now}最高${r(w.max)}度、最低${r(w.min)}度、雨の確率は${r(w.rain)}%だよ。${tips.join('')}`;
  }
  if (w.rain >= 50) tips.push("Don't forget your umbrella!");
  else if (w.max >= 30) tips.push("It's hot, drink lots of water!");
  else if (w.min <= 12) tips.push("It's chilly, wear a jacket!");
  const when = w.day ? 'Tomorrow' : 'Today';
  const now = w.now != null ? ` It's ${r(w.now)} degrees now,` : '';
  return `${when} is ${word}.${now} high of ${r(w.max)}, low of ${r(w.min)}, ${r(w.rain)}% chance of rain. ${tips.join('')}`.trim();
}

// ---------- 維基百科 ----------
export interface WikiPage {
  title: string;
  extract: string;
  url: string;
}

const WIKI: Record<Lang, { host: string; variant: string }> = {
  zh_tw: { host: 'zh.wikipedia.org', variant: 'zh-tw' },
  ja_jp: { host: 'ja.wikipedia.org', variant: 'ja' },
  en_us: { host: 'en.wikipedia.org', variant: 'en' },
};

export async function wiki(query: string, lang: Lang): Promise<WikiPage | null> {
  const { host, variant } = WIKI[lang];
  try {
    const s = await fetch(`https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json&origin=*`).then((x) => x.json());
    const title: string | undefined = s?.query?.search?.[0]?.title;
    if (!title) return null;
    const p = await fetch(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { headers: { 'Accept-Language': variant } }).then((x) =>
      x.ok ? x.json() : null,
    );
    if (!p?.extract) return null;
    // 標題用 displaytitle（中文會轉成繁體），去掉 HTML 標籤；內文去掉標點前多出來的空白
    const shown = String(p.displaytitle ?? '').replace(/<[^>]*>/g, '').trim();
    const extract = String(p.extract).replace(/\s+([，。、；：！？）」』])/g, '$1').replace(/([（「『])\s+/g, '$1');
    return { title: shown || p.title || title, extract, url: p.content_urls?.mobile?.page ?? `https://${host}/wiki/${encodeURIComponent(title)}` };
  } catch {
    return null;
  }
}

/** 念出來的部分：前一兩句（太長小朋友聽不完） */
export function firstSentences(text: string, lang: Lang, max = lang === 'en_us' ? 220 : 90): string {
  const parts = text.match(lang === 'en_us' ? /[^.!?]+[.!?]+(\s|$)/g : /[^。！？]+[。！？]?/g) ?? [text];
  let out = '';
  for (const p of parts) {
    if (out && out.length + p.length > max) break;
    out += p;
  }
  // 去掉括號裡的讀音、外文
  return (out || text.slice(0, max)).replace(/\s*[（(][^（）()]*[）)]/g, '').trim();
}

// ---------- 音樂 ----------
/** Nintendo Music 用的捷徑名稱（使用者在「捷徑」App 建一個打開 Nintendo Music 的捷徑） */
export const NINTENDO_SHORTCUT = '悅靈 Nintendo Music';

export function musicUrl(app: MusicApp | null, query: string): string {
  const q = encodeURIComponent(query);
  switch (app) {
    case 'nintendo':
      return `shortcuts://run-shortcut?name=${encodeURIComponent(NINTENDO_SHORTCUT)}${query ? `&input=text&text=${q}` : ''}`;
    case 'youtube':
      return query ? `https://www.youtube.com/results?search_query=${q}` : 'https://www.youtube.com/';
    default:
      return query ? `https://music.youtube.com/search?q=${q}` : 'https://music.youtube.com/';
  }
}
