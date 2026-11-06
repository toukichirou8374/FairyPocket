// Fairy Hub：Minecraft 用的 AI（只限本機）與排程
// - 路由只有 RULES 與 LOCAL_OLLAMA；雲端、其他供應商、網址、大小寫變形一律拒絕（程式條件，不是 prompt）
// - 本機模型白名單＋每次推論前驗證（fail-closed）：模型必須在白名單、出現在本機 Ollama 的模型清單、
//   不是 Ollama 雲端模型（名稱含 cloud、或帶 remote_host／remote_model）、有本機大小與 digest，
//   有設定 digest 時還要完全相符。無法驗證（Ollama 沒回應、格式不對…）就退回規則台詞。
//   另建議在 Ollama 端設定 OLLAMA_NO_CLOUD=1（官方的停用雲端機制）；Hub 不修改、不重啟使用中的 Ollama。
// - 排程：同時只有 1 個底層請求在跑；逾時會「取消」底層請求（AbortSignal），
//   並且等底層請求真的結束後才釋放執行名額；在佇列中等太久也直接退回規則

import http from 'node:http';
import { fail } from './schema.mjs';

export const ROUTES = Object.freeze(['RULES', 'LOCAL_OLLAMA']);

/** 檢查設定的路由；只有完全等於白名單的字串可以通過 */
export function checkRoute(route) {
  if (typeof route !== 'string' || !ROUTES.includes(route)) fail(403, 'CLOUD_FORBIDDEN', { route: String(route).slice(0, 40) });
  return route;
}

const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9._-]+)?$/;
/** 看起來像 Ollama 雲端模型的名稱（例如 gpt-oss:120b-cloud、xxx:cloud） */
const looksCloud = (name) => /(^|[:._-])cloud($|[:._-])/i.test(name);

/**
 * 驗證本機 Ollama 的模型清單（GET /api/tags 的回應）是否允許使用這個模型。
 * 回傳 { ok: true, digest } 或 { ok: false, why }。
 */
export function verifyLocalModel(tags, model, allow, digest) {
  if (typeof model !== 'string' || !MODEL_NAME_RE.test(model) || looksCloud(model)) return { ok: false, why: 'model_name' };
  if (!Array.isArray(allow) || !allow.includes(model)) return { ok: false, why: 'not_allowed' };
  const list = tags?.models;
  if (!Array.isArray(list)) return { ok: false, why: 'bad_tags' };
  const m = list.find((x) => x && (x.name === model || x.model === model));
  if (!m) return { ok: false, why: 'not_installed' };
  if (m.remote_host !== undefined || m.remote_model !== undefined || looksCloud(String(m.name ?? '')) || looksCloud(String(m.model ?? ''))) return { ok: false, why: 'cloud_model' };
  if (!(typeof m.size === 'number' && m.size > 0)) return { ok: false, why: 'no_local_size' };
  if (typeof m.digest !== 'string' || !/^[a-f0-9]{64}$/.test(m.digest)) return { ok: false, why: 'no_digest' };
  if (digest && m.digest !== digest) return { ok: false, why: 'digest_mismatch' };
  return { ok: true, digest: m.digest };
}

function getJson(host, port, path, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, method: 'GET', path, timeout: timeoutMs, signal }, (r) => {
      let out = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (out += c));
      r.on('end', () => {
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error('bad_json'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * 真正的本機 Ollama。opts.allow：允許的模型名稱；opts.digest：（建議）固定的 digest。
 * 位址固定為本機，不能設定網址。測試可以用 opts.port 指向假的 Ollama。
 */
export function ollamaAdapter(model, opts = {}) {
  const host = '127.0.0.1';
  const port = opts.port ?? 11434;
  const allow = opts.allow ?? [model];
  const ttl = opts.verifyTtlMs ?? 60_000;
  let verified = { at: -Infinity, ok: false };
  const adapter = {
    route: 'LOCAL_OLLAMA',
    lastCheck: null,
    /** 每次推論前驗證（結果快取 ttl 毫秒；驗證失敗不快取，下次重驗） */
    async verify(signal) {
      if (verified.ok && Date.now() - verified.at < ttl) return true;
      let r;
      try {
        r = verifyLocalModel(await getJson(host, port, '/api/tags', 5_000, signal), model, allow, opts.digest);
      } catch {
        r = { ok: false, why: 'unreachable' };
      }
      adapter.lastCheck = r;
      verified = { at: Date.now(), ok: r.ok };
      return r.ok;
    },
    async ask(system, messages, { signal, timeoutMs } = {}) {
      if (!(await adapter.verify(signal))) throw new Error(`unverified:${adapter.lastCheck?.why}`);
      const body = JSON.stringify({ model, stream: false, keep_alive: '30m', options: { temperature: 0.8, num_predict: 160 }, messages: [{ role: 'system', content: system }, ...messages] });
      return new Promise((resolve, reject) => {
        const req = http.request(
          { host, port, method: 'POST', path: '/api/chat', headers: { 'content-type': 'application/json' }, timeout: timeoutMs, signal },
          (r) => {
            let out = '';
            r.setEncoding('utf8');
            r.on('data', (c) => (out += c));
            r.on('end', () => {
              try {
                const j = JSON.parse(out);
                // 回應的模型必須就是驗證過的那個
                if (j?.model !== undefined && j.model !== model) return reject(new Error('model_changed'));
                resolve(String(j?.message?.content ?? ''));
              } catch {
                reject(new Error('bad_reply'));
              }
            });
            r.on('error', reject);
          },
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end(body);
      });
    },
  };
  return adapter;
}

const RULE_LINES = {
  zh_tw: ['嗯嗯！我在這裡喔～', '我們繼續冒險吧！', '好呀，我跟著你！'],
  ja_jp: ['うんうん！ここにいるよ～', 'ぼうけんをつづけよう！', 'いいよ、ついていくね！'],
  en_us: ["Mm-hm! I'm right here~", "Let's keep exploring!", "Okay, I'll follow you!"],
};
export const ruleLine = (lang, n = 0) => {
  const l = RULE_LINES[lang] ?? RULE_LINES.zh_tw;
  return l[n % l.length];
};

export class Scheduler {
  /**
   * @param {{ ask(system:string, messages:object[], o:{signal:AbortSignal, timeoutMs:number}): Promise<string>, route:string }} adapter
   * @param {{ capacity?: number, timeoutMs?: number }} opts
   */
  constructor(adapter, opts = {}) {
    checkRoute(adapter.route);
    this.adapter = adapter;
    this.capacity = opts.capacity ?? 8;
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.queue = [];
    /** 底層請求還在跑的工作（逾時後也要等它真的停下來才算空出名額） */
    this.running = null;
    this.stats = { done: 0, fallback: 0, busy: 0, full: 0, aborted: 0, maxInFlight: 0, inFlight: 0 };
  }

  /** 送出一個請求；回傳 { route, text }（失敗、逾時、等太久都是 RULES 的台詞） */
  submit(pet, system, messages, fallbackText) {
    // 每隻悅靈：最多 1 個執行中＋1 個等待中
    if (this.queue.some((j) => j.pet === pet)) {
      this.stats.busy++;
      fail(429, 'PET_BUSY');
    }
    if (this.queue.length >= this.capacity) {
      this.stats.full++;
      fail(503, 'QUEUE_FULL');
    }
    return new Promise((resolve) => {
      const job = { pet, system, messages, fallbackText, resolve, answered: false };
      // 在佇列裡等太久：直接回規則台詞並移出佇列（不會等到前面卡住的工作）
      job.waitTimer = setTimeout(() => {
        const i = this.queue.indexOf(job);
        if (i >= 0) {
          this.queue.splice(i, 1);
          this.#answer(job, { route: 'RULES', text: fallbackText, reason: 'queue_timeout' });
        }
      }, this.timeoutMs);
      this.queue.push(job);
      this.#pump();
    });
  }

  #answer(job, r) {
    if (job.answered) return;
    job.answered = true;
    if (r.route === 'RULES') this.stats.fallback++;
    this.stats.done++;
    job.resolve(r);
  }

  #pump() {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift();
    clearTimeout(job.waitTimer);
    this.running = job;
    const ctl = new AbortController();
    this.stats.inFlight++;
    this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.stats.inFlight);
    const timer = setTimeout(() => {
      // 逾時：先回規則台詞給玩家，並取消底層請求；名額要等底層真的結束才釋放
      this.stats.aborted++;
      this.#answer(job, { route: 'RULES', text: job.fallbackText, reason: 'timeout' });
      ctl.abort(new Error('timeout'));
    }, this.timeoutMs);
    Promise.resolve()
      .then(() => this.adapter.ask(job.system, job.messages, { signal: ctl.signal, timeoutMs: this.timeoutMs }))
      .then(
        (text) => this.#answer(job, typeof text === 'string' && text.trim() && !ctl.signal.aborted ? { route: this.adapter.route, text } : { route: 'RULES', text: job.fallbackText, reason: 'empty' }),
        () => this.#answer(job, { route: 'RULES', text: job.fallbackText, reason: 'error' }),
      )
      .finally(() => {
        clearTimeout(timer);
        this.stats.inFlight--;
        this.running = null;
        this.#pump();
      });
  }
}
