// 生命模式的觀察紀錄（開發者區的開關，預設關）：讓 Claude 看得到悅靈實際怎麼想、怎麼做，
// 比較容易找出「哪裡不自然」。打開後，每 10 秒把這段時間的紀錄送到家裡電腦（private/life-logs/，不會上傳）。
// 紀錄：發生的事、主人說的話、給 AI 的生命模式狀態、AI 的原始回答、最後說了什麼／沒說（為什麼）、意圖、用哪種聲音。
// 不含鏡頭截圖和聲音。
import { loadBrain, safeBrainUrl } from '../brain/brain';

/** 瀏覽器的 localStorage（測試環境、私密瀏覽沒有時，讀寫會在 try 裡失敗而用預設值） */
const browserStorage = (): Storage => globalThis.localStorage as Storage;

const KEY = 'fairypocket.lifemonitor.v1';
const MAX_BATCH = 30_000;

export function monitorOn(storage: Pick<Storage, 'getItem'> = browserStorage()): boolean {
  try {
    return storage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function setMonitor(on: boolean, storage: Pick<Storage, 'setItem'> = browserStorage()): void {
  try {
    storage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 存不了也沒關係 */
  }
}

interface Entry {
  t: string;
  k: string;
  d: unknown;
}
let buf: Entry[] = [];
let size = 0;
let dropped = 0;

/** 記一筆（開關關著時什麼都不做） */
export function monitorLog(kind: string, data: unknown): void {
  if (!monitorOn()) return;
  const e: Entry = { t: new Date().toISOString(), k: kind, d: data };
  const n = JSON.stringify(e).length;
  if (size + n > MAX_BATCH * 3) {
    dropped++;
    return;
  }
  buf.push(e);
  size += n;
}

/** 送到家裡電腦（失敗就留著下次再送；太多就丟最舊的） */
export async function monitorFlush(): Promise<void> {
  if (!buf.length) return;
  const cfg = loadBrain();
  if (!monitorOn() || !cfg.on || !cfg.url || !safeBrainUrl(cfg.url) || !navigator.onLine) return;
  const batch: Entry[] = [];
  let n = 0;
  while (buf.length && n + JSON.stringify(buf[0]).length < MAX_BATCH) {
    const e = buf.shift()!;
    n += JSON.stringify(e).length;
    batch.push(e);
  }
  if (!batch.length) batch.push(buf.shift()!);
  size = Math.max(0, size - n);
  if (dropped) batch.push({ t: new Date().toISOString(), k: 'dropped', d: dropped });
  try {
    const r = await fetch(`${cfg.url.trim().replace(/\/+$/, '')}/api/lifelog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token.trim()}` },
      body: JSON.stringify({ entries: batch }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) dropped = 0;
    else if (r.status !== 404) buf.unshift(...batch.slice(-50));
  } catch {
    buf.unshift(...batch.slice(-50));
  }
}

if (typeof window !== 'undefined') window.setInterval(() => void monitorFlush(), 10_000);
