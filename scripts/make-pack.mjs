// 從「你自己安裝的」Minecraft Java 版遊戲檔取出 FairyPocket 需要的原版素材，
// 打包成 private/FairyPocket-原版素材包.json。
// 這個素材包只供個人使用：private/ 已排除在 Git 與網站建置之外，請勿公開散布。
//
// 用法：node scripts/make-pack.mjs [jar 路徑]
// 未指定時自動選用 %APPDATA%\.minecraft\versions 中最新的正式版本。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';

// 音效在遊戲的資源索引（assets/objects）裡；轉成 WAV 讓所有 iPhone 都能播放
const SOUNDS = {
  allay_with_item1: 'mob/allay/idle_with_item1',
  allay_with_item2: 'mob/allay/idle_with_item2',
  allay_with_item3: 'mob/allay/idle_with_item3',
  allay_with_item4: 'mob/allay/idle_with_item4',
  amethyst_chime: 'block/amethyst/shimmer',
};

const FILES = {
  allay: 'textures/entity/allay/allay.png',
  apple: 'textures/item/apple.png',
  bread: 'textures/item/bread.png',
  feather: 'textures/item/feather.png',
  slime_ball: 'textures/item/slime_ball.png',
  note_block: 'textures/block/note_block.png',
  heart_full: 'textures/gui/sprites/hud/heart/full.png',
  heart_half: 'textures/gui/sprites/hud/heart/half.png',
  heart_container: 'textures/gui/sprites/hud/heart/container.png',
  food_full: 'textures/gui/sprites/hud/food_full.png',
  food_half: 'textures/gui/sprites/hud/food_half.png',
  food_empty: 'textures/gui/sprites/hud/food_empty.png',
  hotbar: 'textures/gui/sprites/hud/hotbar.png',
  hotbar_selection: 'textures/gui/sprites/hud/hotbar_selection.png',
  particle_heart: 'textures/particle/heart.png',
  particle_note: 'textures/particle/note.png',
};

function findJar() {
  const dir = join(process.env.APPDATA ?? '', '.minecraft', 'versions');
  if (!existsSync(dir)) throw new Error(`找不到 Minecraft Java 版資料夾：${dir}`);
  const jars = readdirSync(dir)
    .filter((v) => !/fabric|forge|quilt|snapshot|-pre|-rc|^\d\dw\d\d/i.test(v))
    .map((v) => ({ v, jar: join(dir, v, `${v}.jar`) }))
    .filter((x) => existsSync(x.jar))
    .sort((a, b) => statSync(b.jar).mtimeMs - statSync(a.jar).mtimeMs);
  if (!jars.length) throw new Error('找不到已下載的正式版遊戲檔，請先用官方啟動器開一次遊戲');
  return jars[0];
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
  return (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const raw = buf.subarray(start, start + e.size);
    return e.method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
  };
}

const arg = process.argv[2];
const { v, jar } = arg ? { v: arg.replace(/^.*[\\/]/, '').replace(/\.jar$/, ''), jar: arg } : findJar();
console.log(`讀取（唯讀）：${jar}`);
const get = readZip(readFileSync(jar));

const files = {};
const missing = [];
for (const [key, path] of Object.entries(FILES)) {
  const data = get(`assets/minecraft/${path}`);
  if (data) files[key] = `data:image/png;base64,${data.toString('base64')}`;
  else missing.push(path);
}
if (!files.allay) throw new Error('遊戲檔裡找不到悅靈貼圖');

/** 單聲道 16-bit WAV */
function toWav(channels, rate) {
  const n = channels[0].length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const c of channels) s += c[i];
    s = Math.max(-1, Math.min(1, s / channels.length));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

try {
  const mc = join(process.env.APPDATA ?? '', '.minecraft');
  const meta = JSON.parse(readFileSync(join(mc, 'versions', v, `${v}.json`), 'utf8'));
  const index = JSON.parse(readFileSync(join(mc, 'assets', 'indexes', `${meta.assetIndex.id}.json`), 'utf8')).objects;
  const decoder = new OggVorbisDecoder();
  await decoder.ready;
  for (const [key, name] of Object.entries(SOUNDS)) {
    const obj = index[`minecraft/sounds/${name}.ogg`];
    const path = obj && join(mc, 'assets', 'objects', obj.hash.slice(0, 2), obj.hash);
    if (!path || !existsSync(path)) {
      missing.push(`${name}.ogg`);
      continue;
    }
    const { channelData, sampleRate } = await decoder.decodeFile(new Uint8Array(readFileSync(path)));
    await decoder.reset();
    files[key] = `data:audio/wav;base64,${toWav(channelData, sampleRate).toString('base64')}`;
  }
  decoder.free();
} catch (e) {
  console.log(`讀不到音效（將沒有聲音）：${e.message}`);
}

mkdirSync('private', { recursive: true });
const out = join('private', 'FairyPocket-原版素材包.json');
writeFileSync(out, JSON.stringify({ app: 'FairyPocket', kind: 'mc-assets', format: 1, source: v, files }));
console.log(`完成：${out}（${Object.keys(files).length} 個素材，Minecraft ${v}）`);
if (missing.length) console.log(`此版本缺少（將使用暫用素材）：${missing.join(', ')}`);
