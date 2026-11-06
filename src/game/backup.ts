// 匯出存檔裡「悅靈以外」的資料：遊戲紀錄、設定，以及所有錄音（貼紙簿、悅靈的回應）。
// 只要是 fairypocket. 開頭的設定、錄音資料庫裡的東西都會自動帶走，以後新增的遊戲資料也不用另外處理。
// 素材包（Minecraft 的檔案）不放進存檔。

import type { Clip } from '../voice';
import { BACKUP_KEY, SAVE_KEY } from './save';

/** 不放進存檔的設定：悅靈本身（另外存）、素材包 */
// AI 大腦的連線設定（網址、通行碼）不放進備份，也不從備份還原：避免通行碼外流，或被別人的備份檔改掉網址
const SKIP_LOCAL = new Set([SAVE_KEY, BACKUP_KEY, 'fairypocket.assets.v1', 'fairypocket.assets.optout', 'fairypocket.brain.v1', 'fairypocket.voices.v1', 'fairypocket.devpass.v1', 'fairypocket.devlock.v1']);

export interface Extras {
  /** localStorage 裡的遊戲紀錄與設定 */
  local: Record<string, string>;
  /** 錄音資料庫（名字 → 內容，錄音轉成文字） */
  voice: Record<string, unknown>;
}

type KV = Pick<Storage, 'length' | 'key' | 'getItem'>;

export function collectLocal(storage: KV): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k || !k.startsWith('fairypocket.') || SKIP_LOCAL.has(k)) continue;
    const v = storage.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

export function restoreLocal(storage: Pick<Storage, 'setItem'>, local: Record<string, string>): void {
  for (const [k, v] of Object.entries(local)) {
    if (k.startsWith('fairypocket.') && !SKIP_LOCAL.has(k) && typeof v === 'string') storage.setItem(k, v);
  }
}

// ---------- 錄音 ↔ 文字 ----------

interface PackedClip {
  clip: 1;
  rate: number;
  /** 16 位元聲音資料（base64） */
  pcm: string;
}

/** 存檔裡的錄音最高 24kHz（說話的聲音夠用，檔案小一半） */
const MAX_RATE = 24000;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function packClip(c: Clip): PackedClip {
  const step = Math.max(1, Math.round(c.rate / MAX_RATE));
  const n = Math.floor(c.data.length / step);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    // 每 step 個取平均（順便濾掉高頻）
    let sum = 0;
    for (let j = 0; j < step; j++) sum += c.data[i * step + j];
    const v = Math.max(-1, Math.min(1, sum / step));
    pcm[i] = Math.round(v * 32767);
  }
  return { clip: 1, rate: c.rate / step, pcm: toBase64(new Uint8Array(pcm.buffer)) };
}

export function unpackClip(p: PackedClip): Clip {
  const b = fromBase64(p.pcm);
  const pcm = new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2));
  const data = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32767;
  return { rate: p.rate, data };
}

function isClip(v: unknown): v is Clip {
  return !!v && typeof v === 'object' && (v as Clip).data instanceof Float32Array && typeof (v as Clip).rate === 'number';
}

function isPacked(v: unknown): v is PackedClip {
  return !!v && typeof v === 'object' && (v as PackedClip).clip === 1 && typeof (v as PackedClip).pcm === 'string' && typeof (v as PackedClip).rate === 'number';
}

/** 錄音資料庫的內容 → 可以放進 JSON 的樣子（錄音或錄音的陣列） */
export function packValue(v: unknown): unknown {
  if (isClip(v)) return packClip(v);
  if (Array.isArray(v)) return v.map(packValue);
  return v ?? null;
}

export function unpackValue(v: unknown): unknown {
  if (isPacked(v)) return unpackClip(v);
  if (Array.isArray(v)) return v.map(unpackValue);
  return v ?? null;
}

/** 從存檔文字讀出額外資料；舊存檔沒有就回傳 null */
export function parseExtras(text: string): Extras | null {
  try {
    const e = (JSON.parse(text) as { extras?: Partial<Extras> }).extras;
    if (!e || typeof e !== 'object') return null;
    const local: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.local ?? {})) if (typeof v === 'string') local[k] = v;
    const voice = e.voice && typeof e.voice === 'object' ? (e.voice as Record<string, unknown>) : {};
    return { local, voice };
  } catch {
    return null;
  }
}
