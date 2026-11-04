// 本機存檔、匯出與還原。

import { clamp, createPet, MAX_AFFECTION, MAX_ENERGY, MAX_HEALTH, MAX_HUNGER, MAX_MOOD, NAME_MAX, PERSONALITY_IDS, type Personality, type PetState } from './state';

export const SAVE_KEY = 'fairypocket.save.v1';
export const BACKUP_KEY = 'fairypocket.save.v1.bak';

interface SaveFile {
  app: 'FairyPocket';
  format: 1;
  savedAt: number;
  pet: PetState;
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;

export function serialize(s: PetState, now = Date.now()): string {
  const file: SaveFile = { app: 'FairyPocket', format: 1, savedAt: now, pet: s };
  return JSON.stringify(file, null, 2);
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

/** 解析並驗證存檔內容。不合法時丟出帶中文訊息的錯誤。 */
export function parseSave(text: string): PetState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('檔案不是有效的存檔格式');
  }
  const file = data as Partial<SaveFile>;
  if (!file || file.app !== 'FairyPocket' || typeof file.pet !== 'object' || file.pet === null) {
    throw new Error('這不是 FairyPocket 的存檔');
  }
  if (file.format !== 1) throw new Error('存檔版本不支援');
  const p = file.pet as Partial<PetState>;
  const d = createPet();
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, NAME_MAX) : d.name;
  const personality = PERSONALITY_IDS.includes(p.personality as Personality) ? (p.personality as Personality) : d.personality;
  const stats = (p.stats ?? {}) as Partial<PetState['stats']>;
  return {
    version: 1,
    // 舊存檔沒有 ID：第一次讀取時配一個新的
    id: typeof p.id === 'string' && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(p.id) ? p.id : d.id,
    name,
    personality,
    health: num(p.health, 1, MAX_HEALTH, d.health),
    hunger: num(p.hunger, 0, MAX_HUNGER, d.hunger),
    energy: num(p.energy, 0, MAX_ENERGY, d.energy),
    affection: num(p.affection, 0, MAX_AFFECTION, d.affection),
    mood: num(p.mood, 0, MAX_MOOD, d.mood),
    asleep: p.asleep === true,
    onboarded: p.onboarded !== false,
    createdAt: num(p.createdAt, 0, Number.MAX_SAFE_INTEGER, d.createdAt),
    lastSeen: num(p.lastSeen, 0, Number.MAX_SAFE_INTEGER, d.lastSeen),
    stats: {
      fed: num(stats.fed, 0, 1e9, 0),
      petted: num(stats.petted, 0, 1e9, 0),
      played: num(stats.played, 0, 1e9, 0),
    },
  };
}

export function loadPet(storage: KV): PetState | null {
  for (const key of [SAVE_KEY, BACKUP_KEY]) {
    try {
      const text = storage.getItem(key);
      if (text) return parseSave(text);
    } catch {
      // 主存檔損毀時改讀備份
    }
  }
  return null;
}

export function storePet(storage: KV, s: PetState, now = Date.now()): boolean {
  try {
    s.lastSeen = now;
    const prev = storage.getItem(SAVE_KEY);
    if (prev) storage.setItem(BACKUP_KEY, prev);
    storage.setItem(SAVE_KEY, serialize(s, now));
    return true;
  } catch {
    return false;
  }
}

// ---------- 連動碼：把存檔壓縮成一段文字，傳到另一台裝置貼上 ----------

const LINK_PREFIX = 'FP1:';

async function pipe(data: Uint8Array<ArrayBuffer>, t: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeLink(s: PetState, now = Date.now()): Promise<string> {
  const file: SaveFile = { app: 'FairyPocket', format: 1, savedAt: now, pet: s };
  const z = await pipe(new TextEncoder().encode(JSON.stringify(file)), new CompressionStream('deflate-raw'));
  let bin = '';
  z.forEach((b) => (bin += String.fromCharCode(b)));
  return LINK_PREFIX + btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function decodeLink(code: string): Promise<PetState> {
  const c = code.replace(/\s+/g, '');
  if (!c.startsWith(LINK_PREFIX)) throw new Error('bad-link');
  try {
    const bin = atob(c.slice(LINK_PREFIX.length).replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return parseSave(new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw'))));
  } catch {
    throw new Error('bad-link');
  }
}

/**
 * 收到另一台裝置的存檔時怎麼處理：
 * same-newer = 同一隻且對方比較新（直接更新）、same-older = 同一隻但這台比較新、other = 另一隻悅靈
 */
export function linkKind(local: PetState, incoming: PetState): 'same-newer' | 'same-older' | 'other' {
  if (local.id !== incoming.id) return 'other';
  return incoming.lastSeen > local.lastSeen ? 'same-newer' : 'same-older';
}

export function exportFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `FairyPocket-存檔-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}
