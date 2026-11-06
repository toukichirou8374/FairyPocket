// 從 Unicode 聯盟的 Unihan 資料庫（private/unihan/Unihan_Readings.txt，Unicode License）
// 做出「常用漢字 → 國語讀音」的精簡對照表 public/zhuyin.json，給悅靈語照中文讀音發聲用。
// kMandarin 有兩個讀音時，第二個是台灣（zh-Hant）的念法，優先用台灣的。
//
//   node scripts/make-zhuyin.mjs

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'private/unihan/Unihan_Readings.txt');
const OUT = path.join(ROOT, 'public/zhuyin.json');
const FROM = 0x4e00;
const TO = 0x9fff;

const TONE = { ā: ['a', 1], á: ['a', 2], ǎ: ['a', 3], à: ['a', 4], ē: ['e', 1], é: ['e', 2], ě: ['e', 3], è: ['e', 4], ī: ['i', 1], í: ['i', 2], ǐ: ['i', 3], ì: ['i', 4], ō: ['o', 1], ó: ['o', 2], ǒ: ['o', 3], ò: ['o', 4], ū: ['u', 1], ú: ['u', 2], ǔ: ['u', 3], ù: ['u', 4], ǖ: ['v', 1], ǘ: ['v', 2], ǚ: ['v', 3], ǜ: ['v', 4], ü: ['v', 0], ń: ['n', 2], ň: ['n', 3], ǹ: ['n', 4], ḿ: ['m', 2] };

/** 帶聲調符號的拼音 → 「沒有符號的拼音 + 聲調數字」，例如 hǎo → hao3（輕聲是 5） */
function plain(py) {
  let tone = 5;
  let s = '';
  for (const ch of py.normalize('NFC')) {
    const t = TONE[ch];
    if (t) {
      s += t[0];
      if (t[1]) tone = t[1];
    } else s += ch;
  }
  return s.replace(/[^a-zv]/g, '') + tone;
}

const text = fs.readFileSync(SRC, 'utf8');
const reading = new Map();
for (const line of text.split('\n')) {
  const m = /^U\+([0-9A-F]+)\tkMandarin\t(.+)$/.exec(line);
  if (!m) continue;
  const cp = parseInt(m[1], 16);
  if (cp < FROM || cp > TO) continue;
  const vals = m[2].trim().split(/\s+/);
  reading.set(cp, plain(vals[1] ?? vals[0]));
}
const syl = ['', ...[...new Set(reading.values())].sort()];
const index = new Map(syl.map((s, i) => [s, i]));
const map = new Uint16Array(TO - FROM + 1);
for (const [cp, r] of reading) map[cp - FROM] = index.get(r);
fs.writeFileSync(OUT, JSON.stringify({ from: FROM, syl, map: Buffer.from(map.buffer).toString('base64'), source: 'Unicode Unihan kMandarin (Unicode License); Taiwan reading preferred' }));
console.log(`${reading.size} 個字、${syl.length - 1} 種讀音 → ${OUT}（${(fs.statSync(OUT).size / 1024).toFixed(0)} KB）`);
for (const ch of '你好悅靈今天天氣台灣垃圾和') console.log(ch, syl[map[ch.codePointAt(0) - FROM]]);
