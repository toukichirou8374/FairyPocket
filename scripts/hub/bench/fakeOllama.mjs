// H3-2：假的 Ollama（只在測試與合成負載用，不連真正的 Ollama）
// - GET /api/tags：可設定的模型清單（含本機模型、雲端模型）
// - POST /api/chat：依延遲模型等待後回答；可設定同時處理幾個（模擬 OLLAMA_NUM_PARALLEL）
// - 用戶端中途斷線（Hub 取消）→ 立刻停止「推論」並記錄 aborted（模擬 Ollama 取消請求的行為）
// - 記錄：實際並行數、最大並行數、每個請求的模型名稱、是否請求了雲端模型

import http from 'node:http';

export const LOCAL_DIGEST = 'a'.repeat(64);
export const localModel = (over = {}) => ({ name: 'gemma3:4b', model: 'gemma3:4b', size: 3_338_801_804, digest: LOCAL_DIGEST, details: { format: 'gguf', family: 'gemma3' }, ...over });
/** replyModel 回傳這個值時，回應裡完全不放 model 欄位 */
export const OMIT = Symbol('omit');
export const cloudModel = () => ({ name: 'gpt-oss:120b-cloud', model: 'gpt-oss:120b-cloud', size: 384, digest: 'c'.repeat(64), remote_host: 'https://ollama.com:443', remote_model: 'gpt-oss:120b' });

/**
 * @param {{ models?: object[], parallel?: number, latencyMs?: (n:number)=>number, reply?: string, failRate?: number, seed?: number }} opts
 *   latencyMs(n)：第 n 個請求的處理時間（毫秒，已含時間縮放）
 */
export async function startFakeOllama(opts = {}) {
  const st = {
    models: opts.models ?? [localModel()],
    parallel: opts.parallel ?? 1,
    reply: opts.reply ?? '[開心] 好呀，我們一起去探險！',
    inFlight: 0, maxInFlight: 0, requests: 0, completed: 0, aborted: 0, cloudRequested: 0,
    modelsSeen: [], options: [], waiting: [],
    // H3-2.1：模擬異常回應與清單
    tagsRequests: 0,
    /** 'json'：回傳壞掉的 JSON；'status'：回 500 */
    tagsBroken: null,
    /** 回應的 model 欄位（預設與請求相同；回傳 OMIT 表示不放） */
    replyModel: (requested) => requested,
    /** 回應額外加的欄位（例如 remote_host） */
    replyExtra: {},
    // H3-2.2：回應的 HTTP 狀態碼（預設 200；用來模擬「狀態碼失敗、但 JSON 內容正確」）
    tagsStatus: 200,
    chatStatus: 200,
  };
  let n = 0;
  const latency = opts.latencyMs ?? (() => 20);
  // 同時處理數上限：超過的請求在 Ollama 內部排隊（跟真正的 Ollama 一樣）
  const acquire = () => {
    if (st.inFlight < st.parallel) {
      st.inFlight++;
      st.maxInFlight = Math.max(st.maxInFlight, st.inFlight);
      return Promise.resolve();
    }
    return new Promise((r) =>
      st.waiting.push(() => {
        st.inFlight++;
        st.maxInFlight = Math.max(st.maxInFlight, st.inFlight);
        r();
      }),
    );
  };
  const release = () => {
    st.inFlight--;
    st.waiting.shift()?.();
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      if (req.method === 'GET' && req.url === '/api/tags') {
        st.tagsRequests++;
        if (st.tagsBroken === 'status') return void res.writeHead(500).end();
        if (st.tagsBroken === 'json') {
          res.writeHead(200, { 'content-type': 'application/json' });
          return void res.end('{"models": [');
        }
        // H3-2.2：tagsStatus 可以模擬「狀態碼不是 200、但內容是正確的模型清單」
        res.writeHead(st.tagsStatus, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ models: st.models }));
      }
      if (req.method === 'GET' && req.url === '/api/version') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ version: 'fake' }));
      }
      if (req.method === 'GET' && req.url === '/api/ps') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ models: [] }));
      }
      if (req.method !== 'POST' || req.url !== '/api/chat') return void res.writeHead(404).end();
      st.requests++;
      let j = {};
      try {
        j = JSON.parse(body);
      } catch {
        /* 格式錯 */
      }
      st.modelsSeen.push(j.model);
      st.options.push({ options: j.options, keep_alive: j.keep_alive, stream: j.stream });
      if (/cloud/i.test(String(j.model))) st.cloudRequested++;
      let gone = false;
      res.on('close', () => {
        if (!res.writableEnded) gone = true;
      });
      await acquire();
      if (gone) {
        // 還在 Ollama 內部排隊時就被取消
        st.aborted++;
        release();
        return;
      }
      const ms = latency(n++);
      const done = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(true), ms);
        res.on('close', () => {
          if (!res.writableEnded) {
            clearTimeout(t);
            resolve(false);
          }
        });
      });
      if (!done) {
        st.aborted++;
        release();
        return;
      }
      st.completed++;
      release();
      if (res.destroyed) return;
      res.writeHead(st.chatStatus, { 'content-type': 'application/json' });
      const reply = { ...st.replyExtra, message: { role: 'assistant', content: st.reply }, done: true };
      const rm = st.replyModel(j.model);
      if (rm !== OMIT) reply.model = rm;
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    stats: st,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}
