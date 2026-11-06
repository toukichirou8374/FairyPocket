// H3-2.3：非 200 的回應要主動終止連線、等它真的關閉，排程器才釋放名額（只用假 Ollama、合成資料）
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { LOCAL_DIGEST, startFakeOllama } from '../bench/fakeOllama.mjs';
import { ollamaAdapter, Scheduler, trackRequest } from '../localai.mjs';
import { JAVA_A, startHub } from './helpers.mjs';

const BAD_TEXT = '持續傳輸的錯誤回應';
const ask = (sch, pet = 'p1') => sch.submit(pet, 'sys', [{ role: 'user', content: 'hi' }], 'RULE');
const tick = () => new Promise((r) => setImmediate(r));
async function until(cond, ms = 1000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}
/** 包住 adapter.ask：記下「ask 結束（排程器即將釋放名額）那一刻」用戶端還開著幾條連線 */
function watch(adapter) {
  const seen = [];
  const orig = adapter.ask;
  adapter.ask = async (...a) => {
    try {
      return await orig(...a);
    } finally {
      seen.push(adapter.conn.open);
    }
  };
  return seen;
}
function setup(fake) {
  const adapter = ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'], digest: LOCAL_DIGEST });
  return { adapter, seen: watch(adapter), sch: new Scheduler(adapter, { timeoutMs: 5000 }) };
}

test('（Astra 情境）/api/tags 回 500 並每 10 毫秒持續傳輸、永不結束：連續 3 次都在有界時間內降級；連線都已關閉；名額在清理後才釋放', async (t) => {
  const fake = await startFakeOllama();
  t.after(() => fake.close());
  Object.assign(fake.stats, { tagsStatus: 500, errorStream: true });
  const { adapter, seen, sch } = setup(fake);
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await ask(sch);
    assert.deepEqual([r.route, r.reason], ['RULES', 'error']);
    assert.ok(Date.now() - t0 < 1500, '有界時間內降級');
    await tick();
    assert.deepEqual([sch.running, sch.stats.inFlight], [null, 0]);
  }
  assert.deepEqual(seen, [0, 0, 0], 'ask 結束時用戶端已經沒有開著的連線');
  assert.equal(adapter.conn.open, 0);
  assert.ok(await until(() => fake.stats.errorOpen === 0), '假服務端觀測到錯誤連線全部關閉');
  assert.equal(fake.stats.errorClosed, 3);
  assert.equal(fake.stats.requests, 0, '沒有送出聊天推論');
  assert.equal(adapter.conn.closeTimeouts, 0, '不需要等到清理上限');
});

test('/api/chat 回 500 並持續傳輸、永不結束：有界時間內降級；異常內容不被接受；連線關閉後才釋放名額', async (t) => {
  const fake = await startFakeOllama();
  t.after(() => fake.close());
  Object.assign(fake.stats, { chatStatus: 500, errorStream: true });
  const { adapter, seen, sch } = setup(fake);
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await ask(sch);
    assert.deepEqual([r.route, r.text], ['RULES', 'RULE']);
    assert.ok(Date.now() - t0 < 1500);
    await tick();
    assert.deepEqual([sch.running, sch.stats.inFlight], [null, 0]);
  }
  assert.deepEqual(seen, [0, 0, 0]);
  assert.ok(await until(() => fake.stats.errorOpen === 0));
  assert.deepEqual([fake.stats.errorClosed, fake.stats.requests, adapter.conn.open], [3, 3, 0]);
});

test('經過 Hub：/api/chat 持續傳輸的 500 → 玩家拿到規則台詞，異常內容不輸出、不保存；連線已關閉', async (t) => {
  const fake = await startFakeOllama({ reply: BAD_TEXT });
  t.after(() => fake.close());
  Object.assign(fake.stats, { chatStatus: 500, errorStream: true });
  const { adapter } = setup(fake);
  const h = await startHub(t, { ai: adapter });
  const pet = (await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', {})).json.pet;
  const r = await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-h323-001', text: '你好' });
  assert.equal(r.json.route, 'RULES');
  assert.equal(r.json.intent.soundPolicy, 'MINECRAFT_PRESERVE_EXISTING_SYNTHETIC');
  assert.ok(!JSON.stringify((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${pet}`)).json).includes(BAD_TEXT));
  assert.ok(await until(() => fake.stats.errorOpen === 0));
  assert.equal(adapter.conn.open, 0);
});

test('清理完成後再送正常的 HTTP 200：AI 正常回答', async (t) => {
  const fake = await startFakeOllama({ reply: '正常的回答' });
  t.after(() => fake.close());
  Object.assign(fake.stats, { tagsStatus: 500, errorStream: true });
  const { adapter, sch } = setup(fake);
  assert.equal((await ask(sch)).route, 'RULES');
  Object.assign(fake.stats, { tagsStatus: 200, chatStatus: 500 });
  assert.equal((await ask(sch)).route, 'RULES');
  Object.assign(fake.stats, { chatStatus: 200, errorStream: false });
  const ok = await ask(sch);
  assert.deepEqual([ok.route, ok.text], ['LOCAL_OLLAMA', '正常的回答']);
  await tick();
  assert.deepEqual([adapter.conn.open, sch.running], [0, null]);
});

test('逾時仍正常：慢回應會被取消，名額在連線關閉後才釋放', async (t) => {
  const fake = await startFakeOllama({ latencyMs: () => 400 });
  t.after(() => fake.close());
  const adapter = ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'], digest: LOCAL_DIGEST });
  const seen = watch(adapter);
  const sch = new Scheduler(adapter, { timeoutMs: 50 });
  const r = await ask(sch);
  assert.deepEqual([r.route, r.reason], ['RULES', 'timeout']);
  assert.ok(await until(() => sch.running === null));
  assert.deepEqual([seen, adapter.conn.open, fake.stats.aborted, fake.stats.completed], [[0], 0, 1, 0]);
});

test('主動取消（AbortSignal）仍正常：請求被取消、連線關閉後才結束', async (t) => {
  const fake = await startFakeOllama({ latencyMs: () => 2000 });
  t.after(() => fake.close());
  const adapter = ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'], digest: LOCAL_DIGEST });
  const ctl = new AbortController();
  const p = adapter.ask('sys', [{ role: 'user', content: 'hi' }], { signal: ctl.signal, timeoutMs: 5000 });
  await until(() => fake.stats.inFlight === 1);
  ctl.abort();
  await assert.rejects(p);
  assert.equal(adapter.conn.open, 0, 'reject 時連線已關閉');
  assert.ok(await until(() => fake.stats.aborted === 1));
});

test('清理有上限：連線一直沒有關閉時，最多等 CLOSE_WAIT_MS 就結束（不會無限等待），並記錄逾時', async () => {
  const req = new EventEmitter();
  req.destroy = () => {}; // 模擬終止失敗、永遠不關閉
  const res = new EventEmitter();
  res.destroy = () => {};
  const counter = { open: 0, closeTimeouts: 0 };
  const tr = trackRequest(req, counter);
  assert.equal(counter.open, 1);
  const t0 = Date.now();
  assert.equal(await tr.shutdown(res, 80), 'close_timeout');
  assert.ok(Date.now() - t0 < 500);
  assert.equal(counter.closeTimeouts, 1);
  req.emit('close'); // 之後才關閉也不會出錯
  assert.equal(counter.open, 0);
});
