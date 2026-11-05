// 事先做好的神經語音（微軟 Azure，scripts/make-voices.mjs 產生在 public/voice/）。
// 「悅靈示範念法」和悅靈固定的台詞有檔案就播檔案（自然很多），沒有的（例如有名字的句子）才用裝置內建語音。
// 聲音檔第一次用到時才下載，之後存在快取裡，沒網路也能播。

import type { Lang } from './i18n';

interface Manifest {
  voices: Partial<Record<Lang, string>>;
  clips: Record<string, string>;
}

const BASE = `${import.meta.env.BASE_URL}voice/`;
const CACHE = 'fairypocket-voice-v1';

let manifest: Promise<Manifest | null> | null = null;

function loadManifest(): Promise<Manifest | null> {
  manifest ??= fetch(`${BASE}manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(async () => {
      // 沒網路：用快取裡的
      const c = await caches?.open(CACHE).then((x) => x.match(`${BASE}manifest.json`)).catch(() => undefined);
      return c ? ((await c.json()) as Manifest) : null;
    });
  return manifest;
}

/** 這句話有沒有做好的聲音檔 */
export async function hasNeural(lang: Lang, text: string): Promise<boolean> {
  return !!(await loadManifest())?.clips[`${lang}|${text}`];
}

const decoded = new Map<string, AudioBuffer>();

/** 讀出這句話的聲音（沒有檔案或讀不到回傳 null） */
export async function neuralBuffer(ctx: AudioContext, lang: Lang, text: string): Promise<AudioBuffer | null> {
  const m = await loadManifest();
  const rel = m?.clips[`${lang}|${text}`];
  if (!rel) return null;
  const hit = decoded.get(rel);
  if (hit) return hit;
  const url = `${BASE}${rel}`;
  try {
    let res: Response | undefined;
    const cache = await caches?.open(CACHE).catch(() => undefined);
    res = await cache?.match(url);
    if (!res) {
      res = await fetch(url);
      if (!res.ok) return null;
      await cache?.put(url, res.clone()).catch(() => undefined);
      // manifest 也存一份，沒網路時用
      const mres = await fetch(`${BASE}manifest.json`).catch(() => undefined);
      if (mres?.ok) await cache?.put(`${BASE}manifest.json`, mres).catch(() => undefined);
    }
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    if (decoded.size > 80) decoded.clear();
    decoded.set(rel, buf);
    return buf;
  } catch {
    return null;
  }
}
