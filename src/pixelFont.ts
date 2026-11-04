// 把像素點陣字（GNU Unifont 的 .hex、原版 ascii.png）轉成 TrueType 字型。
// 每個像素變成方塊輪廓，不需要任何外部工具；建置時（Node）與瀏覽器中都能用。

/** 一個字：rows[y][x] 為 true 代表有像素；pixel 是每像素的字型單位；advance 為字寬（字型單位） */
export interface PixelGlyph {
  code: number;
  rows: boolean[][];
  pixel: number;
  advance: number;
  /** 第一列像素的頂端在基線上方多少字型單位 */
  top: number;
}

// 1 em = 16 個 Unifont 像素；座標差值都很小，可以用 1 位元組儲存，字型檔比較小
export const UNITS_PER_EM = 16;
const ASCENT = 14; // 基線以上
const DESCENT = 2; // 基線以下

/** 把同一列連續的像素合併，再把上下相同的段落合併成長方形，減少輪廓數 */
function rects(rows: boolean[][]): [x: number, y: number, w: number, h: number][] {
  const out: [number, number, number, number][] = [];
  let open = new Map<string, [number, number, number, number]>();
  rows.forEach((row, y) => {
    const next = new Map<string, [number, number, number, number]>();
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const s = x;
      while (x < row.length && row[x]) x++;
      const key = `${s},${x - s}`;
      const r = open.get(key);
      if (r) {
        r[3]++;
        next.set(key, r);
        open.delete(key);
      } else {
        const nr: [number, number, number, number] = [s, y, x - s, 1];
        out.push(nr);
        next.set(key, nr);
      }
    }
    open = next;
  });
  return out;
}

class Buf {
  private a: number[] = [];
  u8(v: number) { this.a.push(v & 255); return this; }
  u16(v: number) { return this.u8(v >> 8).u8(v); }
  i16(v: number) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v: number) { return this.u16(Math.floor(v / 65536) & 0xffff).u16(v & 0xffff); }
  bytes(b: ArrayLike<number>) { for (let i = 0; i < b.length; i++) this.a.push(b[i] & 255); return this; }
  pad4() { while (this.a.length % 4) this.a.push(0); return this; }
  get length() { return this.a.length; }
  out() { return Uint8Array.from(this.a); }
}

function encodeGlyph(g: PixelGlyph): Uint8Array {
  const rs = rects(g.rows);
  if (!rs.length) return new Uint8Array(0);
  const pts: [number, number][][] = rs.map(([x, y, w, h]) => {
    const x0 = x * g.pixel, x1 = (x + w) * g.pixel;
    const y0 = g.top - y * g.pixel, y1 = g.top - (y + h) * g.pixel;
    // TrueType 外輪廓為順時針
    return [[x0, y1], [x0, y0], [x1, y0], [x1, y1]];
  });
  const all = pts.flat();
  const b = new Buf();
  b.i16(pts.length)
    .i16(Math.min(...all.map((p) => p[0]))).i16(Math.min(...all.map((p) => p[1])))
    .i16(Math.max(...all.map((p) => p[0]))).i16(Math.max(...all.map((p) => p[1])));
  let n = 0;
  for (const c of pts) b.u16((n += c.length) - 1);
  b.u16(0); // 沒有 hinting 指令
  // 旗標：線段端點；差值 0 省略、小於 256 用 1 位元組
  const dx: number[] = [], dy: number[] = [];
  let px = 0, py = 0;
  for (const [x, y] of all) { dx.push(x - px); dy.push(y - py); px = x; py = y; }
  const flag = (d: number, short: number, same: number) => (d === 0 ? same : Math.abs(d) < 256 ? short | (d > 0 ? same : 0) : 0);
  for (let i = 0; i < all.length; i++) b.u8(1 | flag(dx[i], 0x02, 0x10) | flag(dy[i], 0x04, 0x20));
  const coord = (d: number) => { if (d !== 0) { if (Math.abs(d) < 256) b.u8(Math.abs(d)); else b.i16(d); } };
  dx.forEach(coord);
  dy.forEach(coord);
  return b.out();
}

function checksum(d: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s = (s + ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0) >>> 0;
  return s;
}

function nameTable(family: string): Uint8Array {
  const recs: [number, string][] = [[1, family], [2, 'Regular'], [3, `${family} Regular`], [4, `${family} Regular`], [5, 'Version 1.0'], [6, family.replace(/\s/g, '')]];
  const strs = recs.map(([, s]) => {
    const b = new Buf();
    for (const ch of s) b.u16(ch.charCodeAt(0));
    return b.out();
  });
  const b = new Buf().u16(0).u16(recs.length).u16(6 + recs.length * 12);
  let off = 0;
  recs.forEach(([id], i) => {
    b.u16(3).u16(1).u16(0x409).u16(id).u16(strs[i].length).u16(off);
    off += strs[i].length;
  });
  strs.forEach((s) => b.bytes(s));
  return b.out();
}

function cmapTable(codes: number[]): Uint8Array {
  // format 4：每個字一段（字數不多時最簡單），最後加上 0xFFFF 結尾段
  const segs = codes.map((c, i) => ({ start: c, end: c, delta: (i + 1 - c) & 0xffff }));
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segs.length;
  const sub = new Buf();
  const len = 16 + n * 8;
  const pow = 2 ** Math.floor(Math.log2(n));
  sub.u16(4).u16(len).u16(0).u16(n * 2).u16(pow * 2).u16(Math.log2(pow)).u16(n * 2 - pow * 2);
  segs.forEach((s) => sub.u16(s.end));
  sub.u16(0);
  segs.forEach((s) => sub.u16(s.start));
  segs.forEach((s) => sub.u16(s.delta));
  segs.forEach(() => sub.u16(0));
  return new Buf().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(sub.out()).out();
}

/** 產生 TTF。glyphs 會依字碼排序；只支援 BMP（U+0000–U+FFFF）。 */
export function buildFont(family: string, input: PixelGlyph[]): Uint8Array {
  const glyphs = [...new Map(input.filter((g) => g.code < 0xffff).map((g) => [g.code, g])).values()].sort((a, b) => a.code - b.code);
  const encoded = glyphs.map(encodeGlyph);
  const glyf = new Buf();
  const loca = new Buf().u32(0).u32(0); // .notdef 為空字（起點與終點都是 0）
  for (const e of encoded) {
    glyf.bytes(e).pad4();
    loca.u32(glyf.length);
  }
  const numGlyphs = glyphs.length + 1;
  const advances = [UNITS_PER_EM / 2, ...glyphs.map((g) => g.advance)];
  const hmtx = new Buf();
  advances.forEach((a) => hmtx.u16(a).i16(0));
  let maxPts = 0, maxCont = 0;
  for (const e of encoded) {
    if (!e.length) continue;
    const c = (e[0] << 8) | e[1];
    maxCont = Math.max(maxCont, c);
    maxPts = Math.max(maxPts, c * 4);
  }
  const head = new Buf().u32(0x10000).u32(0x10000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(UNITS_PER_EM)
    .u32(0).u32(0).u32(0).u32(0)
    .i16(0).i16(-DESCENT).i16(UNITS_PER_EM * 2).i16(ASCENT)
    .u16(0).u16(8).i16(2).i16(1).i16(0); // lowestRecPPEM 8、loca 長格式
  const hhea = new Buf().u32(0x10000).i16(ASCENT).i16(-DESCENT).i16(0).u16(Math.max(...advances))
    .i16(0).i16(0).i16(Math.max(...advances)).i16(1).i16(0).i16(0)
    .i16(0).i16(0).i16(0).i16(0).i16(0).u16(numGlyphs);
  const maxp = new Buf().u32(0x10000).u16(numGlyphs).u16(maxPts).u16(maxCont).u16(0).u16(0).u16(2)
    .u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);
  const first = glyphs[0]?.code ?? 32, last = glyphs[glyphs.length - 1]?.code ?? 32;
  const U = UNITS_PER_EM;
  const os2 = new Buf().u16(4).i16(U / 2).u16(400).u16(5).u16(0)
    .i16(U / 2).i16(U / 2).i16(0).i16(U / 8).i16(U / 2).i16(U / 2).i16(0).i16(U / 2).i16(U / 16).i16(U / 4).i16(0)
    .bytes([2, 0, 6, 9, 0, 0, 0, 0, 0, 0])
    .u32(0).u32(0).u32(0).u32(0)
    .bytes([0x46, 0x50, 0x4b, 0x54]) // 廠商代碼 FPKT
    .u16(0x40).u16(first).u16(last)
    .i16(ASCENT).i16(-DESCENT).i16(0).u16(ASCENT).u16(DESCENT)
    .u32(1).u32(0).i16(U / 2).i16((U * 3) / 4).u16(0).u16(32).u16(0);
  const post = new Buf().u32(0x30000).u32(0).i16(-1).i16(1).u32(0).u32(0).u32(0).u32(0).u32(0);
  const tables: [string, Uint8Array][] = [
    ['OS/2', os2.out()], ['cmap', cmapTable(glyphs.map((g) => g.code))], ['glyf', glyf.out()], ['head', head.out()],
    ['hhea', hhea.out()], ['hmtx', hmtx.out()], ['loca', loca.out()], ['maxp', maxp.out()], ['name', nameTable(family)], ['post', post.out()],
  ];
  const n = tables.length;
  const pow = 2 ** Math.floor(Math.log2(n));
  const file = new Buf().u32(0x10000).u16(n).u16(pow * 16).u16(Math.log2(pow)).u16(n * 16 - pow * 16);
  let off = 12 + n * 16;
  const padded = tables.map(([, d]) => {
    const p = new Uint8Array(Math.ceil(d.length / 4) * 4);
    p.set(d);
    return p;
  });
  tables.forEach(([tag, d], i) => {
    file.bytes([...tag].map((c) => c.charCodeAt(0))).u32(checksum(padded[i])).u32(off).u32(d.length);
    off += padded[i].length;
  });
  padded.forEach((p) => file.bytes(p));
  const out = file.out();
  // head.checkSumAdjustment
  const headOff = 12 + n * 16 + padded.slice(0, 3).reduce((s, p) => s + p.length, 0);
  const adj = (0xb1b0afba - checksum(out)) >>> 0;
  new DataView(out.buffer).setUint32(headOff + 8, adj);
  return out;
}

// ---------- 字源 ----------

/** GNU Unifont .hex：每行「字碼:點陣」，8×16 或 16×16 */
export function unifontGlyph(code: number, hex: string): PixelGlyph {
  const w = hex.length === 32 ? 8 : 16;
  const rows: boolean[][] = [];
  const per = w / 4;
  for (let y = 0; y < 16; y++) {
    const v = parseInt(hex.slice(y * per, (y + 1) * per), 16);
    rows.push(Array.from({ length: w }, (_, x) => ((v >> (w - 1 - x)) & 1) === 1));
  }
  // 16 像素高 = 1 em；第 14 列以下在基線下方（與原版縮半顯示時相同）
  return { code, rows, pixel: UNITS_PER_EM / 16, advance: (w * UNITS_PER_EM) / 16, top: 14 * (UNITS_PER_EM / 16) };
}

/**
 * 原版 textures/font/ascii.png：16×16 格、每格 8×8，字寬依最右邊的像素決定（多 1 像素字距）。
 * data 為 RGBA 像素、size 為圖片寬度（可能是 128 的倍數）。
 */
export function asciiGlyphs(data: Uint8ClampedArray, size: number): PixelGlyph[] {
  const k = size / 128;
  const px = UNITS_PER_EM / 8;
  const out: PixelGlyph[] = [];
  for (let code = 32; code < 127; code++) {
    const cx = (code % 16) * 8, cy = Math.floor(code / 16) * 8;
    const rows: boolean[][] = [];
    let right = -1;
    for (let y = 0; y < 8; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < 8; x++) {
        const i = ((cy * k + y * k) * size + cx * k + x * k) * 4;
        const on = data[i + 3] > 127;
        row.push(on);
        if (on) right = Math.max(right, x);
      }
      rows.push(row);
    }
    const width = code === 32 ? 4 : right + 2;
    // 原版字高 8 像素，第 7 列是基線
    out.push({ code, rows, pixel: px, advance: width * px, top: 7 * px });
  }
  return out;
}
