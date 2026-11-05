// 用 Google Gemini 語音（Achernar，請它扮演五歲左右的小女孩，再把音調調高 2 個半音）重做悅靈的聲音檔。
// 金鑰放在 private/google-ai.txt（private/ 不會上傳）。免費方案每天能請求的次數很少，
// 所以一次請它念好幾十句、中間停頓，再依照停頓自動切成一句一句。
// 做好的句子會記在 public/voice/manifest.json，額度用完就停，明天重跑會從沒做完的地方接著做。
//
//   node scripts/make-voices-google.mjs            接著做（中文 → 日文 → 英文）
//   node scripts/make-voices-google.mjs --status   只看進度
//   node scripts/make-voices-google.mjs --max 2    這次最多請求 2 次（測試用）

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { LANGS, loadVoiceJobs } from './voice-jobs.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const KEY_FILE = path.join(ROOT, 'private/google-ai.txt');
const OUT = path.join(ROOT, 'public/voice');
const REVIEW = path.join(ROOT, 'private/voice-samples/google/檢查-全部.html');
const MODEL = 'gemini-2.5-flash-preview-tts';

/** 聲音設定（改了這裡，hash 會變，就會全部重做） */
export const GOOGLE = {
  version: 'g1',
  voice: 'Achernar',
  semitones: 2,
  style: {
    zh_tw: '請用台灣口音的國語（絕對不要大陸腔、不要捲舌兒化音），扮演一個五歲的台灣小女孩：聲音稚嫩、高高的、奶聲奶氣、天真可愛，咬字有點小朋友的感覺。',
    ja_jp: '標準的な日本語で、明るく元気な小さい女の子（五歳くらい）として、かわいく、はっきり読んでください。',
    en_us: 'Read in clear American English as a cheerful, cute little girl about five years old, speaking clearly.',
  },
  rule: {
    zh_tw: '下面每一行是一句話，請一行一行照順序念，念完一句停頓大約兩秒再念下一句。不要念出編號，也不要加任何其他的話：',
    ja_jp: '下の各行を順番に一行ずつ読み、一行読み終わるたびに約二秒あけてください。番号やほかの言葉は加えないでください：',
    en_us: 'Read each line below in order, one at a time, pausing about two seconds after each line. Do not add numbers or any other words:',
  },
};
const MAX_LINES = 24;
const MAX_CHARS = 320;
const RATE = 24000;

// ---------- 小工具 ----------
function readKey() {
  const key = (fs.readFileSync(KEY_FILE, 'utf8').match(/^key\s*=\s*(\S+)/m) ?? [])[1];
  if (!key) throw new Error(`還沒有金鑰：請在 ${KEY_FILE} 填上 key=`);
  return key;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadLame() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'node_modules/lamejs/lame.all.js'), 'utf8') + ';this.L=lamejs;', ctx);
  return ctx.L;
}
const lame = loadLame();
function mp3(samples) {
  const enc = new lame.Mp3Encoder(1, RATE, 48);
  const parts = [];
  for (let i = 0; i < samples.length; i += 1152) parts.push(Buffer.from(enc.encodeBuffer(samples.subarray(i, i + 1152))));
  parts.push(Buffer.from(enc.flush()));
  return Buffer.concat(parts);
}

/** 升高音調（重新取樣，會稍微變快） */
function shift(x, semis) {
  if (!semis) return x;
  const f = 2 ** (semis / 12);
  const m = Math.floor(x.length / f);
  const out = new Int16Array(m);
  for (let i = 0; i < m; i++) {
    const p = i * f, j = Math.floor(p), t = p - j;
    const a = x[j], b = j + 1 < x.length ? x[j + 1] : a;
    out[i] = Math.round(a + (b - a) * t);
  }
  return out;
}

/** 這句話大概要念多久的「份量」（中日文算字數，英文算字母） */
function weight(lang, text) {
  const t = text.replace(/[\s！!？?。，、,.…~～「」『』（）()：:；;「」—\-]/g, '');
  return Math.max(1, lang === 'en_us' ? t.length * 0.3 : t.length);
}

/**
 * 依照停頓把一段聲音切成 n 句：找出最長的 n-1 段安靜當分界，
 * 再檢查每句長度和字數的比例合不合理（不合理就回傳 null，交給呼叫的人把這批拆小重做）。
 */
function split(pcm, n, weights) {
  const FR = RATE / 100; // 10ms
  const frames = Math.floor(pcm.length / FR);
  const rms = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * FR; i < (f + 1) * FR; i++) s += pcm[i] * pcm[i];
    rms[f] = Math.sqrt(s / FR);
    peak = Math.max(peak, rms[f]);
  }
  const thr = Math.max(peak * 0.04, 120);
  const loud = (f) => rms[f] > thr;
  let first = 0;
  while (first < frames && !loud(first)) first++;
  let last = frames - 1;
  while (last > first && !loud(last)) last--;
  if (first >= last) return null;
  // 中間的安靜段
  const gaps = [];
  for (let f = first; f <= last; ) {
    if (loud(f)) { f++; continue; }
    const s = f;
    while (f <= last && !loud(f)) f++;
    gaps.push({ s, e: f, len: f - s });
  }
  if (gaps.length < n - 1) return null;
  const cut = [...gaps].sort((a, b) => b.len - a.len).slice(0, n - 1);
  if (n > 1 && cut[n - 2].len < 25) return null; // 分界至少要停 0.25 秒
  cut.sort((a, b) => a.s - b.s);
  const bounds = [first, ...cut.flatMap((g) => [g.s, g.e]), last + 1];
  const segs = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, bounds[i * 2] - 6) * FR;
    const b = Math.min(frames, bounds[i * 2 + 1] + 8) * FR;
    segs.push(pcm.slice(a, b));
  }
  // 每句「秒數 ÷ 份量」要差不多（漏念、多念、切錯時會差很多）
  const rates = segs.map((s, i) => s.length / RATE / (weights[i] + 1)); // +1：每句都有固定的起音和收尾
  const mid = [...rates].sort((a, b) => a - b)[Math.floor(n / 2)];
  const short = weights.every((w) => w <= 2);
  for (const [i, r] of rates.entries()) {
    const d = segs[i].length / RATE;
    if (d < 0.2 || d > 12) return null;
    if (n > 1 && !short && (r < mid * 0.35 || r > mid * 2.8)) return null;
  }
  // 頭尾淡入淡出，避免爆音
  for (const s of segs) {
    const k = Math.min(120, s.length >> 2);
    for (let i = 0; i < k; i++) {
      s[i] = Math.round((s[i] * i) / k);
      s[s.length - 1 - i] = Math.round((s[s.length - 1 - i] * i) / k);
    }
  }
  return segs;
}

class QuotaError extends Error {}

let lastCall = 0;
async function synth(key, lang, lines) {
  const text = `${GOOGLE.style[lang]}${GOOGLE.rule[lang]}\n${lines.join('\n')}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCall + 21000 - Date.now(); // 每分鐘最多 3 次
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GOOGLE.voice } } } },
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 429) {
      const msg = JSON.stringify(j);
      if (/PerDay|per day|daily/i.test(msg)) throw new QuotaError(msg.slice(0, 300));
      console.log('  每分鐘次數到了，等一下…');
      await sleep(65000);
      continue;
    }
    if (res.status >= 500) {
      await sleep(15000);
      continue;
    }
    if (!res.ok) throw new Error(`Google 回應 ${res.status}：${JSON.stringify(j).slice(0, 300)}`);
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) {
      await sleep(5000);
      continue;
    }
    const b = Buffer.from(part.inlineData.data, 'base64');
    return new Int16Array(b.buffer, b.byteOffset, b.length >> 1).slice();
  }
  throw new Error('Google 一直沒有回應聲音，晚點再試');
}

const idOf = (lang, text) =>
  createHash('sha1').update(`${GOOGLE.version}|${GOOGLE.voice}|${GOOGLE.semitones}|${GOOGLE.style[lang]}|${lang}|${text}`).digest('hex').slice(0, 12);

// ---------- 主程式 ----------
const { jobs, letterOf } = await loadVoiceJobs();
const manPath = path.join(OUT, 'manifest.json');
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
const relOf = (lang, text) => `${lang}/g-${idOf(lang, text)}.mp3`;
const isDone = (k, { lang, text }) => man.clips[k] === relOf(lang, text) && fs.existsSync(path.join(OUT, relOf(lang, text)));

const todo = Object.fromEntries(LANGS.map((l) => [l, []]));
for (const [k, j] of jobs) if (!isDone(k, j)) todo[j.lang].push({ k, ...j });

function status() {
  for (const l of LANGS) {
    const all = [...jobs.values()].filter((j) => j.lang === l).length;
    console.log(`${l}：${all - todo[l].length}/${all} 句已是 Google 聲音`);
  }
}
status();
if (process.argv.includes('--status')) process.exit(0);

function save() {
  man.google = { voice: GOOGLE.voice, semitones: GOOGLE.semitones, version: GOOGLE.version };
  fs.writeFileSync(manPath, JSON.stringify(man, null, 0));
}

/** 檢查用的頁面：每一句都可以點來聽 */
function review() {
  const rows = [...jobs].filter(([k, j]) => isDone(k, j));
  fs.mkdirSync(path.dirname(REVIEW), { recursive: true });
  const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  fs.writeFileSync(
    REVIEW,
    `<!doctype html><meta charset="utf-8"><title>Google 語音檢查</title><style>body{font-family:sans-serif;max-width:900px;margin:20px auto;padding:0 16px}button{font-size:15px;margin:3px;padding:5px 9px}</style>
<h1>Google 語音（全部 ${rows.length} 句）</h1>
${LANGS.map((l) => `<h2>${l}</h2>` + rows.filter(([, j]) => j.lang === l).map(([k, j]) => `<button onclick="new Audio('../../../public/voice/${man.clips[k]}').play()">▶ ${esc(j.text)}</button>`).join('')).join('\n')}`,
  );
}

const key = readKey();
const maxIdx = process.argv.indexOf('--max');
let budget = maxIdx > 0 ? Number(process.argv[maxIdx + 1]) : Infinity;
let made = 0;

/** 送給 Google 念的文字（英文字母念法改成字母本身） */
const spoken = (j) => (j.lang === 'en_us' && letterOf[j.text] ? `${letterOf[j.text]}.` : j.text);

try {
  for (const lang of LANGS) {
    // 分批：每批最多 MAX_LINES 句、MAX_CHARS 字
    const queue = [];
    let cur = [];
    let chars = 0;
    for (const j of todo[lang]) {
      if (cur.length && (cur.length >= MAX_LINES || chars + j.text.length > MAX_CHARS)) {
        queue.push(cur);
        cur = [];
        chars = 0;
      }
      cur.push(j);
      chars += j.text.length;
    }
    if (cur.length) queue.push(cur);

    while (queue.length) {
      if (budget <= 0) throw new QuotaError('這次設定的次數用完了');
      const batch = queue.shift();
      budget--;
      const pcm = await synth(key, lang, batch.map(spoken));
      const segs = split(pcm, batch.length, batch.map((j) => weight(lang, spoken(j))));
      if (!segs) {
        // 切不準：拆成兩半重做（一句的話就再試一次）
        console.log(`  ${lang} 這批 ${batch.length} 句切不準，拆小重做`);
        if (batch.length > 1) queue.unshift(batch.slice(0, batch.length >> 1), batch.slice(batch.length >> 1));
        else if (!batch[0].retried) queue.unshift([{ ...batch[0], retried: true }]);
        else console.log(`  放棄：${batch[0].text}`);
        continue;
      }
      for (const [i, j] of batch.entries()) {
        const rel = relOf(lang, j.text);
        fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
        fs.writeFileSync(path.join(OUT, rel), mp3(shift(segs[i], GOOGLE.semitones)));
        const prev = man.clips[j.k];
        man.clips[j.k] = rel;
        // 舊的（微軟或舊版 Google）檔案沒用了就刪掉
        if (prev && prev !== rel && !Object.values(man.clips).includes(prev) && fs.existsSync(path.join(OUT, prev))) fs.rmSync(path.join(OUT, prev));
        made++;
      }
      save();
      console.log(`✓ ${lang} ${batch.length} 句（${batch[0].text} …）`);
    }
  }
  console.log('全部完成！');
} catch (e) {
  if (!(e instanceof QuotaError)) throw e;
  console.log(`今天的額度用完了，先停在這裡（${e.message.slice(0, 120)}）。明天再跑一次就會接著做。`);
} finally {
  save();
  review();
  console.log(`這次做了 ${made} 句`);
}
