// 悅靈 AI 大腦的轉接程式（只在這台電腦內部運作）：
//   iPhone ─(Tailscale HTTPS)→ tailscale serve → 這個程式 127.0.0.1:11435 → Ollama 127.0.0.1:11434
//
// 安全防護：
// - 只聽 127.0.0.1：區域網路、外部網路都連不到，只有 tailscale serve（Tailscale 網路內）轉得進來。
// - 只開放悅靈用到的兩個功能：GET /api/tags（看有哪些模型）、POST /api/chat（聊天）。
//   Ollama 的下載、刪除、建立模型等功能一律擋掉。
// - 要有通行碼（private/ai-token.txt，第一次執行時自動產生；private/ 不會上傳）。
// - 只接受悅靈網站（與本機開發用網址）的瀏覽器連線。
// - 每次請求最多 64KB、每分鐘最多 40 次，避免被拿去大量使用、拖慢電腦（同一台還有 Minecraft 伺服器）。
//
//   node scripts/ai-proxy.mjs

import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOKEN_FILE = path.join(ROOT, 'private', 'ai-token.txt');
const LISTEN = { host: '127.0.0.1', port: 11435 };
const OLLAMA = { host: '127.0.0.1', port: 11434 };
const ORIGINS = new Set(['https://toukichirou8374.github.io', 'http://localhost:4173', 'http://localhost:5173']);
const ROUTES = new Set(['GET /api/tags', 'POST /api/chat']);
const MAX_BODY = 64 * 1024;
const PER_MINUTE = 40;

/** 通行碼：好輸入的 4 組 4 個字（約 80 位元），例如 k7m2-9xq4-…（不顯示在畫面上） */
function loadToken() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').match(/^token\s*=\s*(\S+)/m)?.[1];
    if (t) return t;
  } catch {
    /* 還沒有 */
  }
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  const t = [0, 1, 2, 3].map((g) => [0, 1, 2, 3].map((i) => abc[bytes[g * 4 + i] % abc.length]).join('')).join('-');
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, `# 悅靈 AI 大腦的通行碼：在 iPhone 悅靈的「設定 → AI 大腦 → 通行碼」輸入。這個檔案在 private/，不會上傳。\ntoken=${t}\n`);
  return t;
}
const TOKEN = Buffer.from(loadToken());

function tokenOk(header) {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m) return false;
  const got = Buffer.from(m[1]);
  return got.length === TOKEN.length && timingSafeEqual(got, TOKEN);
}

let windowStart = Date.now();
let count = 0;
function rateOk() {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    count = 0;
  }
  return ++count <= PER_MINUTE;
}

function cors(res, origin) {
  if (origin && ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const route = `${req.method} ${(req.url ?? '').split('?')[0]}`;
  // 瀏覽器來的連線只接受悅靈網站
  if (origin && !ORIGINS.has(origin)) return void res.writeHead(403).end();
  cors(res, origin);
  // 預檢（瀏覽器在送通行碼前會先問）
  if (req.method === 'OPTIONS') {
    if (!ROUTES.has(`${req.headers['access-control-request-method']} ${(req.url ?? '').split('?')[0]}`)) return void res.writeHead(403).end();
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600',
    });
    return void res.end();
  }
  if (!ROUTES.has(route)) return void res.writeHead(404).end();
  if (!tokenOk(req.headers.authorization)) return void res.writeHead(401).end();
  if (!rateOk()) return void res.writeHead(429).end();
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return void res.writeHead(413).end();

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

server.listen(LISTEN.port, LISTEN.host, () => console.log(`AI 轉接程式：http://${LISTEN.host}:${LISTEN.port} → Ollama ${OLLAMA.host}:${OLLAMA.port}`));
