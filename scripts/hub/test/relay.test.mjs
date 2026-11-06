// 既有轉接服務的行為不變：手機照常轉到 Ollama（這裡用假的 Ollama）、危險路徑擋掉、大小限制、預檢
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createRelay } from '../../ai-proxy.mjs';
import { FP_TOKEN, MC_TOKEN } from './helpers.mjs';

async function setup(t, withHub = false) {
  const seen = [];
  const ollama = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, auth: req.headers.authorization, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
  });
  await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
  const hub = withHub ? { handle: (_q, res, role) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ role })) } : null;
  const relay = createRelay({ token: FP_TOKEN, mcToken: MC_TOKEN, hub, ollama: { host: '127.0.0.1', port: ollama.address().port } });
  await new Promise((r) => relay.listen(0, '127.0.0.1', r));
  t.after(() => {
    relay.closeAllConnections?.();
    relay.close();
    ollama.close();
  });
  return { seen, base: `http://127.0.0.1:${relay.address().port}` };
}

test('手機照常使用本機 AI：轉給 Ollama，拿掉通行碼、改成本機 Host', async (t) => {
  const { seen, base } = await setup(t);
  const r = await fetch(`${base}/api/tags`, { headers: { authorization: `Bearer ${FP_TOKEN}`, origin: 'https://toukichirou8374.github.io' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://toukichirou8374.github.io');
  const c = await fetch(`${base}/api/chat`, { method: 'POST', headers: { authorization: `Bearer ${FP_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gemma3:4b', messages: [] }) });
  assert.equal(c.status, 200);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].auth, undefined, '通行碼不會轉給 Ollama');
  assert.match(seen[1].host, /^127\.0\.0\.1:/);
});

test('Ollama 的危險功能、不在白名單的路徑一律 404；太大的請求 413；沒通行碼 401', async (t) => {
  const { seen, base } = await setup(t);
  const auth = { authorization: `Bearer ${FP_TOKEN}` };
  for (const [m, p] of [['DELETE', '/api/delete'], ['POST', '/api/pull'], ['POST', '/api/create'], ['GET', '/api/ps']]) assert.equal((await fetch(base + p, { method: m, headers: auth })).status, 404, p);
  assert.equal((await fetch(`${base}/api/tags`)).status, 401);
  const big = await fetch(`${base}/api/chat`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: 'x'.repeat(70 * 1024) });
  assert.equal(big.status, 413);
  assert.equal(seen.length, 0, '都沒有轉給 Ollama');
});

test('預檢：允許的路徑回 204；Hub 關閉時 Hub 路徑的預檢 403', async (t) => {
  const { base } = await setup(t);
  const pre = (p) => fetch(base + p, { method: 'OPTIONS', headers: { origin: 'https://toukichirou8374.github.io', 'access-control-request-method': 'POST' } });
  assert.equal((await pre('/api/chat')).status, 204);
  assert.equal((await pre('/api/allay/events')).status, 403);
  assert.equal((await pre('/api/pull')).status, 403);
});

test('Hub 開啟時：依通行碼把角色交給 Hub；Minecraft 憑證走 Ollama 一律 403', async (t) => {
  const { seen, base } = await setup(t, true);
  const fp = await fetch(`${base}/api/allay/whoami`, { headers: { authorization: `Bearer ${FP_TOKEN}` } });
  const mc = await fetch(`${base}/api/allay/whoami`, { headers: { authorization: `Bearer ${MC_TOKEN}` } });
  assert.deepEqual([(await fp.json()).role, (await mc.json()).role], ['fp', 'mc']);
  assert.equal((await fetch(`${base}/api/tags`, { headers: { authorization: `Bearer ${MC_TOKEN}` } })).status, 403);
  assert.equal(seen.length, 0);
});
