// Fairy Hub：Minecraft 用的 AI（只限本機）與排程
// - 路由只有 RULES 與 LOCAL_OLLAMA（固定 127.0.0.1:11434，不能設定網址）；雲端、其他供應商、網址、大小寫變形一律拒絕
// - 這是程式條件，不是 prompt；失敗一律退回規則台詞，絕不改用雲端或 FairyPocket 的雲端設定
// - 排程：同時只跑一個；佇列有上限；每隻悅靈最多 1 個執行中＋1 個等待中；逾時就退回規則

import http from 'node:http';
import { fail } from './schema.mjs';

export const ROUTES = Object.freeze(['RULES', 'LOCAL_OLLAMA']);

/** 檢查設定的路由；只有完全等於白名單的字串可以通過 */
export function checkRoute(route) {
  if (typeof route !== 'string' || !ROUTES.includes(route)) fail(403, 'CLOUD_FORBIDDEN', { route: String(route).slice(0, 40) });
  return route;
}

/** 真正的本機 Ollama（只有正式執行時用；測試注入假的） */
export function ollamaAdapter(model = 'gemma3:4b') {
  return {
    route: 'LOCAL_OLLAMA',
    ask(system, messages, timeoutMs) {
      const body = JSON.stringify({ model, stream: false, keep_alive: '30m', options: { temperature: 0.8, num_predict: 160 }, messages: [{ role: 'system', content: system }, ...messages] });
      return new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port: 11434, method: 'POST', path: '/api/chat', headers: { 'content-type': 'application/json' }, timeout: timeoutMs },
          (r) => {
            let out = '';
            r.setEncoding('utf8');
            r.on('data', (c) => (out += c));
            r.on('end', () => {
              try {
                resolve(String(JSON.parse(out)?.message?.content ?? ''));
              } catch {
                reject(new Error('bad_reply'));
              }
            });
          },
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end(body);
      });
    },
  };
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
   * @param {{ ask(system:string, messages:object[], timeoutMs:number): Promise<string>, route:string }} adapter
   * @param {{ capacity?: number, timeoutMs?: number }} opts
   */
  constructor(adapter, opts = {}) {
    checkRoute(adapter.route);
    this.adapter = adapter;
    this.capacity = opts.capacity ?? 8;
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.queue = [];
    this.running = null;
    this.stats = { done: 0, fallback: 0, busy: 0, full: 0 };
  }

  /** 送出一個請求；回傳 { route, text }（失敗或逾時是 RULES 的台詞） */
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
      this.queue.push({ pet, system, messages, fallbackText, resolve });
      this.#pump();
    });
  }

  #pump() {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift();
    this.running = job;
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (r.route === 'RULES') this.stats.fallback++;
      this.stats.done++;
      this.running = null;
      job.resolve(r);
      this.#pump();
    };
    const timer = setTimeout(() => done({ route: 'RULES', text: job.fallbackText, reason: 'timeout' }), this.timeoutMs);
    Promise.resolve()
      .then(() => this.adapter.ask(job.system, job.messages, this.timeoutMs))
      .then(
        (text) => done(typeof text === 'string' && text.trim() ? { route: this.adapter.route, text } : { route: 'RULES', text: job.fallbackText, reason: 'empty' }),
        () => done({ route: 'RULES', text: job.fallbackText, reason: 'error' }),
      );
  }
}
