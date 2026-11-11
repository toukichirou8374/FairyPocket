// 加密保存（AI 大腦的網址、通行碼等）：用這台裝置專屬、「拿不出來」的加密鑰匙（WebCrypto 不可匯出的 AES-GCM 金鑰，
// 存在 IndexedDB）把資料加密後才放進 localStorage。
// 效果：備份檔、localStorage 的內容被看到或複製走，也只是一串亂碼；鑰匙本身連程式都讀不出來，換一台裝置就解不開。
// 限制：能在這台已解鎖的裝置上、用開發工具在這個 App 裡執行程式的人，仍然可以請瀏覽器解密——
// 所以 AI 那邊另外有 Tailscale（只有自己的裝置連得到）和通行碼兩道關卡。
//
// 2026-11-11 修正（製作人回報「AI 大腦和通行碼被初始化」）：iPhone 的 IndexedDB 偶爾會暫時連不上（App 從背景回來時常見）。
// 以前讀不到鑰匙一次就當成「沒有設定」，而且整個開啟期間都不再重試；那時打開設定頁按任何按鈕，空白設定就會蓋掉原本存好的。
// 現在分清楚三種情況：沒有資料（none）、暫時讀不到（locked，會重試、不准覆蓋）、鑰匙真的不見了（lost，只能重新輸入）。

const DB = 'fairypocket-secure';
const STORE = 'keys';
const KEY_ID = 'device-v1';

function idb(): Promise<IDBDatabase> {
  return new Promise((ok, bad) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
    r.onblocked = () => bad(new Error('blocked'));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 鑰匙：found＝讀到了；missing＝IndexedDB 正常但裡面沒有鑰匙；error＝暫時讀不到（重試過了） */
type KeyResult = { state: 'found'; key: CryptoKey } | { state: 'missing' } | { state: 'error' };

let keyCache: CryptoKey | null = null;

/** 讀這台裝置的鑰匙（失敗會重試 3 次；失敗的結果不快取，下次再試） */
async function readKey(): Promise<KeyResult> {
  if (keyCache) return { state: 'found', key: keyCache };
  for (let i = 0; i < 3; i++) {
    try {
      const db = await idb();
      const key = await new Promise<CryptoKey | undefined>((ok, bad) => {
        const q = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID);
        q.onsuccess = () => ok(q.result as CryptoKey | undefined);
        q.onerror = () => bad(q.error);
      });
      db.close();
      if (!key) return { state: 'missing' };
      keyCache = key;
      return { state: 'found', key };
    } catch {
      await sleep(300 * (i + 1));
    }
  }
  return { state: 'error' };
}

/** 存資料時用的鑰匙：沒有就產生一把新的（只有確定 IndexedDB 正常、而且真的沒有鑰匙時才產生） */
async function keyForWrite(): Promise<CryptoKey | null> {
  const r = await readKey();
  if (r.state === 'found') return r.key;
  if (r.state === 'error') return null;
  try {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const db = await idb();
    await new Promise<void>((ok, bad) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(key, KEY_ID);
      tx.oncomplete = () => ok();
      tx.onerror = () => bad(tx.error);
    });
    db.close();
    keyCache = key;
    return key;
  } catch {
    return null;
  }
}

const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * 加密後存起來。鑰匙暫時讀不到時**不存**（回傳 false），不會把資料改成原文、也不會覆蓋原本加密好的資料。
 * 裝置完全不支援加密（舊瀏覽器）時才用原文。
 */
export async function putSecret(storageKey: string, value: unknown): Promise<boolean> {
  const text = JSON.stringify(value);
  const hasCrypto = typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
  if (!hasCrypto) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ plain: value }));
      return true;
    } catch {
      return false;
    }
  }
  const key = await keyForWrite();
  if (!key) return false;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
    localStorage.setItem(storageKey, JSON.stringify({ enc: 1, iv: b64(iv), data: b64(data) }));
    return true;
  } catch {
    return false;
  }
}

/** 讀取結果：ok＝讀到了；none＝沒有存過；locked＝暫時讀不到（之後再試）；lost＝鑰匙不見了，資料解不開 */
export type SecretRead<T> = { state: 'ok'; value: T } | { state: 'none' } | { state: 'locked' } | { state: 'lost' };

export async function readSecret<T>(storageKey: string): Promise<SecretRead<T>> {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
  } catch {
    return { state: 'none' };
  }
  if (!raw || typeof raw !== 'object') return { state: 'none' };
  const r = raw as { enc?: number; iv?: string; data?: string; plain?: T };
  if (r.enc === 1 && r.iv && r.data) {
    const k = await readKey();
    if (k.state === 'error') return { state: 'locked' };
    if (k.state === 'missing') return { state: 'lost' };
    try {
      const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(r.iv) }, k.key, unb64(r.data));
      return { state: 'ok', value: JSON.parse(new TextDecoder().decode(buf)) as T };
    } catch {
      return { state: 'lost' };
    }
  }
  if ('plain' in r) return r.plain ? { state: 'ok', value: r.plain } : { state: 'none' };
  // 更早的版本：直接是原文物件
  return { state: 'ok', value: raw as T };
}

/** 舊的介面：讀不到一律 null */
export async function getSecret<T>(storageKey: string): Promise<T | null> {
  const r = await readSecret<T>(storageKey);
  return r.state === 'ok' ? r.value : null;
}

/** 請瀏覽器不要在空間不足時清掉這個 App 的資料（iPhone 主畫面的 App 通常會同意） */
export async function askPersist(): Promise<boolean> {
  try {
    const s = navigator.storage;
    if (!s?.persist) return false;
    if (await s.persisted?.()) return true;
    return await s.persist();
  } catch {
    return false;
  }
}
