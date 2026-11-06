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

/**
 * H3-2：從 private/hub.txt 讀排程設定（超出範圍或格式錯就用預設值，不會讓排程失效）
 *   ai_queue=8（1–32）、ai_timeout_ms=12000（1000–60000）、ai_wait_ms=（500–60000，預設＝ai_timeout_ms）
 */
export function schedulerOptsFrom(text = '') {
  const get = (k, lo, hi) => {
    const line = String(text).split(/\r?\n/).find((l) => l.split('=')[0].trim() === k);
    const raw = line ? line.slice(line.indexOf('=') + 1).replace(/#.*/, '').trim() : '';
    const v = /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
  };
  const o = { capacity: get('ai_queue', 1, 32) ?? 8, timeoutMs: get('ai_timeout_ms', 1000, 60000) ?? 12000 };
  o.waitMs = get('ai_wait_ms', 500, 60000) ?? o.timeoutMs;
  return o;
}

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
      // H3-2.2：先確認 HTTP 狀態是 200；不是 200 就算內容格式正確也不採用（讀掉內容、釋放連線）
      if (r.statusCode !== 200) {
        r.resume();
        const e = new Error(`http_${r.statusCode}`);
        e.code = 'HTTP_STATUS';
        return reject(e);
      }
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
  const adapter = {
    route: 'LOCAL_OLLAMA',
    lastCheck: null,
    /** 本機模型清單查詢次數（測試用） */
    checks: 0,
    /**
     * H3-2.1：每一次推論前都重新向 Ollama 查詢並驗證目前的模型資料，不沿用任何先前的成功結果。
     * 查詢失敗、資料不完整、digest 不符、出現遠端特徵 → false（呼叫端改用規則台詞，不送聊天推論）。
     * 注意：查詢與實際推論之間仍有時間差，這不能完全消除服務層的風險。
     */
    async verify(signal) {
      adapter.checks++;
      let r;
      try {
        r = verifyLocalModel(await getJson(host, port, '/api/tags', 5_000, signal), model, allow, opts.digest);
      } catch (e) {
        // 連不上、逾時、JSON 壞掉、HTTP 狀態不是 200 → 都不採用（原因沿用 unreachable，狀態碼放在 detail）
        r = { ok: false, why: 'unreachable', detail: String(e?.message ?? e) };
      }
      adapter.lastCheck = r;
      return r.ok;
    },
    async ask(system, messages, { signal, timeoutMs } = {}) {
      if (!(await adapter.verify(signal))) throw new Error(`unverified:${adapter.lastCheck?.why}`);
      const body = JSON.stringify({ model, stream: false, keep_alive: '30m', options: { temperature: 0.8, num_predict: 160 }, messages: [{ role: 'system', content: system }, ...messages] });
      return new Promise((resolve, reject) => {
        const req = http.request(
          { host, port, method: 'POST', path: '/api/chat', headers: { 'content-type': 'application/json' }, timeout: timeoutMs, signal },
          (r) => {
            // H3-2.2：先確認 HTTP 狀態是 200，才驗證 model、文字與其他欄位；
            // 不是 200 就算回答內容格式正確也不接受（讀掉內容、釋放連線，交給排程器改用規則台詞）
            if (r.statusCode !== 200) {
              r.resume();
              return reject(new Error(`http_${r.statusCode}`));
            }
            let out = '';
            r.setEncoding('utf8');
            r.on('data', (c) => (out += c));
            r.on('end', () => {
              try {
                const j = JSON.parse(out);
                // H3-2：量測用（預設沒有）。只回報 Ollama 自己的計時欄位與回應的欄位名稱，不含內容
                opts.onResult?.({
                  model: j?.model, keys: Object.keys(j ?? {}), done_reason: j?.done_reason,
                  total_duration: j?.total_duration, load_duration: j?.load_duration,
                  prompt_eval_count: j?.prompt_eval_count, prompt_eval_duration: j?.prompt_eval_duration,
                  eval_count: j?.eval_count, eval_duration: j?.eval_duration,
                });
                // H3-2.1：回應的模型身分必須存在、是字串、且與本次允許的模型名稱完全相同；
                // 缺少、null、型別錯誤、名稱不符 → 不接受（呼叫端改用規則台詞，異常內容不會交給玩家）
                if (typeof j?.model !== 'string' || j.model !== model) return reject(new Error('model_identity'));
                if (Object.keys(j).some((k) => /remote/i.test(k))) return reject(new Error('remote_reply'));
                if (typeof j?.message?.content !== 'string') return reject(new Error('bad_reply'));
                resolve(j.message.content);
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
   * @param {{ capacity?: number, timeoutMs?: number, waitMs?: number }} opts
   *   timeoutMs：底層推論的逾時；waitMs（H3-2）：在佇列中最多等多久（預設與 timeoutMs 相同，跟之前一樣）
   */
  constructor(adapter, opts = {}) {
    checkRoute(adapter.route);
    this.adapter = adapter;
    this.capacity = opts.capacity ?? 8;
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.waitMs = opts.waitMs ?? this.timeoutMs;
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
      }, this.waitMs);
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
