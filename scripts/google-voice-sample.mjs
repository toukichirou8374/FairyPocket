// Google Gemini 語音的試聽（只做試聽檔，放在 private/voice-samples/google/，不會上傳）。
// 金鑰：到 https://aistudio.google.com/apikey 用 Google 帳號建立（不用信用卡），貼到 private/google-ai.txt 的 key= 後面。
// 免費方案每天大約 15 次，所以一次請它念好幾句，每個聲音只用 1 次。
//
//   node scripts/google-voice-sample.mjs

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const KEY_FILE = path.join(ROOT, 'private/google-ai.txt');
const OUT = path.join(ROOT, 'private/voice-samples/google');
const MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts', 'gemini-2.5-pro-preview-tts'];

/** 試聽的聲音（Google 的聲音名稱與特色） */
const VOICES = [
  ['Leda', '年輕'],
  ['Zephyr', '明亮'],
  ['Aoede', '輕快'],
  ['Laomedeia', '開朗'],
  ['Achernar', '柔和'],
];

const PROMPT = '請用台灣口音的國語（不要大陸腔），像一個開朗、可愛的小女孩，慢慢地、清楚地念下面這幾句，每句之間停一下：\n狗！\n紅色！\n星期一！\n我也最喜歡你了！\n你好呀！我是悅靈，我們一起來學說話吧！';

function readKey() {
  if (!fs.existsSync(KEY_FILE)) {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, '# Google AI Studio 的 API 金鑰（https://aistudio.google.com/apikey）。這個檔案在 private/，不會上傳。\nkey=\n');
  }
  const key = (fs.readFileSync(KEY_FILE, 'utf8').match(/^key\s*=\s*(\S+)/m) ?? [])[1] ?? process.env.GEMINI_API_KEY;
  if (!key) {
    console.error(`還沒有金鑰：請在 ${KEY_FILE} 填上 key=`);
    process.exit(1);
  }
  return key;
}

/** 24kHz、16 位元單聲道的 PCM → WAV */
function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function synth(key, voice) {
  let last = '';
  for (const model of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
    });
    if (res.status === 404) {
      last = `${model} 找不到`;
      continue;
    }
    const j = await res.json();
    if (!res.ok) throw new Error(`Google 回應 ${res.status}：${JSON.stringify(j).slice(0, 300)}`);
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error('沒有拿到聲音');
    const rate = Number((part.inlineData.mimeType.match(/rate=(\d+)/) ?? [])[1] ?? 24000);
    return { audio: wav(Buffer.from(part.inlineData.data, 'base64'), rate), model };
  }
  throw new Error(`找不到可以用的語音模型（${last}）`);
}

const key = readKey();
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [voice, note] of VOICES) {
  const name = `${voice}.wav`;
  const file = path.join(OUT, name);
  if (!fs.existsSync(file)) {
    const { audio, model } = await synth(key, voice);
    fs.writeFileSync(file, audio);
    console.log('✓', name, model);
    await new Promise((r) => setTimeout(r, 21000)); // 每分鐘最多 3 次
  }
  rows.push([voice, note, name]);
}
fs.writeFileSync(
  path.join(OUT, '試聽-Google.html'),
  `<!doctype html><meta charset="utf-8"><title>Google 語音試聽</title><style>body{font-family:sans-serif;max-width:760px;margin:20px auto;padding:0 16px}button{font-size:16px;margin:6px;padding:8px 12px}</style>
<h1>Google Gemini 語音試聽（繁中）</h1><p>每個聲音念：狗！／紅色！／星期一！／我也最喜歡你了！／你好呀！我是悅靈…</p>
${rows.map(([v, n, f]) => `<div><button onclick="new Audio('${f}').play()">▶ ${v}（${n}）</button></div>`).join('\n')}`,
);
console.log(`試聽頁：${path.join(OUT, '試聽-Google.html')}`);
