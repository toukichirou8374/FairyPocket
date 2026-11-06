// H3-2：Minecraft 多位合成玩家的排程與延遲測試（只用假 Ollama、暫存資料夾、測試埠）
//
//   node scripts/hub/bench/mcLoad.mjs [--scale 0.02] [--seconds 60] [--out 檔案.md]
//
// 時間縮放：所有「真實時間」（推論延遲、玩家思考時間、Hub 逾時）乘上 scale 後執行，
// 量到的延遲再除以 scale 換算回「估計的真實時間」。這是合成模型，不是 GPU 實測。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRelay } from '../../ai-proxy.mjs';
import { createHub } from '../hub.mjs';
import { ollamaAdapter } from '../localai.mjs';
import { LOCAL_DIGEST, localModel, cloudModel, startFakeOllama } from './fakeOllama.mjs';

const FP_TOKEN = 'bench-fp-token-0001';
const MC_TOKEN = 'bench-mc-token-0002';

/** 可重現的亂數 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 延遲模型（真實毫秒）。fast：依規格書「RTX 2060S 約 1 秒一句」；slow：忙碌或較長回答 */
export const PROFILES = {
  fast: { base: 900, jitter: 300 },
  slow: { base: 2500, jitter: 800 },
};

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

/**
 * @param {{ players:number, seconds?:number, scale?:number, profile?:'fast'|'slow', think?:[number,number],
 *           capacity?:number, timeoutMs?:number, waitMs?:number, parallel?:number, phoneEveryMs?:number, seed?:number }} o
 */
export async function runLoad(o) {
  const scale = o.scale ?? 0.02;
  const seconds = o.seconds ?? 60;
  const prof = PROFILES[o.profile ?? 'fast'];
  const rand = rng(o.seed ?? 42);
  const think = o.think ?? [5_000, 15_000]; // 玩家兩次說話之間的真實間隔
  const fake = await startFakeOllama({
    models: [localModel(), cloudModel()],
    parallel: o.parallel ?? 1,
    latencyMs: () => (prof.base + (rand() * 2 - 1) * prof.jitter) * scale,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fairy-h32-'));
  let cloudCalls = 0;
  const cloud = { isOwner: () => true, cloudStatus: () => ({}), cloudChat: async () => (cloudCalls++, [200, { text: 'cloud' }]) };
  const hub = createHub({
    dir,
    ai: ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'], digest: LOCAL_DIGEST }),
    scheduler: { capacity: o.capacity ?? 8, timeoutMs: (o.timeoutMs ?? 12_000) * scale, waitMs: (o.waitMs ?? o.timeoutMs ?? 12_000) * scale },
  });
  const relay = createRelay({ token: FP_TOKEN, mcToken: MC_TOKEN, hub, cloud, ollama: { host: '127.0.0.1', port: fake.port } });
  await new Promise((r) => relay.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${relay.address().port}`;
  const mc = async (actor, method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { authorization: `Bearer ${MC_TOKEN}`, 'x-fairy-source': 'bench-paper-01', 'x-fairy-actor': actor, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const out = { players: o.players, requests: 0, local: 0, rules: 0, busy: 0, full: 0, other: 0, lat: [], badIntent: 0, phone: [] };
  try {
    const actors = Array.from({ length: o.players }, (_, i) => `java:${(i + 1).toString(16).padStart(8, '0')}-0000-4000-8000-${o.players.toString(16).padStart(12, '0')}`);
    const pets = [];
    for (const a of actors) pets.push((await mc(a, 'POST', '/api/allay/mc/pet', {})).json.pet);
    const end = Date.now() + seconds * 1000 * scale;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const player = async (i) => {
      await sleep(rand() * think[1] * scale); // 錯開開始時間
      for (let k = 0; Date.now() < end; k++) {
        const t0 = Date.now();
        const r = await mc(actors[i], 'POST', '/api/allay/talk', { pet: pets[i], opId: `talk-p${i}-${String(k).padStart(5, '0')}`, text: '我們去冒險吧' });
        out.requests++;
        if (r.status === 200) {
          out.lat.push((Date.now() - t0) / scale);
          if (r.json.route === 'LOCAL_OLLAMA') out.local++;
          else out.rules++;
          const it = r.json.intent;
          if (it.soundPolicy !== 'MINECRAFT_PRESERVE_EXISTING_SYNTHETIC' || Object.keys(it).some((x) => /audio|voice|tts|pitch|url/i.test(x))) out.badIntent++;
        } else if (r.json?.error === 'PET_BUSY') out.busy++;
        else if (r.json?.error === 'QUEUE_FULL') out.full++;
        else out.other++;
        await sleep((think[0] + rand() * (think[1] - think[0])) * scale);
      }
    };
    // 手機（FairyPocket）同時直接問 Ollama（不經過 Hub 的排程），量它被 Minecraft 影響多少
    const phone = async () => {
      if (!o.phoneEveryMs) return;
      while (Date.now() < end) {
        const t0 = Date.now();
        await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { authorization: `Bearer ${FP_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'gemma3:4b', stream: false, keep_alive: '30m', options: { temperature: 0.8, num_predict: 160 }, messages: [{ role: 'user', content: 'hi' }] }),
        }).then((r) => r.text());
        out.phone.push((Date.now() - t0) / scale);
        await sleep(o.phoneEveryMs * scale);
      }
    };
    await Promise.all([...actors.map((_, i) => player(i)), phone()]);
    await sleep(((o.timeoutMs ?? 12_000) + prof.base + prof.jitter) * scale); // 等底層請求都結束
  } finally {
    relay.closeAllConnections?.();
    await new Promise((r) => relay.close(() => r()));
    await fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const s = hub.scheduler.stats;
  return {
    players: o.players,
    profile: o.profile ?? 'fast',
    requests: out.requests,
    local: out.local,
    rules: out.rules,
    busy: out.busy,
    full: out.full,
    other: out.other,
    localRate: out.requests ? out.local / out.requests : 0,
    p50: Math.round(pct(out.lat, 50)),
    p95: Math.round(pct(out.lat, 95)),
    max: Math.round(Math.max(0, ...out.lat)),
    phoneP50: Math.round(pct(out.phone, 50)),
    phoneMax: Math.round(Math.max(0, ...out.phone)),
    ollamaMaxInFlightFromHub: s.maxInFlight,
    ollamaMaxInFlight: fake.stats.maxInFlight,
    ollamaAborted: fake.stats.aborted,
    hubAborted: s.aborted,
    cloudModelRequested: fake.stats.cloudRequested,
    cloudCalls,
    badIntent: out.badIntent,
    modelsSeen: [...new Set(fake.stats.modelsSeen)],
  };
}

// ---------- 直接執行：產生 1／2／5／10／20 位玩家的報告 ----------
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : d;
  };
  const scale = Number(arg('--scale', '0.02'));
  const seconds = Number(arg('--seconds', '60'));
  const outFile = arg('--out', null);
  const rows = [];
  // 預設：佇列 8、逾時 12 秒、排隊最多等 12 秒；建議：佇列 8、逾時 8 秒、排隊最多等 3 秒（等不到就先用規則台詞回答）
  const CONFIGS = { 預設: { capacity: 8, timeoutMs: 12_000, waitMs: 12_000 }, 建議: { capacity: 8, timeoutMs: 8_000, waitMs: 3_000 } };
  for (const [cfgName, cfg] of Object.entries(CONFIGS))
    for (const profile of ['fast', 'slow'])
      for (const players of [1, 2, 5, 10, 20]) rows.push({ cfgName, ...(await runLoad({ players, seconds, scale, profile, phoneEveryMs: 20_000, ...cfg })) });
  const md = [
    `# H3-2 合成負載結果（假 Ollama，時間縮放 ${scale}，每組 ${seconds} 秒真實時間）`,
    '',
    '> 合成模型，不是 GPU 實測。延遲是「換算回真實時間的估計值」，含被時間縮放放大的 HTTP 額外開銷（約 0.1–0.3 秒）。',
    '> 預設：佇列 8、推論逾時 12 秒、排隊最多 12 秒。建議：佇列 8、推論逾時 8 秒、排隊最多 3 秒。',
    '> fast：每句約 0.9 秒（±0.3）；slow：每句約 2.5 秒（±0.8）。玩家每 5–15 秒說一句。手機每 20 秒直接問 Ollama 一次。',
    '',
    '| 設定 | 延遲模型 | 玩家 | 請求 | 本機 AI | 規則台詞 | 忙碌 | 佇列滿 | 本機 AI 比例 | p50（秒） | p95（秒） | 最慢（秒） | 手機 p50／最慢（秒） | Ollama 最大並行 | 取消 | 雲端 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.cfgName} | ${r.profile} | ${r.players} | ${r.requests} | ${r.local} | ${r.rules} | ${r.busy} | ${r.full} | ${Math.round(r.localRate * 100)}% | ${(r.p50 / 1000).toFixed(1)} | ${(r.p95 / 1000).toFixed(1)} | ${(r.max / 1000).toFixed(1)} | ${(r.phoneP50 / 1000).toFixed(1)}／${(r.phoneMax / 1000).toFixed(1)} | ${r.ollamaMaxInFlight} | ${r.ollamaAborted} | ${r.cloudCalls + r.cloudModelRequested} |`),
    '',
  ].join('\n');
  console.log(md);
  if (outFile) fs.writeFileSync(outFile, md);
}
