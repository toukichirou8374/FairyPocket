// H3-2.2：HTTP 狀態碼不是 200 時，即使 JSON 內容正確也不採用（只用假 Ollama、合成玩家、暫存資料夾、測試埠）
import assert from 'node:assert/strict';
import test from 'node:test';
import { LOCAL_DIGEST, OMIT, startFakeOllama } from '../bench/fakeOllama.mjs';
import { ollamaAdapter, Scheduler } from '../localai.mjs';
import { JAVA_A, startHub } from './helpers.mjs';

const ask = (sch, pet = 'p1') => sch.submit(pet, 'sys', [{ role: 'user', content: 'hi' }], 'RULE');
const adapterFor = (fake) => ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'], digest: LOCAL_DIGEST });
const BAD_TEXT = '狀態碼失敗的回答不能交給玩家';

test('/api/tags 回 500＋格式正確、符合白名單的模型清單 → 規則台詞，新增的聊天推論為 0', async (t) => {
  const fake = await startFakeOllama();
  t.after(() => fake.close());
  const adapter = adapterFor(fake);
  fake.stats.tagsStatus = 500;
  const r = await ask(new Scheduler(adapter));
  assert.deepEqual([r.route, r.reason], ['RULES', 'error']);
  assert.equal(fake.stats.tagsRequests, 1, '有查詢清單');
  assert.equal(fake.stats.requests, 0, '沒有送出聊天推論');
  assert.equal(adapter.lastCheck.ok, false);
  assert.match(adapter.lastCheck.detail, /http_500/);
});

test('/api/chat 回 500＋正確 model 與有效文字 → 規則台詞；經過 Hub 時異常文字不會輸出、也不會保存', async (t) => {
  const fake = await startFakeOllama({ reply: BAD_TEXT });
  t.after(() => fake.close());
  fake.stats.chatStatus = 500;
  const r = await ask(new Scheduler(adapterFor(fake)));
  assert.deepEqual([r.route, r.reason, r.text], ['RULES', 'error', 'RULE']);
  assert.equal(fake.stats.requests, 1, '推論已送出（狀態碼是回應後才知道），但回答不被接受');
  const h = await startHub(t, { ai: adapterFor(fake) });
  const pet = (await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', {})).json.pet;
  const talk = await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-h322-001', text: '你好', lang: 'zh_tw' });
  assert.equal(talk.json.route, 'RULES');
  assert.notEqual(talk.json.intent.dialogueText, BAD_TEXT);
  assert.equal(talk.json.intent.soundPolicy, 'MINECRAFT_PRESERVE_EXISTING_SYNTHETIC');
  const s = (await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${pet}`)).json;
  assert.ok(!JSON.stringify(s).includes(BAD_TEXT), '保存的狀態與對話沒有異常文字');
});

test('其他非 200 狀態（201、204、301、400、404、429、503）：清單或回答都安全拒絕', async (t) => {
  const fake = await startFakeOllama({ reply: BAD_TEXT });
  t.after(() => fake.close());
  const sch = new Scheduler(adapterFor(fake));
  for (const code of [201, 204, 301, 400, 404, 429, 503]) {
    fake.stats.tagsStatus = code;
    fake.stats.chatStatus = 200;
    const chatBefore = fake.stats.requests;
    const a = await ask(sch);
    assert.equal(a.route, 'RULES', `tags ${code}`);
    assert.equal(fake.stats.requests, chatBefore, `tags ${code}：沒有送出聊天推論`);
    fake.stats.tagsStatus = 200;
    fake.stats.chatStatus = code;
    const b = await ask(sch);
    assert.deepEqual([b.route, b.text], ['RULES', 'RULE'], `chat ${code}`);
  }
});

test('對照：HTTP 200＋有效資料 → 正常的本機推論', async (t) => {
  const fake = await startFakeOllama({ reply: '正常的回答' });
  t.after(() => fake.close());
  const r = await ask(new Scheduler(adapterFor(fake)));
  assert.deepEqual([r.route, r.text], ['LOCAL_OLLAMA', '正常的回答']);
  assert.deepEqual([fake.stats.tagsRequests, fake.stats.requests], [1, 1]);
});

test('對照：HTTP 200 但資料不合法 → 原有的格式驗證照樣生效（清單沒有 digest、回答沒有 model）', async (t) => {
  const fake = await startFakeOllama({ reply: BAD_TEXT });
  t.after(() => fake.close());
  const adapter = adapterFor(fake);
  const sch = new Scheduler(adapter);
  fake.stats.models = [{ ...fake.stats.models[0], digest: undefined }];
  assert.equal((await ask(sch)).route, 'RULES');
  assert.equal(adapter.lastCheck.why, 'no_digest');
  assert.equal(fake.stats.requests, 0);
  fake.stats.models = [{ ...fake.stats.models[0], digest: LOCAL_DIGEST }];
  fake.stats.replyModel = () => OMIT;
  assert.deepEqual([(await ask(sch)).route, fake.stats.requests], ['RULES', 1]);
});

test('逾時、取消、名額釋放維持不變：回應很慢時仍會取消，且名額等底層結束才釋放', async (t) => {
  const fake = await startFakeOllama({ latencyMs: () => 300 });
  t.after(() => fake.close());
  const sch = new Scheduler(adapterFor(fake), { timeoutMs: 50 });
  const r = await ask(sch);
  assert.deepEqual([r.route, r.reason], ['RULES', 'timeout']);
  await new Promise((res) => setTimeout(res, 80));
  assert.deepEqual([fake.stats.aborted, sch.running, sch.stats.maxInFlight], [1, null, 1]);
});
