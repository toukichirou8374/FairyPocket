// 悅靈的雲端 AI（第三層）：Claude Haiku 5.5（Anthropic）。只由家裡電腦的轉接程式代送：
// - 金鑰只在 private/cloud.txt（不會上傳），手機不存金鑰
// - 只有這台電腦主人的 Tailscale 帳號能用（tailscale serve 會附上「是哪個帳號」，無法偽造）；
//   連到同一個 Tailscale 網路的其他人（例如 Minecraft 的朋友）不能用
// - 花費上限：每天、每月（private/cloud.txt 可以改），用完就停，隔天／下個月自動恢復
// - 用量記在 private/cloud-usage.json

import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CFG_FILE = path.join(ROOT, 'private', 'cloud.txt');
const USAGE_FILE = path.join(ROOT, 'private', 'cloud-usage.json');
const MODEL = 'claude-haiku-5-5';
/** Claude Haiku 5.5 的價格（美元／token；100K token 以內的請求） */
const PRICE = { input: 0.1 / 1e6, output: 0.5 / 1e6, cacheWrite: 0.125 / 1e6, cacheRead: 0.01 / 1e6 };

// ---------- 設定 ----------
function loadCfg() {
  if (!fs.existsSync(CFG_FILE)) {
    fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
    fs.writeFileSync(
      CFG_FILE,
      [
        '# 悅靈的雲端 AI（Claude Haiku 5.5）設定。這個檔案在 private/，不會上傳。',
        '# key：Anthropic 的 API 金鑰（https://platform.claude.com 建立）',
        'key=',
        '# 花費上限（美元）。預設：每月約 2000 日圓、每天平均約 66 日圓（以 1 美元 = 150 日圓計算）',
        'daily_usd=0.44',
        'monthly_usd=13.3',
        '',
      ].join('\n'),
    );
  }
  const txt = fs.readFileSync(CFG_FILE, 'utf8');
  // 只看同一行（[ \t]，不能用 \s，不然空的值會讀到下一行）
  const get = (k) => txt.match(new RegExp(`^${k}[ \\t]*=[ \\t]*([^\\s#]*)`, 'm'))?.[1] ?? '';
  return { key: get('key'), daily: Number(get('daily_usd')) || 0.44, monthly: Number(get('monthly_usd')) || 13.3 };
}

// ---------- 主人的 Tailscale 帳號（啟動時向 Tailscale 查，不寫在程式裡） ----------
let owner = '';
function refreshOwner() {
  const exe = process.platform === 'win32' ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale';
  execFile(exe, ['status', '--json'], { timeout: 10_000 }, (err, out) => {
    if (err) return;
    try {
      const j = JSON.parse(out);
      owner = j.User?.[j.Self?.UserID]?.LoginName ?? owner;
    } catch {
      /* 下次再試 */
    }
  });
}
refreshOwner();
setInterval(refreshOwner, 10 * 60_000);

/** 這個連線是不是電腦主人本人（經由 tailscale serve 轉進來才會有這個資訊） */
export function isOwner(req) {
  const who = String(req.headers['tailscale-user-login'] ?? '').toLowerCase();
  return !!owner && who === owner.toLowerCase();
}

// ---------- 用量 ----------
const today = () => new Date().toLocaleDateString('sv-SE');
function loadUsage() {
  let u = { day: today(), dayUsd: 0, month: today().slice(0, 7), monthUsd: 0, calls: 0 };
  try {
    u = { ...u, ...JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')) };
  } catch {
    /* 還沒有 */
  }
  if (u.day !== today()) Object.assign(u, { day: today(), dayUsd: 0 });
  if (u.month !== today().slice(0, 7)) Object.assign(u, { month: today().slice(0, 7), monthUsd: 0 });
  return u;
}
function addUsage(usd) {
  const u = loadUsage();
  u.dayUsd += usd;
  u.monthUsd += usd;
  u.calls++;
  fs.writeFileSync(USAGE_FILE, JSON.stringify(u, null, 2));
  return u;
}

// ---------- 呼叫 ----------
let client = null;
let clientKey = '';

/** 整理手機送來的對話：只留文字、限制長度、第一句一定是使用者、最後一句一定是使用者 */
function clean(body) {
  const system = String(body?.system ?? '').slice(0, 12_000);
  let messages = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;
  const lang = typeof body?.langRule === 'string' ? body.langRule.slice(0, 500) : '';
  return { system: lang ? `${system}\n\n${lang}` : system, messages };
}

/** 回傳 [HTTP 狀態, JSON]；手機只拿到文字，不會拿到金鑰或用量明細 */
export async function cloudChat(body) {
  const cfg = loadCfg();
  if (!cfg.key) return [503, { error: 'no_key' }];
  const u = loadUsage();
  if (u.dayUsd >= cfg.daily || u.monthUsd >= cfg.monthly) return [402, { error: 'budget', scope: u.monthUsd >= cfg.monthly ? 'month' : 'day' }];
  const req = clean(body);
  if (!req) return [400, { error: 'bad_request' }];
  if (!client || clientKey !== cfg.key) {
    client = new Anthropic({ apiKey: cfg.key, maxRetries: 1, timeout: 30_000 });
    clientKey = cfg.key;
  }
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: req.system,
      messages: req.messages,
      // 聊天用：想得少一點，又快又省
      output_config: { effort: 'low' },
    });
    const usage = msg.usage ?? {};
    const usd =
      (usage.input_tokens ?? 0) * PRICE.input +
      (usage.output_tokens ?? 0) * PRICE.output +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead;
    addUsage(usd);
    if (msg.stop_reason === 'refusal') return [422, { error: 'refusal' }];
    const text = (msg.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return [200, { text }];
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return [503, { error: 'bad_key' }];
    if (e instanceof Anthropic.RateLimitError) return [429, { error: 'rate_limit' }];
    if (e instanceof Anthropic.APIError) return [502, { error: 'api', status: e.status }];
    return [502, { error: 'network' }];
  }
}

/** 給開發者區看的狀態（不含金鑰） */
export function cloudStatus() {
  const cfg = loadCfg();
  const u = loadUsage();
  return { ready: !!cfg.key, model: MODEL, dayUsd: +u.dayUsd.toFixed(4), monthUsd: +u.monthUsd.toFixed(4), daily: cfg.daily, monthly: cfg.monthly };
}
