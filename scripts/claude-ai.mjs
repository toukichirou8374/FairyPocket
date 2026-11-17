// 悅靈的第三個 AI 來源（AI 3.0）：Anthropic Claude（Sonnet 5.5／Opus 5.5／Fable 5.2）。只由家裡電腦的轉接程式代送。
// 跟 cloud-ai.mjs（Haiku，既有雲端）分開：自己的設定、自己的花費上限、自己的用量紀錄。
//
// 安全：
// - 金鑰只在 private/claude.txt（不上傳、不進 Git、不寫進任何紀錄）；手機、網頁永遠拿不到金鑰
// - 預設「關閉」（enabled=0）：製作人在 private/claude.txt 打開、並放入金鑰後才會真的呼叫
// - fake=1：不連網，回固定的假回應（測試用；不花錢）
// - 只有電腦主人本人的 Tailscale 帳號能用（跟既有雲端 AI 相同，轉接程式檢查）
// - 花費：每次呼叫前先用「最壞情況」估價，超過今天／這個月剩下的額度就不呼叫；每次呼叫記模型與 token（不記內容）
// - 同時只跑 1 個請求；不自動重試（重試也要花錢）；429 會回傳要等幾秒
// - Claude 的回答只是「候選回覆／行動提案」：手機那邊照舊用白名單解析，不能改個性、記憶、需求、成長，也不能直接控制身體

import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** 三種深度。Fable 只在製作人明確選擇時使用（手機那邊的路由也不會自己升到 Fable） */
export const MODELS = {
  sonnet: { id: 'claude-sonnet-5-5', input: 2 / 1e6, output: 10 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 2.5 / 1e6, timeoutMs: 20_000 },
  opus: { id: 'claude-opus-5-5', input: 4 / 1e6, output: 20 / 1e6, cacheRead: 0.2 / 1e6, cacheWrite: 5 / 1e6, timeoutMs: 30_000 },
  fable: { id: 'claude-fable-5-2', input: 8 / 1e6, output: 40 / 1e6, cacheRead: 0.2 / 1e6, cacheWrite: 10 / 1e6, timeoutMs: 40_000 },
};
/** 聊天的回答很短，但 Opus／Fable 一定會先想（thinking 算在輸出裡），所以上限給大一點 */
const MAX_TOKENS = { sonnet: 600, opus: 1500, fable: 1500 };
const MAX_SYSTEM = 6000;
const MAX_TURNS = 8;
const MAX_TURN_CHARS = 600;

const TEMPLATE = [
  '# 悅靈的第三個 AI 來源（Anthropic Claude：Sonnet 5.5／Opus 5.5／Fable 5.2）。這個檔案在 private/，不會上傳。',
  '# 預設關閉。要打開：enabled=1，並把金鑰放在 key=（或 key_source=cloud 共用 private/cloud.txt 的金鑰）。',
  '# 金鑰不要貼到聊天、不要寫進其他檔案。',
  'enabled=0',
  '# 1＝不連網，只回固定的假回應（測試用，不花錢）',
  'fake=0',
  '# own＝用下面的 key；cloud＝共用 private/cloud.txt 的金鑰',
  'key_source=own',
  'key=',
  '# 花費上限（美元，後端強制）。預設：每天 0.30、每月 4（約 600 日圓）',
  'daily_usd=0.30',
  'monthly_usd=4',
  '',
].join('\n');

function parseCfg(txt) {
  // 只看同一行（[ \t]，不能用 \s，不然空的值會讀到下一行）
  const get = (k) => txt.match(new RegExp(`^${k}[ \\t]*=[ \\t]*([^\\s#]*)`, 'm'))?.[1] ?? '';
  const num = (k, d) => {
    const v = Number(get(k));
    return Number.isFinite(v) && v >= 0 && get(k) !== '' ? v : d;
  };
  return {
    enabled: get('enabled') === '1',
    fake: get('fake') === '1',
    keySource: get('key_source') === 'cloud' ? 'cloud' : 'own',
    key: get('key'),
    daily: num('daily_usd', 0.3),
    monthly: num('monthly_usd', 4),
  };
}

const today = (now) => new Date(now).toLocaleDateString('sv-SE');

/** 整理手機送來的對話：只留文字、限制長度、只留最近幾句、第一句與最後一句都是使用者 */
export function cleanRequest(body) {
  const system = String(body?.system ?? '').slice(0, MAX_SYSTEM);
  let messages = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_TURN_CHARS) }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;
  const lang = typeof body?.langRule === 'string' ? body.langRule.slice(0, 500) : '';
  const depth = body?.depth === 'opus' || body?.depth === 'fable' ? body.depth : 'sonnet';
  const reqId = typeof body?.reqId === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(body.reqId) ? body.reqId : `r${Date.now().toString(36)}`;
  return { system: lang ? `${system}\n\n${lang}` : system, messages, depth, reqId };
}

/** 輸入 token 數的高估：中文、日文大約 1 字 1 token（實測 2026-11-17：中文 1261 字＝1500 token），英文大約 3 字 1 token；都再乘 1.5 */
export function estTokens(text) {
  const wide = (text.match(/[^\x00-\x7f]/g) ?? []).length;
  return Math.ceil((wide + (text.length - wide) / 3) * 1.5);
}

/** 呼叫前的「最壞情況」估價（輸入用 estTokens 高估；輸出用上限算） */
export function worstCaseUsd(req) {
  const m = MODELS[req.depth];
  const tokens = estTokens(req.system) + req.messages.reduce((s, x) => s + estTokens(x.content), 0);
  return tokens * m.input + MAX_TOKENS[req.depth] * m.output;
}

export function usageUsd(depth, usage) {
  const m = MODELS[depth];
  return (
    (usage?.input_tokens ?? 0) * m.input +
    (usage?.output_tokens ?? 0) * m.output +
    (usage?.cache_creation_input_tokens ?? 0) * m.cacheWrite +
    (usage?.cache_read_input_tokens ?? 0) * m.cacheRead
  );
}

/** 依深度組成 API 參數（不送 temperature 等取樣參數、不預填回答） */
export function buildParams(req) {
  const p = {
    model: MODELS[req.depth].id,
    max_tokens: MAX_TOKENS[req.depth],
    system: req.system,
    messages: req.messages,
    // 聊天用：想得少一點，又快又省
    output_config: { effort: 'low' },
  };
  // Sonnet 5.5 不能送 disabled（會 400）；用 between_tools 關掉思考
  if (req.depth === 'sonnet') p.thinking = { type: 'between_tools' };
  // Opus 5.5 的思考不能關（只用 effort 控制）；Fable 5.2 一定會思考（不送 thinking）
  if (req.depth === 'fable') {
    // 拒答時由伺服器改用 Anthropic 建議的模型回答（同一次呼叫內，不會另外同時叫好幾個付費模型）。
    // 實測（2026-11-17）：Opus 5.5 不在 Fable 5.2 允許的備援名單裡（400），所以用 "default"
    p.betas = ['server-side-fallback-2026-07-01'];
    p.fallbacks = 'default';
  }
  return p;
}

/**
 * 建立 Claude 來源。測試時可以注入 files（設定／用量／紀錄的位置）、client（假的 Anthropic）、now（時間）。
 */
export function createClaude({
  cfgFile = path.join(ROOT, 'private', 'claude.txt'),
  cloudCfgFile = path.join(ROOT, 'private', 'cloud.txt'),
  usageFile = path.join(ROOT, 'private', 'claude-usage.json'),
  logFile = path.join(ROOT, 'private', 'claude-calls.jsonl'),
  makeClient = (key, timeout) => new Anthropic({ apiKey: key, maxRetries: 0, timeout }),
  now = () => Date.now(),
} = {}) {
  let inFlight = 0;
  let clients = new Map();

  function loadCfg() {
    if (!fs.existsSync(cfgFile)) {
      fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
      fs.writeFileSync(cfgFile, TEMPLATE);
    }
    const cfg = parseCfg(fs.readFileSync(cfgFile, 'utf8'));
    if (cfg.keySource === 'cloud') {
      try {
        cfg.key = fs.readFileSync(cloudCfgFile, 'utf8').match(/^key[ \t]*=[ \t]*([^\s#]*)/m)?.[1] ?? '';
      } catch {
        cfg.key = '';
      }
    }
    return cfg;
  }

  function loadUsage() {
    const d = today(now());
    let u = { day: d, dayUsd: 0, month: d.slice(0, 7), monthUsd: 0, calls: 0 };
    try {
      u = { ...u, ...JSON.parse(fs.readFileSync(usageFile, 'utf8')) };
    } catch {
      /* 還沒有 */
    }
    if (u.day !== d) Object.assign(u, { day: d, dayUsd: 0 });
    if (u.month !== d.slice(0, 7)) Object.assign(u, { month: d.slice(0, 7), monthUsd: 0 });
    return u;
  }
  function addUsage(usd) {
    const u = loadUsage();
    u.dayUsd += usd;
    u.monthUsd += usd;
    u.calls++;
    fs.writeFileSync(usageFile, JSON.stringify(u, null, 2));
    return u;
  }
  /** 每次呼叫一行：時間、請求編號、模型、token、花費、花多久、結果（不記對話內容、不記金鑰） */
  function logCall(row) {
    try {
      fs.appendFileSync(logFile, `${JSON.stringify({ t: new Date(now()).toISOString(), ...row })}\n`);
    } catch {
      /* 紀錄寫不進去不影響回答 */
    }
  }

  function remaining(cfg, u) {
    return Math.min(cfg.daily - u.dayUsd, cfg.monthly - u.monthUsd);
  }

  /** 回傳 [HTTP 狀態, JSON]；手機只拿到候選文字與摘要（不含金鑰、不含其他人的用量明細） */
  async function chat(body) {
    const cfg = loadCfg();
    if (!cfg.enabled) return [503, { error: 'off' }];
    const req = cleanRequest(body);
    if (!req) return [400, { error: 'bad_request' }];
    const t0 = now();
    if (cfg.fake) {
      logCall({ reqId: req.reqId, model: MODELS[req.depth].id, fake: true, in: 0, out: 0, usd: 0, ms: 0, result: 'ok' });
      return [200, { text: FAKE_REPLY, reqId: req.reqId, model: MODELS[req.depth].id, fake: true, usd: 0 }];
    }
    if (!cfg.key) return [503, { error: 'no_key' }];
    const u = loadUsage();
    const left = remaining(cfg, u);
    const worst = worstCaseUsd(req);
    if (left <= 0 || worst > left) {
      logCall({ reqId: req.reqId, model: MODELS[req.depth].id, result: 'budget', worst: +worst.toFixed(5) });
      return [402, { error: 'budget', scope: cfg.monthly - u.monthUsd <= Math.max(worst, 0) ? 'month' : 'day', reqId: req.reqId }];
    }
    // 同時只跑一個（不會因為連續說話就同時開好幾個付費請求）
    if (inFlight >= 1) return [429, { error: 'busy', retryAfter: 2, reqId: req.reqId }];
    inFlight++;
    const m = MODELS[req.depth];
    const ck = `${cfg.key.length}:${req.depth}`;
    let client = clients.get(ck);
    if (!client || client.__key !== cfg.key) {
      client = makeClient(cfg.key, m.timeoutMs);
      client.__key = cfg.key;
      clients = new Map([[ck, client]]);
    }
    try {
      const params = buildParams(req);
      const msg = params.betas ? await client.beta.messages.create(params) : await client.messages.create(params);
      const usage = msg.usage ?? {};
      const served = typeof msg.model === 'string' ? msg.model : m.id;
      // 由 Fable 改成 Opus 回答時，用 Opus 的價格計算這一段
      const priceDepth = Object.keys(MODELS).find((k) => MODELS[k].id === served) ?? req.depth;
      const usd = usageUsd(priceDepth, usage);
      addUsage(usd);
      const row = { reqId: req.reqId, model: served, in: usage.input_tokens ?? 0, out: usage.output_tokens ?? 0, usd: +usd.toFixed(6), ms: now() - t0 };
      // 先看有沒有拒答，再讀內容
      if (msg.stop_reason === 'refusal') {
        logCall({ ...row, result: 'refusal' });
        return [422, { error: 'refusal', reqId: req.reqId }];
      }
      const text = (msg.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      logCall({ ...row, result: text ? 'ok' : 'empty', stop: msg.stop_reason });
      return [200, { text, reqId: req.reqId, model: served, usd: row.usd, tokens: { in: row.in, out: row.out }, ms: row.ms }];
    } catch (e) {
      const ms = now() - t0;
      if (e instanceof Anthropic.AuthenticationError) {
        logCall({ reqId: req.reqId, model: m.id, result: 'bad_key', ms });
        return [503, { error: 'bad_key', reqId: req.reqId }];
      }
      if (e instanceof Anthropic.RateLimitError) {
        const ra = Number(e.headers?.get?.('retry-after') ?? e.headers?.['retry-after']);
        logCall({ reqId: req.reqId, model: m.id, result: 'rate_limit', ms });
        return [429, { error: 'rate_limit', retryAfter: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 600) : 30, reqId: req.reqId }];
      }
      if (e instanceof Anthropic.APIConnectionTimeoutError) {
        logCall({ reqId: req.reqId, model: m.id, result: 'timeout', ms });
        return [504, { error: 'timeout', reqId: req.reqId }];
      }
      if (e instanceof Anthropic.APIError && e.status) {
        // 402／餘額不足等也在這裡（status 會帶出來，不帶訊息內容）
        logCall({ reqId: req.reqId, model: m.id, result: 'api', status: e.status, ms });
        return [502, { error: 'api', status: e.status, reqId: req.reqId }];
      }
      logCall({ reqId: req.reqId, model: m.id, result: 'network', ms });
      return [502, { error: 'network', reqId: req.reqId }];
    } finally {
      inFlight--;
    }
  }

  /** 給開發者區看的狀態（不含金鑰，只說有沒有） */
  function status() {
    const cfg = loadCfg();
    const u = loadUsage();
    return {
      enabled: cfg.enabled,
      fake: cfg.fake,
      hasKey: !!cfg.key,
      ready: cfg.enabled && (cfg.fake || !!cfg.key),
      models: Object.fromEntries(Object.entries(MODELS).map(([k, v]) => [k, v.id])),
      dayUsd: +u.dayUsd.toFixed(4),
      monthUsd: +u.monthUsd.toFixed(4),
      daily: cfg.daily,
      monthly: cfg.monthly,
      busy: inFlight > 0,
    };
  }

  return { chat, status, loadCfg };
}

/** 假回應：照生命模式的標籤格式（測試路由與解析用） */
export const FAKE_REPLY = '[心情：開心] 嗯嗯，我在聽喔！';

let shared = null;
/** 轉接程式用的同一個實例 */
export function claude() {
  shared ??= createClaude();
  return shared;
}
