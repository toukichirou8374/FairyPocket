// AI 3.0：Claude 來源的後端測試（不連網、不花錢：全部用假的 client）
// 執行：node --test scripts/claude-ai-test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { buildParams, cleanRequest, createClaude, estTokens, FAKE_REPLY, MODELS, worstCaseUsd } from './claude-ai.mjs';

function setup(cfg, { reply, error, delayMs = 0, model } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ai-'));
  const files = { cfgFile: path.join(dir, 'claude.txt'), cloudCfgFile: path.join(dir, 'cloud.txt'), usageFile: path.join(dir, 'u.json'), logFile: path.join(dir, 'calls.jsonl') };
  if (cfg !== null) fs.writeFileSync(files.cfgFile, cfg);
  const calls = [];
  const create = async (p) => {
    calls.push(p);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (error) throw error();
    return {
      model: model ?? p.model,
      stop_reason: reply?.stop ?? 'end_turn',
      content: [{ type: 'text', text: reply?.text ?? '[心情：開心] 好呀！' }],
      usage: { input_tokens: 1000, output_tokens: 100 },
    };
  };
  const made = [];
  const c = createClaude({
    ...files,
    makeClient: (key, timeout) => {
      made.push({ keyLen: key.length, timeout });
      return { messages: { create }, beta: { messages: { create } } };
    },
  });
  return { c, files, calls, made, dir };
}
const body = (extra = {}) => ({ system: '你是悅靈', messages: [{ role: 'user', content: '你好' }], reqId: 'abc12345', ...extra });
const FAKEKEY = 'test-not-a-real-key-000000';

test('預設關閉：沒有設定檔時建立「關閉」的設定，不呼叫', async () => {
  const { c, files, calls } = setup(null);
  const [code, out] = await c.chat(body());
  assert.equal(code, 503);
  assert.equal(out.error, 'off');
  assert.equal(calls.length, 0);
  assert.match(fs.readFileSync(files.cfgFile, 'utf8'), /^enabled=0$/m);
  assert.equal(c.status().ready, false);
});

test('假回應模式：不連網、不花錢，回傳請求編號', async () => {
  const { c, calls, files } = setup('enabled=1\nfake=1\n');
  const [code, out] = await c.chat(body());
  assert.equal(code, 200);
  assert.equal(out.text, FAKE_REPLY);
  assert.equal(out.reqId, 'abc12345');
  assert.equal(out.fake, true);
  assert.equal(calls.length, 0);
  assert.match(fs.readFileSync(files.logFile, 'utf8'), /"fake":true/);
});

test('沒有金鑰：不呼叫', async () => {
  const { c, calls } = setup('enabled=1\nkey=\n');
  const [code, out] = await c.chat(body());
  assert.equal(code, 503);
  assert.equal(out.error, 'no_key');
  assert.equal(calls.length, 0);
});

test('Sonnet：between_tools、effort low、沒有取樣參數；記用量與紀錄（不記內容與金鑰）', async () => {
  const { c, calls, files } = setup(`enabled=1\nkey=${FAKEKEY}\n`);
  const [code, out] = await c.chat(body());
  assert.equal(code, 200);
  assert.equal(out.model, 'claude-sonnet-5-5');
  const p = calls[0];
  assert.deepEqual(p.thinking, { type: 'between_tools' });
  assert.deepEqual(p.output_config, { effort: 'low' });
  for (const k of ['temperature', 'top_p', 'top_k']) assert.equal(k in p, false);
  const log = fs.readFileSync(files.logFile, 'utf8');
  assert.equal(log.includes(FAKEKEY), false);
  assert.equal(log.includes('你好'), false);
  assert.equal(log.includes('悅靈'), false);
  const u = JSON.parse(fs.readFileSync(files.usageFile, 'utf8'));
  assert.ok(Math.abs(u.dayUsd - (1000 * 2 + 100 * 10) / 1e6) < 1e-9);
  assert.equal(JSON.stringify(c.status()).includes(FAKEKEY), false);
});

test('Opus 不送 thinking；Fable 加上伺服器端拒答備援（只備援到 Opus）', () => {
  const r = cleanRequest(body({ depth: 'opus' }));
  assert.equal(buildParams(r).model, 'claude-opus-5-5');
  assert.equal('thinking' in buildParams(r), false);
  const f = buildParams(cleanRequest(body({ depth: 'fable' })));
  assert.equal(f.model, 'claude-fable-5-2');
  assert.equal('thinking' in f, false);
  assert.deepEqual(f.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(f.fallbacks, 'default');
  // 不認得的深度一律 Sonnet（不會自己升到 Fable）
  assert.equal(cleanRequest(body({ depth: 'max' })).depth, 'sonnet');
});

test('Fable 由 Opus 接手回答：用 Opus 的價格記帳', async () => {
  const { c, files } = setup(`enabled=1\nkey=${FAKEKEY}\n`, { model: 'claude-opus-5-5' });
  const [code, out] = await c.chat(body({ depth: 'fable' }));
  assert.equal(code, 200);
  assert.equal(out.model, 'claude-opus-5-5');
  const u = JSON.parse(fs.readFileSync(files.usageFile, 'utf8'));
  assert.ok(Math.abs(u.dayUsd - (1000 * 4 + 100 * 20) / 1e6) < 1e-9);
});

test('拒答：先看 stop_reason，不讀內容', async () => {
  const { c } = setup(`enabled=1\nkey=${FAKEKEY}\n`, { reply: { stop: 'refusal', text: '不該被讀到' } });
  const [code, out] = await c.chat(body());
  assert.equal(code, 422);
  assert.equal(out.error, 'refusal');
  assert.equal(JSON.stringify(out).includes('不該被讀到'), false);
});

test('預算：最壞情況超過剩下的額度就不呼叫（每天、每月）', async () => {
  const { c, calls, files } = setup(`enabled=1\nkey=${FAKEKEY}\ndaily_usd=0.01\nmonthly_usd=1\n`);
  const d = new Date().toLocaleDateString('sv-SE');
  fs.writeFileSync(files.usageFile, JSON.stringify({ day: d, dayUsd: 0.0095, month: d.slice(0, 7), monthUsd: 0.2, calls: 3 }));
  const [code, out] = await c.chat(body());
  assert.equal(code, 402);
  assert.equal(out.error, 'budget');
  assert.equal(out.scope, 'day');
  assert.equal(calls.length, 0);
  const s2 = setup(`enabled=1\nkey=${FAKEKEY}\ndaily_usd=5\nmonthly_usd=0.5\n`);
  fs.writeFileSync(s2.files.usageFile, JSON.stringify({ day: d, dayUsd: 0, month: d.slice(0, 7), monthUsd: 0.5, calls: 9 }));
  const [c2, o2] = await s2.c.chat(body());
  assert.equal(c2, 402);
  assert.equal(o2.scope, 'month');
});

test('最壞情況估價：Opus 比 Sonnet 貴、Fable 最貴', () => {
  const s = worstCaseUsd(cleanRequest(body()));
  const o = worstCaseUsd(cleanRequest(body({ depth: 'opus' })));
  const f = worstCaseUsd(cleanRequest(body({ depth: 'fable' })));
  assert.ok(s < o && o < f);
  assert.ok(f < 0.07, `一次 Fable 聊天的上限應該很小：${f}`);
});

test('同時只跑一個：第二個立刻回 busy（不會同時開好幾個付費請求）', async () => {
  const { c, calls } = setup(`enabled=1\nkey=${FAKEKEY}\n`, { delayMs: 50 });
  const [a, b] = await Promise.all([c.chat(body()), c.chat(body({ reqId: 'second01' }))]);
  assert.equal(a[0], 200);
  assert.equal(b[0], 429);
  assert.equal(b[1].error, 'busy');
  assert.equal(calls.length, 1);
});

test('429：回傳要等幾秒；金鑰錯誤；逾時；不自動重試', async () => {
  const headers = new Headers({ 'retry-after': '12' });
  const rl = setup(`enabled=1\nkey=${FAKEKEY}\n`, { error: () => new Anthropic.RateLimitError(429, { type: 'error' }, 'rate', headers) });
  const [c1, o1] = await rl.c.chat(body());
  assert.equal(c1, 429);
  assert.equal(o1.retryAfter, 12);
  assert.equal(rl.calls.length, 1);
  const auth = setup(`enabled=1\nkey=${FAKEKEY}\n`, { error: () => new Anthropic.AuthenticationError(401, { type: 'error' }, 'auth', new Headers()) });
  assert.equal((await auth.c.chat(body()))[1].error, 'bad_key');
  const to = setup(`enabled=1\nkey=${FAKEKEY}\n`, { error: () => new Anthropic.APIConnectionTimeoutError() });
  assert.equal((await to.c.chat(body()))[1].error, 'timeout');
  // client 建立時 maxRetries 由 makeClient 決定；預設 makeClient 用 maxRetries: 0（看原始碼）
  const src = fs.readFileSync(new URL('./claude-ai.mjs', import.meta.url), 'utf8');
  assert.match(src, /maxRetries: 0/);
});

test('只送最少的內容：最多 8 句、每句 600 字、系統說明 6000 字', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'あ'.repeat(900) }));
  many.push({ role: 'user', content: '最後' });
  const r = cleanRequest({ system: 'x'.repeat(20000), messages: many });
  assert.ok(r.messages.length <= 8);
  assert.equal(r.messages[0].role, 'user');
  assert.ok(r.messages.every((m) => m.content.length <= 600));
  assert.equal(r.system.length, 6000);
  assert.equal(cleanRequest({ messages: [{ role: 'assistant', content: 'hi' }] }), null);
  // 請求編號只接受安全的字元
  assert.notEqual(cleanRequest(body({ reqId: '../../etc' })).reqId, '../../etc');
});

test('key_source=cloud：共用既有雲端 AI 的金鑰（只讀，不顯示）', async () => {
  const { c, files, made } = setup('enabled=1\nkey_source=cloud\n');
  fs.writeFileSync(files.cloudCfgFile, `key=${FAKEKEY}\ndaily_usd=0.44\n`);
  const [code] = await c.chat(body());
  assert.equal(code, 200);
  assert.equal(made[0].keyLen, FAKEKEY.length);
  assert.equal(c.status().hasKey, true);
});

test('模型編號（2026-11 官方）', () => {
  assert.equal(MODELS.sonnet.id, 'claude-sonnet-5-5');
  assert.equal(MODELS.opus.id, 'claude-opus-5-5');
  assert.equal(MODELS.fable.id, 'claude-fable-5-2');
});

test('輸入 token 估計不會低估中文、日文（實測：中文 1261 字＝1500 token、日文 1758 字＝1792 token、英文 3460 字＝1205 token）', () => {
  assert.ok(estTokens('悅'.repeat(1261)) >= 1500);
  assert.ok(estTokens('あ'.repeat(1758)) >= 1792);
  assert.ok(estTokens('a'.repeat(3460)) >= 1205);
});
