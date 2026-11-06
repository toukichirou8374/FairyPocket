// H3-2.1：Astra 審查的兩項模型驗證問題（只用假 Ollama、合成玩家、暫存資料夾、測試埠）
// P1-1：每一次推論前都重新驗證模型（不沿用成功快取）
// P1-2：回應的 model 必須存在、是字串、且與允許的名稱完全相同
import assert from 'node:assert/strict';
import test from 'node:test';
import { LOCAL_DIGEST, localModel, OMIT, startFakeOllama } from '../bench/fakeOllama.mjs';
import { ollamaAdapter, Scheduler } from '../localai.mjs';
import { JAVA_A, startHub } from './helpers.mjs';

const ask = (sch, pet = 'p1') => sch.submit(pet, 'sys', [{ role: 'user', content: 'hi' }], 'RULE');
const adapterFor = (fake) => ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'], digest: LOCAL_DIGEST });

// ---------- P1-1 ----------
test('P1-1（Astra 情境）同一個適配器：第一次驗證成功 → Ollama 的 digest 改變並加上遠端欄位 → 第二次降級為規則台詞、沒有新增聊天推論', async (t) => {
  const fake = await startFakeOllama();
  t.after(() => fake.close());
  const adapter = adapterFor(fake);
  const sch = new Scheduler(adapter);
  const r1 = await ask(sch);
  assert.equal(r1.route, 'LOCAL_OLLAMA');
  assert.equal(fake.stats.requests, 1);
  fake.stats.models = [localModel({ digest: 'f'.repeat(64), remote_host: 'https://ollama.com:443', remote_model: 'gemma3:27b' })];
  const r2 = await ask(sch);
  assert.deepEqual([r2.route, r2.reason], ['RULES', 'error']);
  assert.equal(fake.stats.requests, 1, '第二次沒有送出聊天推論');
  assert.equal(adapter.lastCheck.why, 'cloud_model');
});

test('P1-1 每一次推論前都重新查詢：只換 digest、只加遠端欄位、清單壞掉、清單查詢失敗、模型被移除，都降級且不送聊天推論', async (t) => {
  const fake = await startFakeOllama();
  t.after(() => fake.close());
  const adapter = adapterFor(fake);
  const sch = new Scheduler(adapter);
  const cases = [
    ['digest_mismatch', () => (fake.stats.models = [localModel({ digest: 'e'.repeat(64) })])],
    ['cloud_model', () => (fake.stats.models = [localModel({ remote_host: 'https://ollama.com:443' })])],
    ['unreachable', () => ((fake.stats.models = [localModel()]), (fake.stats.tagsBroken = 'json'))],
    ['unreachable', () => (fake.stats.tagsBroken = 'status')],
    ['not_installed', () => ((fake.stats.tagsBroken = null), (fake.stats.models = []))],
    ['no_digest', () => (fake.stats.models = [localModel({ digest: undefined })])],
  ];
  for (const [why, mutate] of cases) {
    fake.stats.models = [localModel()];
    fake.stats.tagsBroken = null;
    assert.equal((await ask(sch)).route, 'LOCAL_OLLAMA', `${why} 之前先成功一次`);
    const chatBefore = fake.stats.requests;
    mutate();
    const r = await ask(sch);
    assert.equal(r.route, 'RULES', why);
    assert.equal(fake.stats.requests, chatBefore, `${why}：沒有送出聊天推論`);
    assert.equal(adapter.lastCheck.why, why);
  }
});

test('P1-1 對照：連續 5 次推論 → 模型清單查詢剛好 5 次（不沿用快取），都是本機 AI', async (t) => {
  const fake = await startFakeOllama();
  t.after(() => fake.close());
  const adapter = adapterFor(fake);
  const sch = new Scheduler(adapter);
  for (let i = 0; i < 5; i++) assert.equal((await ask(sch)).route, 'LOCAL_OLLAMA');
  assert.deepEqual([adapter.checks, fake.stats.tagsRequests, fake.stats.requests], [5, 5, 5]);
});

// ---------- P1-2 ----------
const BAD_TEXT = '異常回答不能交給玩家';

test('P1-2 回應的 model 缺少、null、數字、物件、名稱不符、只差大小寫：一律降級為規則台詞（推論已送出，但異常內容不被接受）', async (t) => {
  const fake = await startFakeOllama({ reply: BAD_TEXT });
  t.after(() => fake.close());
  const sch = new Scheduler(adapterFor(fake));
  const cases = [
    ['缺少', () => OMIT],
    ['null', () => null],
    ['數字', () => 4],
    ['物件', () => ({ name: 'gemma3:4b' })],
    ['名稱不符', () => 'gemma3:12b'],
    ['雲端名稱', () => 'gemma3:4b-cloud'],
    ['大小寫不同', () => 'Gemma3:4B'],
    ['多了空白', () => 'gemma3:4b '],
  ];
  for (const [name, replyModel] of cases) {
    fake.stats.replyModel = replyModel;
    const before = fake.stats.requests;
    const r = await ask(sch);
    assert.equal(fake.stats.requests, before + 1, `${name}：推論已送出（回應身分是推論完成後才核對）`);
    assert.deepEqual([r.route, r.reason, r.text], ['RULES', 'error', 'RULE'], name);
  }
});

test('P1-2 回應帶遠端欄位、或內容不是字串：降級為規則台詞', async (t) => {
  const fake = await startFakeOllama({ reply: BAD_TEXT });
  t.after(() => fake.close());
  const sch = new Scheduler(adapterFor(fake));
  fake.stats.replyExtra = { remote_host: 'https://ollama.com:443' };
  assert.equal((await ask(sch)).route, 'RULES');
  fake.stats.replyExtra = {};
  fake.stats.reply = 42;
  assert.equal((await ask(sch)).route, 'RULES');
});

test('P1-2 對照：model 完全相同的正常回應 → 本機 AI，文字照常回傳', async (t) => {
  const fake = await startFakeOllama({ reply: '正常的回答' });
  t.after(() => fake.close());
  const r = await ask(new Scheduler(adapterFor(fake)));
  assert.deepEqual([r.route, r.text], ['LOCAL_OLLAMA', '正常的回答']);
});

test('P1-2 經過 Hub：model 欄位缺少時，玩家拿到規則台詞；異常內容不會出現在意圖或保存的對話裡；音效政策不變', async (t) => {
  const fake = await startFakeOllama({ reply: BAD_TEXT });
  t.after(() => fake.close());
  fake.stats.replyModel = () => OMIT;
  const h = await startHub(t, { ai: adapterFor(fake) });
  const pet = (await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', {})).json.pet;
  const r = await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-h321-001', text: '你好', lang: 'zh_tw' });
  assert.equal(r.status, 200);
  assert.equal(r.json.route, 'RULES');
  assert.notEqual(r.json.intent.dialogueText, BAD_TEXT);
  assert.equal(r.json.intent.soundPolicy, 'MINECRAFT_PRESERVE_EXISTING_SYNTHETIC');
  const s = (await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${pet}`)).json;
  assert.ok(!JSON.stringify(s).includes(BAD_TEXT), '保存的對話沒有異常內容');
  assert.equal(h.cloud.calls, 0);
});
