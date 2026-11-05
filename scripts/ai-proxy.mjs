// 悅靈 AI 大腦的轉接程式（只在這台電腦內部運作）：
//   iPhone ─(Tailscale HTTPS)→ tailscale serve → 這個程式 127.0.0.1:11435 → Ollama 127.0.0.1:11434
// Ollama 只接受「本機」的連線（安全檢查），Tailscale 轉過來的連線會被擋，所以這裡把連線改成本機的再轉給 Ollama。
// 只聽 127.0.0.1，區域網路、外部網路都連不到；只轉 Ollama 的 /api/ 路徑；哪些網站可以用由 Ollama 的 OLLAMA_ORIGINS 決定。
//
//   node scripts/ai-proxy.mjs

import http from 'node:http';

const LISTEN = { host: '127.0.0.1', port: 11435 };
const OLLAMA = { host: '127.0.0.1', port: 11434 };

const server = http.createServer((req, res) => {
  if (!req.url?.startsWith('/api/')) {
    res.writeHead(404).end();
    return;
  }
  const headers = { ...req.headers, host: `${OLLAMA.host}:${OLLAMA.port}` };
  const up = http.request({ ...OLLAMA, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(up);
});

server.listen(LISTEN.port, LISTEN.host, () => console.log(`AI 轉接程式：http://${LISTEN.host}:${LISTEN.port} → Ollama ${OLLAMA.host}:${OLLAMA.port}`));
