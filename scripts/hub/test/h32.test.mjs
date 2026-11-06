// H3-2：Minecraft 本機 AI 的合成驗證（假 Ollama、合成玩家、暫存資料夾、測試埠；不連真正的 Ollama）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cloudModel, LOCAL_DIGEST, localModel, startFakeOllama } from '../bench/fakeOllama.mjs';
import { runLoad } from '../bench/mcLoad.mjs';
import { ollamaAdapter, Scheduler, schedulerOptsFrom } from '../localai.mjs';

const ask = (sch, pet = 'p1') => sch.submit(pet, 'sys', [{ role: 'user', content: 'hi' }], 'RULE');

test('模型不重載：Minecraft 送給 Ollama 的選項與 FairyPocket 完全相同（同一個模型、同樣的 options 與 keep_alive）', async (t) => {
  const fake = await startFakeOllama();
  t.after(() => fake.close());
  const r = await ask(new Scheduler(ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'], digest: LOCAL_DIGEST })));
  assert.equal(r.route, 'LOCAL_OLLAMA');
  const sent = fake.stats.options[0];
  const brain = fs.readFileSync(path.resolve(import.meta.dirname, '../../../src/brain/brain.ts'), 'utf8');
  const m = brain.match(/keep_alive: '([^']+)', options: (\{[^}]+\})/);
  assert.ok(m, 'FairyPocket 的請求選項');
  assert.equal(sent.keep_alive, m[1]);
  assert.deepEqual(sent.options, Function(`return ${m[2]}`)());
  assert.equal(sent.stream, false);
  assert.ok(!('num_ctx' in sent.options) && !('num_gpu' in sent.options), '不改 context／GPU 設定（改了 Ollama 會重新載入模型）');
});

test('雲端禁止：Ollama 清單裡有雲端模型時，Hub 只會用白名單的本機模型；設定成雲端模型則一律規則台詞、零聊天請求', async (t) => {
  const fake = await startFakeOllama({ models: [cloudModel(), localModel()] });
  t.after(() => fake.close());
  const good = await ask(new Scheduler(ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'] })));
  assert.equal(good.route, 'LOCAL_OLLAMA');
  assert.deepEqual(fake.stats.modelsSeen, ['gemma3:4b']);
  const before = fake.stats.requests;
  const bad = await ask(new Scheduler(ollamaAdapter('gpt-oss:120b-cloud', { port: fake.port, allow: ['gpt-oss:120b-cloud'] })));
  assert.deepEqual([bad.route, fake.stats.requests - before, fake.stats.cloudRequested], ['RULES', 0, 0]);
});

test('推論取消：逾時後真的中斷 Ollama 的請求（假 Ollama 收到斷線、沒有完成），執行名額等它停下才釋放', async (t) => {
  const fake = await startFakeOllama({ latencyMs: () => 400 });
  t.after(() => fake.close());
  const sch = new Scheduler(ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'] }), { timeoutMs: 60 });
  const t0 = Date.now();
  const r = await ask(sch);
  assert.deepEqual([r.route, r.reason], ['RULES', 'timeout']);
  assert.ok(Date.now() - t0 < 300, '逾時就先回答');
  await new Promise((res) => setTimeout(res, 80));
  assert.deepEqual([fake.stats.aborted, fake.stats.completed, sch.running], [1, 0, null]);
});

test('排隊上限（ai_wait_ms）：排隊太久就先用規則台詞回答，不必等滿推論逾時；底層仍然一次只有一個', async (t) => {
  const fake = await startFakeOllama({ latencyMs: () => 150 });
  t.after(() => fake.close());
  const sch = new Scheduler(ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'] }), { timeoutMs: 1000, waitMs: 40, capacity: 8 });
  const t0 = Date.now();
  const rs = await Promise.all(['a', 'b', 'c'].map((p) => ask(sch, p).then((r) => ({ ...r, ms: Date.now() - t0 }))));
  assert.equal(rs[0].route, 'LOCAL_OLLAMA');
  assert.deepEqual(rs.slice(1).map((r) => r.reason), ['queue_timeout', 'queue_timeout']);
  assert.ok(rs.slice(1).every((r) => r.ms < 120), '排隊的人很快拿到規則台詞');
  assert.equal(fake.stats.maxInFlight, 1);
});

test('hub.txt 的排程設定：範圍內才採用，其他一律用預設值', () => {
  assert.deepEqual(schedulerOptsFrom(''), { capacity: 8, timeoutMs: 12000, waitMs: 12000 });
  assert.deepEqual(schedulerOptsFrom('ai_queue=4\nai_timeout_ms=8000\nai_wait_ms=3000 # 建議'), { capacity: 4, timeoutMs: 8000, waitMs: 3000 });
  assert.deepEqual(schedulerOptsFrom('ai_queue=999\nai_timeout_ms=-5\nai_wait_ms=abc'), { capacity: 8, timeoutMs: 12000, waitMs: 12000 });
  assert.deepEqual(schedulerOptsFrom('ai_timeout_ms=5000'), { capacity: 8, timeoutMs: 5000, waitMs: 5000 });
});

for (const players of [1, 2, 5, 10, 20])
  test(`合成負載 ${players} 位玩家：Ollama 一次只處理 1 個 Minecraft 請求、零雲端、意圖都保留合成音效政策、只有預期的回應種類`, async () => {
    const r = await runLoad({ players, seconds: 30, scale: 0.01, profile: 'fast', phoneEveryMs: 10_000, timeoutMs: 8_000, waitMs: 3_000 });
    assert.ok(r.requests >= players, '每位玩家至少說過一句');
    assert.equal(r.ollamaMaxInFlightFromHub, 1);
    assert.equal(r.ollamaMaxInFlight <= 2, true, '最多是 1 個 Minecraft＋1 個手機');
    assert.deepEqual([r.cloudCalls, r.cloudModelRequested, r.badIntent, r.other], [0, 0, 0, 0]);
    assert.deepEqual(r.modelsSeen, ['gemma3:4b']);
    if (players <= 5) assert.ok(r.localRate >= 0.9, `${players} 位玩家時幾乎都由本機 AI 回答（${Math.round(r.localRate * 100)}%）`);
  });
