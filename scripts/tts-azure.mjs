// AI 生命模式的即時語音（第三階段）：手機送「要念的一句話」，家裡電腦用微軟 Azure 神經語音念成 mp3 回傳。
// - 金鑰只在這台電腦的 private/azure-speech.txt，手機拿不到；不會顯示或寫進紀錄。
// - 只用免費方案（F0，每月 50 萬字）：這裡每月最多用 40 萬字，超過就回 402，手機改用內建語音。
//   F0 超過額度微軟只會拒絕，不會收費。
// - 每分鐘最多 18 次（F0 上限 20 次）、每句最多 150 字。
// - 只念文字，不存聲音檔；用量只記「這個月念了幾個字」（private/tts-usage.json）。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const KEY_FILE = path.join(ROOT, 'private', 'azure-speech.txt');
const USAGE_FILE = path.join(ROOT, 'private', 'tts-usage.json');
const VOICE_FILE = path.join(ROOT, 'private', 'tts-voice.json');
export const MONTH_CAP = 400_000;
const PER_MINUTE = 18;
const MAX_CHARS = 150;
const FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

/** 各語言的聲音（和事先做好的台詞一樣）；試聽後可以在 private/tts-voice.json 改（例如 {"zh_tw":{"voice":"zh-TW-HsiaoYuNeural","pitch":"+10%"}}） */
export const DEFAULT_VOICES = {
  zh_tw: { tag: 'zh-TW', voice: 'zh-TW-HsiaoChenNeural', rate: '-5%', pitch: '+0%' },
  ja_jp: { tag: 'ja-JP', voice: 'ja-JP-AoiNeural', rate: '-5%', pitch: '+0%' },
  en_us: { tag: 'en-US', voice: 'en-US-AnaNeural', rate: '-5%', pitch: '+0%' },
};

/** 心情 → 語速、音高的小調整（百分比） */
const FEEL = {
  happy: { rate: 5, pitch: 6 },
  sad: { rate: -10, pitch: -6 },
  surprised: { rate: 5, pitch: 10 },
  shy: { rate: -5, pitch: 3 },
  sleepy: { rate: -18, pitch: -4 },
};

function readCred() {
  try {
    const txt = fs.readFileSync(KEY_FILE, 'utf8');
    const get = (k) => (txt.match(new RegExp(`^${k}\\s*=\\s*(\\S+)`, 'm')) ?? [])[1];
    const key = get('key');
    const region = get('region');
    return key && region ? { key, region } : null;
  } catch {
    return null;
  }
}

function voices() {
  try {
    const o = JSON.parse(fs.readFileSync(VOICE_FILE, 'utf8'));
    const out = {};
    for (const [lang, v] of Object.entries(DEFAULT_VOICES)) {
      const c = o?.[lang] ?? {};
      const ok = (s, re) => (typeof s === 'string' && re.test(s) ? s : undefined);
      out[lang] = {
        ...v,
        voice: ok(c.voice, /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/) ?? v.voice,
        rate: ok(c.rate, /^[+-]?\d{1,2}%$/) ?? v.rate,
        pitch: ok(c.pitch, /^[+-]?\d{1,2}%$/) ?? v.pitch,
      };
    }
    return out;
  } catch {
    return DEFAULT_VOICES;
  }
}

const month = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
function readUsage() {
  try {
    const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    return u?.month === month() ? u : { month: month(), chars: 0 };
  } catch {
    return { month: month(), chars: 0 };
  }
}
function addUsage(n) {
  const u = readUsage();
  u.chars += n;
  fs.writeFileSync(USAGE_FILE, JSON.stringify(u));
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (base, add) => {
  const n = Math.max(-50, Math.min(50, parseInt(base, 10) + add));
  return `${n >= 0 ? '+' : ''}${n}%`;
};

/** 做 SSML（測試用匯出） */
export function ttsSsml(v, text, feeling) {
  const f = FEEL[feeling] ?? { rate: 0, pitch: 0 };
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${v.tag}"><voice name="${v.voice}"><prosody rate="${pct(v.rate, f.rate)}" pitch="${pct(v.pitch, f.pitch)}">${esc(text)}</prosody></voice></speak>`;
}

/** 念的文字整理：去掉方括號標籤、多餘空白，最多 150 字 */
export function cleanTtsText(t) {
  return String(t ?? '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
}

let windowStart = 0;
let count = 0;

/** POST /api/tts {text, lang, feeling?} → [狀態碼, mp3 Buffer 或錯誤物件] */
export async function tts(body) {
  const lang = body?.lang;
  const v = voices()[lang];
  const text = cleanTtsText(body?.text);
  if (!v || !text) return [400, { error: 'bad_request' }];
  const cred = readCred();
  if (!cred) return [503, { error: 'nokey' }];
  if (readUsage().chars + text.length > MONTH_CAP) return [402, { error: 'budget', scope: 'month' }];
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    count = 0;
  }
  if (++count > PER_MINUTE) return [429, { error: 'busy' }];
  try {
    const res = await fetch(`https://${cred.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': cred.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': FORMAT,
        'User-Agent': 'FairyPocket-life-voice',
      },
      body: ttsSsml(v, text, body?.feeling),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) return [429, { error: 'busy' }];
    // 免費額度用完（或金鑰有問題）：微軟拒絕，不收費；手機改用內建語音
    if (res.status === 401 || res.status === 403) return [503, { error: 'nokey' }];
    if (!res.ok) return [502, { error: 'upstream' }];
    addUsage(text.length);
    return [200, Buffer.from(await res.arrayBuffer())];
  } catch {
    return [502, { error: 'upstream' }];
  }
}

export function ttsStatus() {
  const u = readUsage();
  return { month: u.month, chars: u.chars, cap: MONTH_CAP, ready: !!readCred() };
}
