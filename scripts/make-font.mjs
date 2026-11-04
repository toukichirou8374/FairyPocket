// 從 GNU Unifont（fonts/unifont_all-*.hex.gz，SIL OFL 1.1）挑出遊戲用得到的字，
// 產生 public/fonts/fairypocket-pixel.ttf。改了介面文字或台詞後執行：npm run font
//
// 收錄：英數符號、src 與 index.html 裡出現的所有字、平假名、片假名、全形符號。
// 玩家取的名字若用到沒收錄的字，畫面會自動改用系統字型顯示那個字。

import { gunzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFont, unifontGlyph } from '../src/pixelFont.ts';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const hexFile = readdirSync(join(root, 'fonts')).find((f) => /^unifont_all-.*\.hex\.gz$/.test(f));
if (!hexFile) throw new Error('找不到 fonts/unifont_all-*.hex.gz');

const chars = new Set();
const add = (from, to) => { for (let c = from; c <= to; c++) chars.add(c); };
add(0x20, 0x7e);
add(0x3000, 0x303f); // 中日文標點
add(0x3040, 0x30ff); // 平假名、片假名
add(0xff01, 0xff5e); // 全形符號
for (const c of '♪～…・★☆♥←→↑↓') chars.add(c.codePointAt(0));

function scan(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) scan(p);
    else if (/\.(ts|html)$/.test(f) && !f.endsWith('.test.ts')) for (const ch of readFileSync(p, 'utf8')) chars.add(ch.codePointAt(0));
  }
}
scan(join(root, 'src'));
for (const ch of readFileSync(join(root, 'index.html'), 'utf8')) chars.add(ch.codePointAt(0));

const hex = new Map();
for (const line of gunzipSync(readFileSync(join(root, 'fonts', hexFile))).toString('utf8').split('\n')) {
  const i = line.indexOf(':');
  if (i > 0) hex.set(parseInt(line.slice(0, i), 16), line.slice(i + 1).trim());
}

const glyphs = [];
const missing = [];
for (const c of [...chars].sort((a, b) => a - b)) {
  if (c < 0x20 || c > 0xfffe) continue;
  const h = hex.get(c);
  if (h) glyphs.push(unifontGlyph(c, h));
  else if (c > 0x7f) missing.push(String.fromCodePoint(c));
}

const ttf = buildFont('FairyPocket Pixel', glyphs);
writeFileSync(join(root, 'public', 'fonts', 'fairypocket-pixel.ttf'), ttf);
// 收錄的字（給測試檢查有沒有漏字）
writeFileSync(join(root, 'fonts', 'fairypocket-pixel.chars.txt'), glyphs.map((g) => String.fromCodePoint(g.code)).join(''));
console.log(`${glyphs.length} 字，${(ttf.length / 1024).toFixed(0)} KB${missing.length ? `；Unifont 沒有：${missing.join('')}` : ''}`);
