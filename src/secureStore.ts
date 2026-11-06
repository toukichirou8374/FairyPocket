// 加密保存（AI 大腦的網址、通行碼等）：用這台裝置專屬、「拿不出來」的加密鑰匙（WebCrypto 不可匯出的 AES-GCM 金鑰，
// 存在 IndexedDB）把資料加密後才放進 localStorage。
// 效果：備份檔、localStorage 的內容被看到或複製走，也只是一串亂碼；鑰匙本身連程式都讀不出來，換一台裝置就解不開。
// 限制：能在這台已解鎖的裝置上、用開發工具在這個 App 裡執行程式的人，仍然可以請瀏覽器解密——
// 所以 AI 那邊另外有 Tailscale（只有自己的裝置連得到）和通行碼兩道關卡。

const DB = 'fairypocket-secure';
const STORE = 'keys';
const KEY_ID = 'device-v1';

function idb(): Promise<IDBDatabase> {
  return new Promise((ok, bad) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}

let keyPromise: Promise<CryptoKey | null> | null = null;

/** 這台裝置的加密鑰匙（第一次用時產生；不可匯出） */
function deviceKey(): Promise<CryptoKey | null> {
  keyPromise ??= (async () => {
    try {
      const db = await idb();
      const get = <T>(): Promise<T | undefined> =>
        new Promise((ok, bad) => {
          const q = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID);
          q.onsuccess = () => ok(q.result as T | undefined);
          q.onerror = () => bad(q.error);
        });
      let key = await get<CryptoKey>();
      if (!key) {
        key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await new Promise<void>((ok, bad) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(key, KEY_ID);
          tx.oncomplete = () => ok();
          tx.onerror = () => bad(tx.error);
        });
      }
      return key;
    } catch {
      return null;
    }
  })();
  return keyPromise;
}

const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** 加密後存起來（裝置不支援時才退回原文，並標記 plain） */
export async function putSecret(storageKey: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  const key = await deviceKey();
  try {
    if (!key) throw new Error('no key');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
    localStorage.setItem(storageKey, JSON.stringify({ enc: 1, iv: b64(iv), data: b64(data) }));
  } catch {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ plain: value }));
    } catch {
      /* 存不了也沒關係 */
    }
  }
}

/** 讀回來；以前用原文存的舊資料也讀得到（之後再存時就會變成加密） */
export async function getSecret<T>(storageKey: string): Promise<T | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { enc?: number; iv?: string; data?: string; plain?: T };
  if (r.enc === 1 && r.iv && r.data) {
    const key = await deviceKey();
    if (!key) return null;
    try {
      const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(r.iv) }, key, unb64(r.data));
      return JSON.parse(new TextDecoder().decode(buf)) as T;
    } catch {
      return null;
    }
  }
  if ('plain' in r) return r.plain ?? null;
  // 更早的版本：直接是原文物件
  return raw as T;
}
