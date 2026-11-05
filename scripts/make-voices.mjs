// 用微軟 Azure 的神經語音，把「悅靈示範念法」和悅靈固定的台詞先做成聲音檔（public/voice/），App 會優先播這些。
// 金鑰放在 private/azure-speech.txt（private/ 不會上傳）。免費方案（F0）每月 50 萬字，這裡全部做完大約 3 千字。
// 已經做過、文字和聲音都沒變的檔案會跳過，所以重跑不會多花額度。
//
//   node scripts/make-voices.mjs --sample   只做試聽檔（private/voice-samples/，各候選聲音念幾句）
//   node scripts/make-voices.mjs            做全部（public/voice/ 與 manifest.json）

import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const KEY_FILE = path.join(ROOT, 'private/azure-speech.txt');
const OUT = path.join(ROOT, 'public/voice');
const SAMPLE_OUT = path.join(ROOT, 'private/voice-samples');
const FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

/** 每種語言用的聲音（試聽後可以改這裡；改了重跑就會重做） */
export const VOICES = {
  zh_tw: { tag: 'zh-TW', voice: 'zh-TW-HsiaoChenNeural', rate: '-5%', pitch: '+0%' },
  ja_jp: { tag: 'ja-JP', voice: 'ja-JP-AoiNeural', rate: '-5%', pitch: '+0%' },
  en_us: { tag: 'en-US', voice: 'en-US-AnaNeural', rate: '-5%', pitch: '+0%' },
};

/** 試聽用的候選聲音 */
const CANDIDATES = {
  zh_tw: [['zh-TW-HsiaoYuNeural'], ['zh-TW-HsiaoChenNeural'], ['zh-TW-YunJheNeural']],
  ja_jp: [['ja-JP-NanamiNeural', 'cheerful'], ['ja-JP-AoiNeural'], ['ja-JP-MayuNeural'], ['ja-JP-ShioriNeural']],
  en_us: [['en-US-AnaNeural'], ['en-US-JennyNeural', 'cheerful'], ['en-US-AvaNeural'], ['en-US-EmmaNeural']],
};
/** 繁中「比較年輕」的試聽：聲音、音高、速度的組合（--zh-young） */
const ZH_YOUNG = [
  ['zh-TW-HsiaoChenNeural', '', '+0%', '-5%', '曉臻（目前）'],
  ['zh-TW-HsiaoChenNeural', '', '+10%', '0%', '曉臻 音高 +10%'],
  ['zh-TW-HsiaoChenNeural', '', '+18%', '+3%', '曉臻 音高 +18%'],
  ['zh-TW-HsiaoYuNeural', '', '+0%', '-5%', '曉雨'],
  ['zh-TW-HsiaoYuNeural', '', '+10%', '0%', '曉雨 音高 +10%'],
  ['zh-TW-HsiaoYuNeural', '', '+18%', '+3%', '曉雨 音高 +18%'],
  ['zh-TW-HsiaoYuNeural', '', '+25%', '+5%', '曉雨 音高 +25%'],
];

const SAMPLE_TEXT = {
  zh_tw: ['狗！', '壓路機！', '星期一！', '你好呀！我是悅靈，我們一起來學說話吧！'],
  ja_jp: ['いぬ！', 'げつようび！', 'こんにちは！いっしょにことばをおぼえよう！'],
  en_us: ['ay', 'Dog!', 'January!', "Hello! Let's learn words together!"],
};

function readKey() {
  if (!fs.existsSync(KEY_FILE)) {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, '# 微軟語音（Azure AI Speech）的金鑰。這個檔案在 private/，不會上傳。\n# 在 = 後面貼上「金鑰 1」和「位置/區域」（例如 japaneast），存檔即可。\nkey=\nregion=\n');
  }
  const txt = fs.readFileSync(KEY_FILE, 'utf8');
  const get = (k) => (txt.match(new RegExp(`^${k}\\s*=\\s*(\\S+)`, 'm')) ?? [])[1];
  const key = process.env.AZURE_SPEECH_KEY ?? get('key');
  const region = process.env.AZURE_SPEECH_REGION ?? get('region');
  if (!key || !region) {
    console.error(`還沒有金鑰：請在 ${KEY_FILE} 填上 key= 和 region=`);
    process.exit(1);
  }
  return { key, region };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** markup = 已經是 SSML 的內容（例如念字母用的 say-as），不用再轉義 */
function ssml(tag, voice, text, { style, rate = '0%', pitch = '0%', markup = '' } = {}) {
  let body = `<prosody rate="${rate}" pitch="${pitch}">${markup || esc(text)}</prosody>`;
  if (style) body = `<mstts:express-as style="${style}">${body}</mstts:express-as>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${tag}"><voice name="${voice}">${body}</voice></speak>`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

/** 免費方案每分鐘最多 20 次：每次至少隔 3.2 秒，被擋（429）就等久一點再試 */
async function synth({ key, region }, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastCall + 3200 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': FORMAT,
        'User-Agent': 'FairyPocket-voice-maker',
      },
      body,
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429 || res.status >= 500) {
      await sleep(15000 * (attempt + 1));
      continue;
    }
    throw new Error(`語音服務回應 ${res.status}：${(await res.text()).slice(0, 200)}`);
  }
  throw new Error('語音服務一直忙線，請晚點再試');
}

async function samples(cred, young = false) {
  fs.mkdirSync(SAMPLE_OUT, { recursive: true });
  const rows = [];
  const sets = young
    ? ZH_YOUNG.map(([voice, style, pitch, rate, label]) => ({ lang: 'zh_tw', voice, style, pitch, rate, label }))
    : Object.entries(CANDIDATES).flatMap(([lang, list]) => list.map(([voice, style]) => ({ lang, voice, style, pitch: '+0%', rate: '-5%', label: '' })));
  const texts = { ...SAMPLE_TEXT, zh_tw: young ? ['狗！', '紅色！', '星期一！', '我也最喜歡你了！', '你好呀！我是悅靈，我們一起來學說話吧！'] : SAMPLE_TEXT.zh_tw };
  for (const { lang, voice, style, pitch, rate, label } of sets) {
    const files = [];
    for (const [i, text] of texts[lang].entries()) {
      const name = `${young ? 'young-' : ''}${voice}${style ? '-' + style : ''}${young ? `-p${pitch}-r${rate}` : ''}-${i + 1}.mp3`.replace(/[%+]/g, (c) => (c === '+' ? 'p' : ''));
      const file = path.join(SAMPLE_OUT, name);
      if (!fs.existsSync(file)) fs.writeFileSync(file, await synth(cred, ssml(VOICES[lang].tag, voice, text, { style, rate, pitch })));
      files.push([name, text]);
      console.log('✓', name);
    }
    rows.push({ lang, voice: label || voice, style, files });
  }
  // 試聽頁：雙擊打開就能聽
  const html = `<!doctype html><meta charset="utf-8"><title>悅靈的聲音試聽</title>
<style>body{font-family:sans-serif;max-width:760px;margin:20px auto;padding:0 16px}h2{margin-top:28px}div{margin:6px 0}button{font-size:16px;margin:3px;padding:6px 10px}</style>
<h1>悅靈的聲音試聽（微軟神經語音）</h1>
${rows.map((r) => `<h2>${r.voice.replace(/Neural$/, '')}${r.style ? `（${r.style}）` : ''}</h2><div>${r.files.map(([f, t]) => `<button onclick="new Audio('${f}').play()">▶ ${esc(t)}</button>`).join('')}</div>`).join('\n')}`;
  const page = young ? '試聽-繁中年輕.html' : '試聽.html';
  fs.writeFileSync(path.join(SAMPLE_OUT, page), html);
  console.log(`試聽頁：${path.join(SAMPLE_OUT, page)}`);
}

async function all(cred) {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const sb = await server.ssrLoadModule('/src/game/sbItems.ts');
  const talk = await server.ssrLoadModule('/src/game/talk.ts');
  const kg = await server.ssrLoadModule('/src/game/keyGame.ts');
  await server.close();
  // 英文字母：用 say-as 讓語音念「字母的名字」（直接念 ay、eff 會怪怪的）
  const letterOf = Object.fromEntries(Object.entries(kg.LETTER_SAY).map(([L, said]) => [said, L]));
  // 要做的文字：每張貼紙的示範念法 + 悅靈固定的台詞（有名字 {n} 的句子不做，交給裝置語音）
  const jobs = new Map();
  const add = (lang, text, kind) => jobs.set(`${lang}|${text}`, { lang, text, kind });
  for (const it of sb.stickerBookItems()) for (const lang of Object.keys(VOICES)) {
    const d = sb.demoSpeech(it, lang);
    add(d.lang, d.text, 'demo');
  }
  for (const [lang, t] of talk.allTalkLines()) add(lang, t, 'talk');

  const manPath = path.join(OUT, 'manifest.json');
  const old = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { clips: {} };
  const clips = {};
  let made = 0;
  let n = 0;
  for (const [k, { lang, text }] of jobs) {
    n++;
    const v = VOICES[lang];
    const markup = lang === 'en_us' && letterOf[text] ? `<say-as interpret-as="characters">${letterOf[text]}</say-as>` : '';
    const body = ssml(v.tag, v.voice, text, { ...v, markup });
    const id = createHash('sha1').update(body).digest('hex').slice(0, 12);
    const rel = `${lang}/${id}.mp3`;
    const file = path.join(OUT, rel);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await synth(cred, body));
      made++;
      console.log(`${n}/${jobs.size} ✓ ${k}`);
    }
    clips[k] = rel;
  }
  // 不再用到的舊檔案刪掉
  const keep = new Set(Object.values(clips));
  for (const rel of Object.values(old.clips ?? {})) if (!keep.has(rel) && fs.existsSync(path.join(OUT, rel))) fs.rmSync(path.join(OUT, rel));
  const voices = Object.fromEntries(Object.entries(VOICES).map(([l, v]) => [l, v.voice]));
  fs.writeFileSync(manPath, JSON.stringify({ voices, clips }, null, 0));
  console.log(`完成：共 ${jobs.size} 句，這次新做 ${made} 句`);
}

const cred = readKey();
if (process.argv.includes('--zh-young')) await samples(cred, true);
else if (process.argv.includes('--sample')) await samples(cred);
else await all(cred);
