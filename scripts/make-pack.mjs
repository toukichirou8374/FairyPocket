// 從「你自己安裝的」Minecraft Java 版遊戲檔取出原版素材，
// 打包成兩個素材包：
//   private/FairyPocket-原版素材包.zip         完整版：全部材質 + 全部音效（背景音樂與唱片只收錄遊戲用到的 9 首）
//   private/FairyPocket-原版素材包-精簡版.zip  精簡版：只有遊戲實際用到的檔案（給 iPad 等容易記憶體不足的裝置）
// 這個素材包只供個人使用：private/ 已排除在 Git 與網站建置之外，請勿公開散布。
//
// 用法：node scripts/make-pack.mjs [版本名稱，例如 26.3]
// 未指定時自動選用 %APPDATA%\.minecraft\versions 中最新的正式版本。遊戲檔只讀取、不修改。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync, crc32 } from 'node:zlib';

/** 不放進素材包的音效資料夾（檔案太大）；但遊戲用到的背景音樂與唱片例外 */
const SKIP_SOUNDS = /^minecraft\/sounds\/(music|records)\//;
const KEEP_MUSIC = /^minecraft\/sounds\/(music\/game\/(minecraft|sweden|wet_hands)|records\/(creator_music_box|far|relic|cat|chirp|wait))\.ogg$/;

/**
 * 遊戲實際用到的檔案：掃描 src 裡寫到的原版路徑。
 * 'textures/…png' 取那個檔案；'sounds/…'（沒有副檔名）取所有以它開頭的檔案（例如 eat1～3）。
 * 另外加上食物圖示（textures/item/<食物>.png）與生態域材質（block('名稱')）。
 */
function usedPaths() {
  const exact = new Set();
  const prefixes = new Set();
  const scan = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) scan(p);
      else if (n.endsWith('.ts') && !n.endsWith('.test.ts')) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/['"`]((?:textures|sounds)\/[\w/.-]+)/g)) {
          const v = m[1];
          if (v.endsWith('/')) continue;
          if (v.endsWith('.png')) exact.add(v);
          else prefixes.add(v);
        }
        for (const m of src.matchAll(/block\('([\w]+)'\)/g)) exact.add(`textures/block/${m[1]}.png`);
      }
    }
  };
  scan('src');
  const state = readFileSync(join('src', 'game', 'state.ts'), 'utf8');
  const foods = state.slice(state.indexOf('export const FOODS'), state.indexOf('} as const;'));
  for (const m of foods.matchAll(/^\s+(\w+): \{ hunger/gm)) exact.add(`textures/item/${m[1]}.png`);
  return (name) => name === 'pack.json' || exact.has(name) || [...prefixes].some((p) => name.startsWith(p));
}

const mc = join(process.env.APPDATA ?? '', '.minecraft');

function findVersion() {
  const dir = join(mc, 'versions');
  if (!existsSync(dir)) throw new Error(`找不到 Minecraft Java 版資料夾：${dir}`);
  const list = readdirSync(dir)
    .filter((v) => !/fabric|forge|quilt|snapshot|-pre|-rc|^\d\dw\d\d/i.test(v))
    .filter((v) => existsSync(join(dir, v, `${v}.jar`)))
    .sort((a, b) => statSync(join(dir, b, `${b}.jar`)).mtimeMs - statSync(join(dir, a, `${a}.jar`)).mtimeMs);
  if (!list.length) throw new Error('找不到已下載的正式版遊戲檔，請先用官方啟動器開一次遊戲');
  return list[0];
}

/** 極簡 zip 讀取器（jar 就是 zip） */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('遊戲檔格式不正確');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const get = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const raw = buf.subarray(start, start + e.size);
    return e.method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
  };
  return { names: [...entries.keys()], get };
}

/** 不壓縮（stored）的 zip；PNG 與 OGG 本身已壓縮 */
function writeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 檔名
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    locals.push(h, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const v = process.argv[2] ?? findVersion();
const jarPath = join(mc, 'versions', v, `${v}.jar`);
console.log(`讀取（唯讀）：${jarPath}`);
const jar = readZip(readFileSync(jarPath));

const files = [];
let textures = 0;
for (const name of jar.names) {
  if (!name.startsWith('assets/minecraft/textures/') || !name.endsWith('.png')) continue;
  files.push([name.slice('assets/minecraft/'.length), jar.get(name)]);
  textures++;
}
if (!files.some(([n]) => n === 'textures/entity/allay/allay.png')) throw new Error('遊戲檔裡找不到悅靈貼圖');

const meta = JSON.parse(readFileSync(join(mc, 'versions', v, `${v}.json`), 'utf8'));
const index = JSON.parse(readFileSync(join(mc, 'assets', 'indexes', `${meta.assetIndex.id}.json`), 'utf8')).objects;
let sounds = 0;
const missing = [];
for (const [name, obj] of Object.entries(index)) {
  if (!name.startsWith('minecraft/sounds/') || (SKIP_SOUNDS.test(name) && !KEEP_MUSIC.test(name))) continue;
  const path = join(mc, 'assets', 'objects', obj.hash.slice(0, 2), obj.hash);
  if (!existsSync(path)) {
    missing.push(name);
    continue;
  }
  files.push([name.slice('minecraft/'.length), readFileSync(path)]);
  sounds++;
}
const sj = index['minecraft/sounds.json'];
if (sj) files.push(['sounds.json', readFileSync(join(mc, 'assets', 'objects', sj.hash.slice(0, 2), sj.hash))]);

const stamp = Date.now();
mkdirSync('private', { recursive: true });
const pack = (source, id) => ['pack.json', Buffer.from(JSON.stringify({ app: 'FairyPocket', kind: 'mc-assets', format: 2, source, id }))];

const out = join('private', 'FairyPocket-原版素材包.zip');
const zip = writeZip([pack(v, `${v}-${stamp}`), ...files]);
writeFileSync(out, zip);
console.log(`完成：${out}（材質 ${textures} 個、音效 ${sounds} 個，${(zip.length / 1e6).toFixed(1)} MB，Minecraft ${v}）`);

const used = usedPaths();
const lite = files.filter(([n]) => used(n));
const liteOut = join('private', 'FairyPocket-原版素材包-精簡版.zip');
const liteZip = writeZip([pack(`${v}（精簡版）`, `${v}-lite-${stamp}`), ...lite]);
writeFileSync(liteOut, liteZip);
console.log(`完成：${liteOut}（${lite.length} 個檔案，${(liteZip.length / 1e6).toFixed(1)} MB）`);
if (missing.length) console.log(`尚未下載的音效 ${missing.length} 個（請用官方啟動器開一次遊戲）`);
