// 產生 PWA 圖示（原創像素悅靈臉），不使用任何 Minecraft 原版素材。
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const FACE = [
  'aaaaaaaa',
  'aabbbbaa',
  'bbbbbbbb',
  'bbebbebb',
  'bbebbebb',
  'bbbbbbbb',
  'cbbbbbbc',
  'cccccccc',
];
const PAL = { a: [59, 143, 224], b: [143, 220, 255], c: [108, 196, 245], e: [18, 48, 107] };
const BG = [159, 216, 255];
const FRAME = [95, 184, 240];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function icon(size, faceRatio) {
  const cell = Math.floor((size * faceRatio) / 8);
  const off = Math.floor((size - cell * 8) / 2);
  const border = Math.max(1, Math.floor(cell / 3));
  return png(size, (x, y) => {
    const fx = Math.floor((x - off) / cell);
    const fy = Math.floor((y - off) / cell);
    if (fx >= 0 && fx < 8 && fy >= 0 && fy < 8) return PAL[FACE[fy][fx]];
    if (x >= off - border && x < off + cell * 8 + border && y >= off - border && y < off + cell * 8 + border) return FRAME;
    return BG;
  });
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', icon(192, 0.62));
writeFileSync('public/icons/icon-512.png', icon(512, 0.62));
writeFileSync('public/icons/icon-maskable-512.png', icon(512, 0.5));
writeFileSync('public/icons/apple-touch-icon.png', icon(180, 0.62));
writeFileSync('public/icons/favicon.png', icon(64, 0.75));
console.log('icons generated');
