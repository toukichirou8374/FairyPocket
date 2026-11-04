// 玩家自行匯入的 Minecraft 原版素材包（由 scripts/make-pack.mjs 從自己的遊戲檔產生）。
// 網站本身不含任何原版素材；素材包只存在玩家自己的裝置上（IndexedDB）。
// 素材包內以原版路徑存放，例如 textures/entity/allay/allay.png、sounds/mob/allay/idle_with_item1.ogg。

/** 介面目前用到的材質 */
export const IMAGE_PATHS = {
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
  chest: 'textures/entity/chest/normal.png',
  bell: 'textures/item/bell.png',
  amethyst_shard: 'textures/item/amethyst_shard.png',
  // 原版英數字型與設定畫面的按鈕、輸入框（九宮格）
  ascii: 'textures/font/ascii.png',
  button: 'textures/gui/sprites/widget/button.png',
  button_highlighted: 'textures/gui/sprites/widget/button_highlighted.png',
  text_field: 'textures/gui/sprites/widget/text_field.png',
  text_field_highlighted: 'textures/gui/sprites/widget/text_field_highlighted.png',
  // 放在地上的蛋糕方塊
  cake_top: 'textures/block/cake_top.png',
  cake_side: 'textures/block/cake_side.png',
  cake_bottom: 'textures/block/cake_bottom.png',
  cake_inner: 'textures/block/cake_inner.png',
  // 唱片機與唱片
  jukebox_side: 'textures/block/jukebox_side.png',
  jukebox_top: 'textures/block/jukebox_top.png',
  music_disc_creator_music_box: 'textures/item/music_disc_creator_music_box.png',
  music_disc_far: 'textures/item/music_disc_far.png',
  // 快捷欄：煙火、水桶
  firework_rocket: 'textures/item/firework_rocket.png',
  water_bucket: 'textures/item/water_bucket.png',
  // 床（原版紅色床的各面）
  bed_head_up: 'textures/block/red_bed_head_up.png',
  bed_foot_up: 'textures/block/red_bed_foot_up.png',
  bed_head_east: 'textures/block/red_bed_head_east.png',
  bed_head_west: 'textures/block/red_bed_head_west.png',
  bed_foot_east: 'textures/block/red_bed_foot_east.png',
  bed_foot_west: 'textures/block/red_bed_foot_west.png',
  bed_foot_south: 'textures/block/red_bed_foot_south.png',
  bed_head_north: 'textures/block/bed_head_north.png',
  bed_down: 'textures/block/bed_down.png',
  // 煙火火花、水花與泡泡粒子
  spark_0: 'textures/particle/spark_0.png',
  spark_1: 'textures/particle/spark_1.png',
  spark_2: 'textures/particle/spark_2.png',
  spark_3: 'textures/particle/spark_3.png',
  spark_4: 'textures/particle/spark_4.png',
  spark_5: 'textures/particle/spark_5.png',
  spark_6: 'textures/particle/spark_6.png',
  spark_7: 'textures/particle/spark_7.png',
  splash_0: 'textures/particle/splash_0.png',
  splash_1: 'textures/particle/splash_1.png',
  splash_2: 'textures/particle/splash_2.png',
  splash_3: 'textures/particle/splash_3.png',
  bubble: 'textures/particle/bubble.png',
  // 彩色粉塵粒子（dust）的 8 張圖
  generic_0: 'textures/particle/generic_0.png',
  generic_1: 'textures/particle/generic_1.png',
  generic_2: 'textures/particle/generic_2.png',
  generic_3: 'textures/particle/generic_3.png',
  generic_4: 'textures/particle/generic_4.png',
  generic_5: 'textures/particle/generic_5.png',
  generic_6: 'textures/particle/generic_6.png',
  generic_7: 'textures/particle/generic_7.png',
} as const;
export type AssetKey = keyof typeof IMAGE_PATHS;

/** 舊版（format 1，JSON）素材包的音效鍵 → 原版路徑 */
const LEGACY_SOUNDS: Record<string, string> = {
  allay_with_item1: 'sounds/mob/allay/idle_with_item1.wav',
  allay_with_item2: 'sounds/mob/allay/idle_with_item2.wav',
  allay_with_item3: 'sounds/mob/allay/idle_with_item3.wav',
  allay_with_item4: 'sounds/mob/allay/idle_with_item4.wav',
  amethyst_chime: 'sounds/block/amethyst/shimmer.wav',
};

const ALLAY = IMAGE_PATHS.allay;

export interface AssetPack {
  source: string;
  id: string;
  /** 原版路徑 → 檔案 */
  files: Map<string, Blob>;
}

const MIME: Record<string, string> = { png: 'image/png', ogg: 'audio/ogg', wav: 'audio/wav', json: 'application/json' };
const mime = (path: string) => MIME[path.split('.').pop() ?? ''] ?? 'application/octet-stream';

function invalid(): Error {
  return new Error('這不是 FairyPocket 的素材包');
}

function checkAllay(files: Map<string, Blob>): void {
  if (!files.has(ALLAY)) throw new Error('素材包缺少悅靈貼圖');
}

/** 舊版 JSON 素材包（base64） */
export function parseLegacyPack(text: string): AssetPack {
  let d: { app?: string; kind?: string; source?: unknown; files?: Record<string, unknown> };
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error('檔案不是有效的素材包');
  }
  if (!d || d.app !== 'FairyPocket' || d.kind !== 'mc-assets' || typeof d.files !== 'object' || !d.files) throw invalid();
  const files = new Map<string, Blob>();
  const put = (path: string, v: unknown, prefix: string) => {
    if (typeof v !== 'string' || !v.startsWith(prefix)) return;
    const bin = atob(v.slice(prefix.length));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    files.set(path, new Blob([bytes], { type: mime(path) }));
  };
  for (const [k, path] of Object.entries(IMAGE_PATHS)) put(path, d.files[k], 'data:image/png;base64,');
  for (const [k, path] of Object.entries(LEGACY_SOUNDS)) put(path, d.files[k], 'data:audio/wav;base64,');
  checkAllay(files);
  const source = String(d.source ?? '未知版本').slice(0, 40);
  return { source, id: `legacy-${source}`, files };
}

async function inflate(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** zip 素材包（format 2） */
export async function parseZipPack(buf: ArrayBuffer): Promise<AssetPack> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalid();
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map<string, Blob>();
  let meta: { app?: string; kind?: string; source?: unknown; id?: unknown } | null = null;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw invalid();
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const skip = dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + skip;
    if (name.endsWith('/')) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    let data: Uint8Array<ArrayBuffer> = u8.subarray(start, start + size);
    if (method === 8) data = await inflate(data);
    else if (method !== 0) continue;
    if (name === 'pack.json') meta = JSON.parse(dec.decode(data));
    else files.set(name, new Blob([data.slice()], { type: mime(name) }));
  }
  if (!meta || meta.app !== 'FairyPocket' || meta.kind !== 'mc-assets') throw invalid();
  checkAllay(files);
  const source = String(meta.source ?? '未知版本').slice(0, 40);
  return { source, id: String(meta.id ?? source), files };
}

/**
 * 直接從檔案讀 zip 素材包，不把整包讀進記憶體：只讀目錄，每個檔案用 slice 切出來
 * （iPad 上整包讀進來再複製會因為記憶體不足而閃退）。
 * 我們自己產生的素材包是不壓縮、沒有額外欄位的 zip；其他 zip 改用一般讀法。
 */
export async function parseZipBlob(file: Blob): Promise<AssetPack> {
  const tailLen = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalid();
  const count = tail.getUint16(eocd + 10, true);
  const dirSize = tail.getUint32(eocd + 12, true);
  const dirOff = tail.getUint32(eocd + 16, true);
  const dir = new DataView(await file.slice(dirOff, dirOff + dirSize).arrayBuffer());
  const u8 = new Uint8Array(dir.buffer);
  const dec = new TextDecoder();
  const files = new Map<string, Blob>();
  let meta: { app?: string; kind?: string; source?: unknown; id?: unknown } | null = null;
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (dir.getUint32(p, true) !== 0x02014b50) throw invalid();
    const method = dir.getUint16(p + 10, true);
    const size = dir.getUint32(p + 20, true);
    const nameLen = dir.getUint16(p + 28, true);
    const skip = dir.getUint16(p + 30, true) + dir.getUint16(p + 32, true);
    const local = dir.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + skip;
    if (name.endsWith('/')) continue;
    // 第一個檔案確認本地標頭沒有額外欄位，之後就直接算位置
    if (method !== 0 || (i === 0 && new DataView(await file.slice(local + 26, local + 30).arrayBuffer()).getUint16(2, true) !== 0)) {
      return parseZipPack(await file.arrayBuffer());
    }
    const start = local + 30 + nameLen;
    const blob = file.slice(start, start + size, mime(name));
    if (name === 'pack.json') meta = JSON.parse(await blob.text());
    else files.set(name, blob);
  }
  if (!meta || meta.app !== 'FairyPocket' || meta.kind !== 'mc-assets') throw invalid();
  checkAllay(files);
  const source = String(meta.source ?? '未知版本').slice(0, 40);
  return { source, id: String(meta.id ?? source), files };
}

/** 匯入檔案：自動判斷 zip 或舊版 JSON */
export async function readPackFile(file: Blob): Promise<AssetPack> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return parseZipBlob(file);
  return parseLegacyPack(await file.text());
}

// ---------- 儲存（IndexedDB，容量比 localStorage 大很多） ----------

/** 舊版存在 localStorage 的素材包 */
export const LEGACY_ASSETS_KEY = 'fairypocket.assets.v1';
const DB = 'fairypocket';
const STORE = 'pack';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, timeoutMs = 0): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      // 有些裝置存檔會卡住不回應：超過時間就放棄這次交易並回報錯誤
      const timer = timeoutMs ? window.setTimeout(() => {
        try {
          t.abort();
        } catch {
          // 已經結束
        }
        reject(new Error('timeout'));
      }, timeoutMs) : 0;
      t.oncomplete = () => {
        clearTimeout(timer);
        resolve(req.result);
      };
      t.onerror = t.onabort = () => {
        clearTimeout(timer);
        reject(t.error ?? new Error('儲存失敗'));
      };
    });
  } finally {
    db.close();
  }
}

/** 每批最多存幾 MB（分批存，避免一次交易太大讓 iPad 記憶體不足，也讓進度跑得比較細） */
const PART_BYTES = 3_000_000;
/** 每批最多等幾秒 */
const PART_TIMEOUT = 45_000;

/**
 * 存在資料庫裡的一批檔案：把很多小檔案接成一整塊再存
 * （iPhone 的 Safari 一次存幾百個小檔案會非常慢、甚至卡住；一整塊就很快）。
 * data 平常是一個 Blob，那台裝置存 Blob 失敗時改存 ArrayBuffer。
 */
interface Part {
  names: string[];
  sizes: number[];
  data: Blob | ArrayBuffer;
}

/**
 * 分批存入素材包。progress(at, next)：at = 已存好的比例（依檔案大小），next = 這一批存好後的比例。
 */
export async function savePack(p: AssetPack, progress?: (at: number, next: number) => void): Promise<void> {
  const chunks: [string, Blob][][] = [];
  let cur: [string, Blob][] = [];
  let curBytes = 0;
  for (const e of p.files) {
    if (cur.length && curBytes + e[1].size > PART_BYTES) {
      chunks.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(e);
    curBytes += e[1].size;
  }
  if (cur.length) chunks.push(cur);
  const sizes = chunks.map((c) => c.reduce((m, [, b]) => m + b.size, 0));
  const total = Math.max(1, sizes.reduce((x, y) => x + y, 0));
  const parts = chunks.length;
  let done = 0;
  // 先清掉舊的素材包（反正會被覆蓋），空出儲存空間
  await tx('readwrite', (s) => s.clear());
  let useBuffer = false;
  for (let i = 0; i < parts; i++) {
    const at = done / total;
    const next = (done + sizes[i]) / total;
    progress?.(at, at + (next - at) * 0.5);
    // 先把這一批讀進記憶體（只有幾 MB），再接成一整塊
    const buf = await new Blob(chunks[i].map(([, blob]) => blob)).arrayBuffer();
    progress?.(at + (next - at) * 0.5, next);
    const part = (data: Blob | ArrayBuffer): Part => ({ names: chunks[i].map(([n]) => n), sizes: chunks[i].map(([, blob]) => blob.size), data });
    if (!useBuffer) {
      try {
        await tx('readwrite', (s) => s.put(part(new Blob([buf])), `part:${i}`), PART_TIMEOUT);
      } catch {
        useBuffer = true;
      }
    }
    if (useBuffer) {
      try {
        await tx('readwrite', (s) => s.put(part(buf), `part:${i}`), PART_TIMEOUT);
      } catch (e) {
        throw new Error((e as Error).message === 'timeout' ? '存入這台裝置太久沒有回應，請確認儲存空間足夠後再試一次' : `無法存入這台裝置（${(e as Error).message}）`);
      }
    }
    done += sizes[i];
  }
  progress?.(1, 1);
  // 最後才寫目錄，存到一半失敗時不會讀到不完整的素材包
  await tx('readwrite', (s) => s.put({ source: p.source, id: p.id, parts, v: 3 }, 'current'));
}

export async function loadPack(): Promise<AssetPack | null> {
  try {
    const d = (await tx('readonly', (s) => s.get('current'))) as { source: string; id: string; files?: Record<string, Blob>; parts?: number } | undefined;
    if (d?.files) return { source: d.source, id: d.id, files: new Map(Object.entries(d.files)) };
    if (d?.parts) {
      const files = new Map<string, Blob>();
      for (let i = 0; i < d.parts; i++) {
        const chunk = (await tx('readonly', (s) => s.get(`part:${i}`))) as Part | Record<string, Blob> | undefined;
        if (!chunk) throw new Error('素材包不完整');
        if (Array.isArray(chunk.names)) {
          const c = chunk as Part;
          const blob = c.data instanceof Blob ? c.data : new Blob([c.data]);
          let off = 0;
          c.names.forEach((n, k) => {
            files.set(n, blob.slice(off, off + c.sizes[k], mime(n)));
            off += c.sizes[k];
          });
        } else for (const [k, v] of Object.entries(chunk as Record<string, Blob>)) files.set(k, v);
      }
      return { source: d.source, id: d.id, files };
    }
  } catch {
    // 讀不到就當作沒有素材包
  }
  // 舊版存在 localStorage 的素材包：搬到 IndexedDB
  try {
    const t = localStorage.getItem(LEGACY_ASSETS_KEY);
    if (!t) return null;
    const p = parseLegacyPack(t);
    await savePack(p);
    localStorage.removeItem(LEGACY_ASSETS_KEY);
    return p;
  } catch {
    return null;
  }
}

export async function deletePack(): Promise<void> {
  localStorage.removeItem(LEGACY_ASSETS_KEY);
  await tx('readwrite', (s) => s.clear());
}

// ---------- 使用 ----------

/** 依原版路徑（可省略副檔名）取檔，優先 .ogg 再 .wav */
export function packFile(p: AssetPack, path: string): Blob | undefined {
  return p.files.get(path) ?? p.files.get(`${path}.ogg`) ?? p.files.get(`${path}.wav`) ?? p.files.get(`${path}.png`);
}

export type AssetImages = Partial<Record<AssetKey, HTMLImageElement>>;

/** 依「名稱 → 原版路徑」表載入圖片，素材包裡沒有的會略過 */
export async function loadImages<K extends string = AssetKey>(
  p: AssetPack,
  paths: Record<K, string> = IMAGE_PATHS as unknown as Record<K, string>,
): Promise<Partial<Record<K, HTMLImageElement>>> {
  const out: Partial<Record<K, HTMLImageElement>> = {};
  await Promise.all(
    (Object.entries(paths) as [K, string][]).map(([k, path]) => {
      const blob = p.files.get(path);
      if (!blob) return;
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          out[k] = img;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = URL.createObjectURL(blob);
      });
    }),
  );
  return out;
}
