// 悅靈 AI 大腦的轉接程式（只在這台電腦內部運作）：
//   iPhone ─(Tailscale HTTPS)→ tailscale serve → 這個程式 127.0.0.1:11435 → Ollama 127.0.0.1:11434
//   Minecraft（Paper 插件，同一台電腦）→ 127.0.0.1:11435 → Fairy Hub（/api/allay/…）
//
// 安全防護：
// - 只聽 127.0.0.1：區域網路、外部網路都連不到，只有 tailscale serve（Tailscale 網路內）與本機程式連得進來。
// - 路徑白名單：GET /api/tags、POST /api/chat（本機 AI）、/api/cloud/…（雲端 AI）、/api/allay/…（Fairy Hub）。
//   Ollama 的下載、刪除、建立模型等功能一律擋掉。
// - 兩組通行碼、兩種角色（private/ 不會上傳）：
//   fp（FairyPocket，private/ai-token.txt）：本機 AI、雲端 AI、Hub 的手機路徑
//   mc（Minecraft 伺服器，private/hub-mc-token.txt）：只有 Hub 的 Minecraft 路徑；本機 AI 的原始路徑與雲端 AI 一律 403
// - 只接受悅靈網站（與本機開發用網址）的瀏覽器連線；Minecraft 是程式對程式，不帶 Origin。
// - 每次請求最多 64KB；手機每分鐘最多 40 次、Minecraft 另外計算每分鐘最多 600 次（不會互相拖累）。
// - 雲端 AI（/api/cloud/…，要花錢）：只限 fp 角色，而且只限電腦主人本人的 Tailscale 帳號，並有每日／每月花費上限。
//
//   node scripts/ai-proxy.mjs

import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const ORIGINS = new Set(['https://toukichirou8374.github.io', 'http://localhost:4173', 'http://localhost:5173']);
const ROUTES = new Set(['GET /api/tags', 'POST /api/chat', 'POST /api/cloud/chat', 'GET /api/cloud/status']);
/** 雲端 AI（要花錢）：只有 fp 角色、電腦主人本人的 Tailscale 帳號能用 */
const CLOUD = new Set(['POST /api/cloud/chat', 'GET /api/cloud/status']);
const MAX_BODY = 64 * 1024;
const PER_MINUTE = { fp: 40, mc: 600 };

/** 通行碼：好輸入的 4 組 4 個字（約 80 位元），例如 k7m2-9xq4-…（不顯示在畫面上） */
export function loadToken(file, note) {
  try {
    const t = fs.readFileSync(file, 'utf8').match(/^token\s*=\s*(\S+)/m)?.[1];
    if (t) return t;
  } catch {
    /* 還沒有 */
  }
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  const t = [0, 1, 2, 3].map((g) => [0, 1, 2, 3].map((i) => abc[bytes[g * 4 + i] % abc.length]).join('')).join('-');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# ${note}這個檔案在 private/，不會上傳。\ntoken=${t}\n`);
  return t;
}

function same(header, token) {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m || !token) return false;
  const got = Buffer.from(m[1]);
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * 建立轉接服務（不啟動監聽）。測試可以注入通行碼、Ollama 位址、Hub、雲端 AI。
 * @param {{ token: string, mcToken?: string, ollama?: {host:string, port:number}, hub?: {handle:Function}|null,
 *           cloud?: { cloudChat:Function, cloudStatus:Function, isOwner:Function } }} opts
 */
export function createRelay(opts) {
  const OLLAMA = opts.ollama ?? { host: '127.0.0.1', port: 11434 };
  const hub = opts.hub ?? null;
  const cloud = opts.cloud;
  const rate = { fp: { start: Date.now(), n: 0 }, mc: { start: Date.now(), n: 0 } };
  const rateOk = (role) => {
    const r = rate[role];
    const now = Date.now();
    if (now - r.start > 60_000) Object.assign(r, { start: now, n: 0 });
    return ++r.n <= PER_MINUTE[role];
  };
  const roleOf = (req) => (same(req.headers.authorization, opts.token) ? 'fp' : opts.mcToken && same(req.headers.authorization, opts.mcToken) ? 'mc' : null);
  const isHub = (p) => p.startsWith('/api/allay/');
  const known = (method, p) => ROUTES.has(`${method} ${p}`) || (isHub(p) && (method === 'GET' || method === 'POST'));

  return http.createServer((req, res) => {
    const origin = req.headers.origin;
    const p = (req.url ?? '').split('?')[0];
    const route = `${req.method} ${p}`;
    // 瀏覽器來的連線只接受悅靈網站
    if (origin && !ORIGINS.has(origin)) return void res.writeHead(403).end();
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    // 預檢（瀏覽器在送通行碼前會先問）
    if (req.method === 'OPTIONS') {
      const pre = (req.url ?? '').split('?')[0];
      if (!known(String(req.headers['access-control-request-method']), pre) || (isHub(pre) && !hub)) return void res.writeHead(403).end();
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Fairy-Source',
        'Access-Control-Max-Age': '600',
      });
      return void res.end();
    }
    if (!known(req.method, p) || (isHub(p) && !hub)) return void res.writeHead(404).end();
    const role = roleOf(req);
    if (!role) return void res.writeHead(401).end();
    if (!rateOk(role)) return void res.writeHead(429).end();
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return void res.writeHead(413).end();

    // Fairy Hub：角色交給 Hub 判斷每個路徑能不能用
    if (isHub(p)) return void hub.handle(req, res, role);

    // 以下（本機 AI、雲端 AI）只限 FairyPocket；Minecraft 一律不能用
    if (role !== 'fp') {
      res.writeHead(403, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify({ error: CLOUD.has(route) ? 'CLOUD_FORBIDDEN' : 'FORBIDDEN' }));
    }

    if (CLOUD.has(route)) {
      // 連到同一個 Tailscale 網路的其他人不能用雲端 AI；電腦主人本人在外面也可以
      if (!cloud || !cloud.isOwner(req)) return void res.writeHead(403).end();
      const json = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (route === 'GET /api/cloud/status') return void json(200, cloud.cloudStatus());
      let body = '';
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          req.destroy();
          return;
        }
        body += c;
      });
      req.on('end', async () => {
        if (size > MAX_BODY) return json(413, { error: 'too_big' });
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(400, { error: 'bad_json' });
        }
        const [code, obj] = await cloud.cloudChat(parsed);
        json(code, obj);
      });
      return;
    }

    // 轉給 Ollama：改成本機連線，拿掉通行碼和來源（CORS 由這裡處理）
    const headers = { 'content-type': req.headers['content-type'] ?? 'application/json', host: `${OLLAMA.host}:${OLLAMA.port}` };
    const up = http.request({ ...OLLAMA, method: req.method, path: req.url, headers, timeout: 120_000 }, (r) => {
      const out = { 'content-type': r.headers['content-type'] ?? 'application/json' };
      res.writeHead(r.statusCode ?? 502, out);
      r.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        up.destroy();
        if (!res.headersSent) res.writeHead(413);
        res.end();
        req.destroy();
      }
    });
    req.pipe(up);
  });
}

// ---------- 直接執行時：讀設定、啟動 ----------
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cloud = await import('./cloud-ai.mjs');
  const token = loadToken(path.join(ROOT, 'private', 'ai-token.txt'), '悅靈 AI 大腦的通行碼：在 iPhone 悅靈的「設定 → AI 大腦 → 通行碼」輸入。');
  // Fairy Hub 預設關閉（H2 尚未驗收）；private/hub.txt 寫 enabled=1 才啟用
  let hub = null;
  let mcToken;
  const hubCfg = (() => {
    try {
      return fs.readFileSync(path.join(ROOT, 'private', 'hub.txt'), 'utf8');
    } catch {
      return '';
    }
  })();
  if (/^enabled[ \t]*=[ \t]*1\b/m.test(hubCfg)) {
    const { createHub } = await import('./hub/hub.mjs');
    const { ollamaAdapter } = await import('./hub/localai.mjs');
    // 本機模型白名單（Minecraft 用）：model＝使用的模型；model_digest＝（建議）固定的 digest。
    // 每次推論前向本機 Ollama 驗證：不在清單、雲端模型、沒有本機檔案、digest 不符 → 一律改用規則台詞。
    const model = hubCfg.match(/^model[ \t]*=[ \t]*([^\s#]+)/m)?.[1] ?? 'gemma3:4b';
    const digest = hubCfg.match(/^model_digest[ \t]*=[ \t]*([a-f0-9]{64})/m)?.[1];
    mcToken = loadToken(path.join(ROOT, 'private', 'hub-mc-token.txt'), 'Fairy Hub 的 Minecraft 伺服器通行碼（Paper 插件用，跟手機的不同）。');
    hub = createHub({ ai: ollamaAdapter(model, { allow: [model], digest }) });
    const r = hub.report.pets;
    console.log(`Fairy Hub：載入 ${r.loaded.length} 隻、無法載入（資料損壞，已保留證據）${r.failed.length}、中斷的第一次建立 ${r.aborted.length}`);
  }
  const server = createRelay({ token, mcToken, hub, cloud });
  server.listen(11435, '127.0.0.1', () => console.log(`AI 轉接程式：http://127.0.0.1:11435 → Ollama 127.0.0.1:11434${hub ? '（含 Fairy Hub）' : ''}`));
}
