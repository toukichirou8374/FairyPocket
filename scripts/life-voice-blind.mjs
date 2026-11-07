// 生命模式即時語音的盲測（繁中）：同樣幾句生命模式會說的話，用幾個候選聲音各念一次，
// 試聽頁不顯示是哪個聲音（A、B、C、D 隨機排），選好再按「公布答案」。
// - 微軟 Azure（即時語音用的免費方案）幾個候選
// - Google Achernar（事先做好的台詞在用；每天只有約 10 次，不能拿來即時念，這裡只做 1 次當比較）
// 檔案放在 private/voice-samples/life-blind/（不會上傳）。已經做過的不重做。
//
//   node scripts/life-voice-blind.mjs
//
// 選好後：把結果寫進 private/tts-voice.json（例如 {"zh_tw":{"voice":"zh-TW-HsiaoYuNeural","pitch":"+10%"}}），
// 重新啟動 AI 轉接程式就會換聲音。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'private/voice-samples/life-blind');
const LINES = ['嗯～今天的陽光好舒服喔。', '那塊麵包看起來好好吃！', '我先去角落探險一下，等等回來找你。', '呼啊……有點想睡了。'];

/** [檔名, 說明, Azure 聲音, 音高, 語速] */
const AZURE = [
  ['azure-hsiaochen', '微軟 曉臻（目前的預設）', 'zh-TW-HsiaoChenNeural', '+0%', '-5%'],
  ['azure-hsiaochen-p10', '微軟 曉臻 音高 +10%', 'zh-TW-HsiaoChenNeural', '+10%', '0%'],
  ['azure-hsiaoyu-p10', '微軟 曉雨 音高 +10%', 'zh-TW-HsiaoYuNeural', '+10%', '0%'],
];

function readKv(file, keys) {
  const txt = fs.readFileSync(path.join(ROOT, 'private', file), 'utf8');
  return Object.fromEntries(keys.map((k) => [k, (txt.match(new RegExp(`^${k}\\s*=\\s*(\\S+)`, 'm')) ?? [])[1]]));
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function azure(voice, pitch, rate) {
  const { key, region } = readKv('azure-speech.txt', ['key', 'region']);
  if (!key || !region) throw new Error('private/azure-speech.txt 沒有金鑰');
  const body = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW"><voice name="${voice}"><prosody rate="${rate}" pitch="${pitch}">${LINES.map(esc).join('<break time="700ms"/>')}</prosody></voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'FairyPocket-voice-blind' },
    body,
  });
  if (!res.ok) throw new Error(`微軟語音回應 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

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

async function achernar() {
  const { key } = readKv('google-ai.txt', ['key']);
  if (!key) throw new Error('private/google-ai.txt 沒有金鑰');
  const prompt = `請用台灣口音的國語（不要大陸腔），像一隻開朗、可愛的小精靈，自然地念下面這幾句，每句之間停一下：\n${LINES.join('\n')}`;
  for (const model of ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts']) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Achernar' } } } } }),
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Google 語音回應 ${res.status}`);
    const j = await res.json();
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error('沒有拿到聲音');
    const rate = Number((part.inlineData.mimeType.match(/rate=(\d+)/) ?? [])[1] ?? 24000);
    return wav(Buffer.from(part.inlineData.data, 'base64'), rate);
  }
  throw new Error('找不到可以用的 Google 語音模型');
}

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [name, label, voice, pitch, rate] of AZURE) {
  const file = `${name}.mp3`;
  if (!fs.existsSync(path.join(OUT, file))) {
    fs.writeFileSync(path.join(OUT, file), await azure(voice, pitch, rate));
    await new Promise((r) => setTimeout(r, 3500));
  }
  console.log('✓', file);
  rows.push({ file, label });
}
try {
  const file = 'google-achernar.wav';
  if (!fs.existsSync(path.join(OUT, file))) fs.writeFileSync(path.join(OUT, file), await achernar());
  console.log('✓', file);
  rows.push({ file, label: 'Google Achernar（事先做好的台詞在用；不能即時念）' });
} catch (e) {
  console.log('Achernar 這次沒做成：', e.message);
}

const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>生命模式語音盲測</title>
<style>body{font-family:sans-serif;max-width:640px;margin:20px auto;padding:0 16px;line-height:1.6}button{font-size:17px;margin:6px 4px;padding:8px 14px}.who{display:none;color:#286}.show .who{display:inline}</style>
<h1>生命模式語音盲測（繁中）</h1>
<p>每個聲音都念同樣四句：${LINES.join('／')}</p>
<p>先不看答案，選出最像悅靈、聽起來最自然的一個，再按「公布答案」。每次打開順序都會打亂。</p>
<div id="list"></div>
<p><button onclick="document.body.classList.add('show')">公布答案</button></p>
<script>
const rows = ${JSON.stringify(rows)};
for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
document.getElementById('list').innerHTML = rows.map((r, i) => '<div><button onclick="new Audio(\\'' + r.file + '\\').play()">▶ 聲音 ' + 'ABCD'[i] + '</button> <span class="who">' + r.label + '</span></div>').join('');
</script>`;
fs.writeFileSync(path.join(OUT, '盲測.html'), html);
console.log(`盲測頁：${path.join(OUT, '盲測.html')}`);
