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

/** 匯入檔案：自動判斷 zip 或舊版 JSON */
export async function readPackFile(file: Blob): Promise<AssetPack> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return parseZipPack(await file.arrayBuffer());
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

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = t.onabort = () => reject(t.error ?? new Error('儲存失敗'));
    });
  } finally {
    db.close();
  }
}

export async function savePack(p: AssetPack): Promise<void> {
  await tx('readwrite', (s) => s.put({ source: p.source, id: p.id, files: Object.fromEntries(p.files) }, 'current'));
}

export async function loadPack(): Promise<AssetPack | null> {
  try {
    const d = (await tx('readonly', (s) => s.get('current'))) as { source: string; id: string; files: Record<string, Blob> } | undefined;
    if (d?.files) return { source: d.source, id: d.id, files: new Map(Object.entries(d.files)) };
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
  await tx('readwrite', (s) => s.delete('current'));
}

// ---------- 使用 ----------

/** 依原版路徑（可省略副檔名）取檔，優先 .ogg 再 .wav */
export function packFile(p: AssetPack, path: string): Blob | undefined {
  return p.files.get(path) ?? p.files.get(`${path}.ogg`) ?? p.files.get(`${path}.wav`) ?? p.files.get(`${path}.png`);
}

export type AssetImages = Partial<Record<AssetKey, HTMLImageElement>>;

export async function loadImages(p: AssetPack): Promise<AssetImages> {
  const out: AssetImages = {};
  await Promise.all(
    (Object.entries(IMAGE_PATHS) as [AssetKey, string][]).map(([k, path]) => {
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
