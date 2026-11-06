// H2.1：Astra 審查的八項 P1 與 P2 的回歸測試（全部是合成資料、假 AI、假 Ollama、暫存資料夾、測試埠）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createHub } from '../hub.mjs';
import { ollamaAdapter, Scheduler, verifyLocalModel } from '../localai.mjs';
import { restore, verifyBackup } from '../store.mjs';
import { ev, fakeAI, JAVA_A, JAVA_B, BEDROCK_C, pocketState, registerAndLink, startHub } from './helpers.mjs';

const PET = 'TEST-0001';
const D = 'a'.repeat(64);
const local = (over = {}) => ({ name: 'gemma3:4b', model: 'gemma3:4b', size: 3_338_801_804, digest: D, details: { format: 'gguf' }, ...over });

// ---------- P1-1：本機模型白名單＋fail-closed ----------
test('P1-1 模型驗證：雲端模型（名稱或 remote 欄位）、不在白名單、未安裝、沒有 digest、digest 不符都拒絕', () => {
  const tags = (...m) => ({ models: m });
  assert.equal(verifyLocalModel(tags(local()), 'gemma3:4b', ['gemma3:4b'], D).ok, true);
  assert.equal(verifyLocalModel(tags(local({ name: 'gpt-oss:120b-cloud', model: 'gpt-oss:120b-cloud' })), 'gpt-oss:120b-cloud', ['gpt-oss:120b-cloud']).why, 'model_name');
  assert.equal(verifyLocalModel(tags(local({ remote_host: 'https://ollama.com:443', remote_model: 'gemma3:27b' })), 'gemma3:4b', ['gemma3:4b']).why, 'cloud_model', '名稱正常但其實是遠端模型');
  assert.equal(verifyLocalModel(tags(local()), 'gemma3:4b', ['llama3.2:3b']).why, 'not_allowed');
  assert.equal(verifyLocalModel(tags(local({ name: 'other:1b', model: 'other:1b' })), 'gemma3:4b', ['gemma3:4b']).why, 'not_installed');
  assert.equal(verifyLocalModel(tags(local({ size: 0 })), 'gemma3:4b', ['gemma3:4b']).why, 'no_local_size');
  assert.equal(verifyLocalModel(tags(local({ digest: undefined })), 'gemma3:4b', ['gemma3:4b']).why, 'no_digest');
  assert.equal(verifyLocalModel(tags(local()), 'gemma3:4b', ['gemma3:4b'], 'b'.repeat(64)).why, 'digest_mismatch');
  assert.equal(verifyLocalModel({ nope: 1 }, 'gemma3:4b', ['gemma3:4b']).why, 'bad_tags');
  assert.equal(verifyLocalModel(tags(local()), 'https://x/gemma3:4b', ['https://x/gemma3:4b']).why, 'model_name');
});

async function fakeOllama(t, tags, chatModel) {
  const hits = { tags: 0, chat: 0, models: [] };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/api/tags') {
        hits.tags++;
        return void res.end(JSON.stringify(tags));
      }
      hits.chat++;
      const m = JSON.parse(body).model;
      hits.models.push(m);
      res.end(JSON.stringify({ model: chatModel ?? m, message: { role: 'assistant', content: '[開心] 本機回答' } }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { port: srv.address().port, hits };
}

test('P1-1 端對端：本機模型通過驗證才推論；雲端模型、Ollama 沒回應、回應模型不符都改用規則，而且不送出聊天請求', async (t) => {
  const run = async (adapter) => new Scheduler(adapter, { timeoutMs: 2000 }).submit('p', 'sys', [{ role: 'user', content: 'hi' }], 'RULE');
  const good = await fakeOllama(t, { models: [local()] });
  const r1 = await run(ollamaAdapter('gemma3:4b', { port: good.port, allow: ['gemma3:4b'], digest: D }));
  assert.deepEqual([r1.route, good.hits.chat, good.hits.models[0]], ['LOCAL_OLLAMA', 1, 'gemma3:4b']);

  const cloud = await fakeOllama(t, { models: [local({ remote_host: 'https://ollama.com:443', remote_model: 'gemma3:27b' })] });
  const r2 = await run(ollamaAdapter('gemma3:4b', { port: cloud.port, allow: ['gemma3:4b'] }));
  assert.deepEqual([r2.route, r2.text, cloud.hits.chat], ['RULES', 'RULE', 0]);

  const r3 = await run(ollamaAdapter('gemma3:4b', { port: 1, allow: ['gemma3:4b'] })); // 沒有服務的埠
  assert.equal(r3.route, 'RULES', '連不上 → 規則');

  const swapped = await fakeOllama(t, { models: [local()] }, 'gemma3:27b-cloud');
  const r4 = await run(ollamaAdapter('gemma3:4b', { port: swapped.port, allow: ['gemma3:4b'] }));
  assert.equal(r4.route, 'RULES', '回應的模型跟驗證的不同 → 規則');
});

// ---------- P1-2：VITALS_SYNC 停用 ----------
test('P1-2 舊手機快照不能蓋掉較新的狀態：VITALS_SYNC 在取得新 revision／epoch 後也被拒（暫停使用）', async (t) => {
  const h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  const old = (await h.fp('GET', `/api/allay/state?pet=${PET}`)).json.state; // 手機手上的舊快照
  await h.mc(JAVA_A, 'POST', '/api/allay/control/claim', { pet: PET, baseRevision: 1, opId: 'claim-mc-0001' });
  await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet: PET, baseRevision: 2, epoch: 2, events: [ev('op-gift-0001', 'GIFT', { item: 'poppy' })] });
  const back = await h.fp('POST', '/api/allay/control/claim', { pet: PET, baseRevision: 3, opId: 'claim-fp-0001' });
  const r = await h.fp('POST', '/api/allay/events', { pet: PET, baseRevision: back.json.rev, epoch: back.json.epoch, events: [ev('op-vit-00001', 'VITALS_SYNC', { ...old, asleep: false })] });
  assert.deepEqual([r.status, r.json.error, r.json.where], [403, 'FORBIDDEN', 'VITALS_SYNC_DISABLED']);
  assert.equal((await h.fp('GET', `/api/allay/state?pet=${PET}`)).json.state.affection, old.affection + 2, 'Minecraft 的變化還在');
});

// ---------- P1-3：AI 世代 ----------
test('P1-3 推論期間換了世代：過期回答不寫入、不標成新 epoch（409 STALE_EPOCH）；之後同一個 opId 可以重新正常處理', async (t) => {
  const ai = fakeAI();
  const h = await startHub(t, { ai });
  const pet = (await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', {})).json.pet;
  ai.onAsk = async () => {
    ai.onAsk = null;
    const s = (await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${pet}`)).json;
    await h.mc(JAVA_A, 'POST', '/api/allay/control/claim', { pet, baseRevision: s.rev, opId: 'claim-mid-001' });
  };
  const r = await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-epoch-01', text: 'hi' });
  assert.deepEqual([r.status, r.json.error, r.json.epoch], [409, 'STALE_EPOCH', 2]);
  const s = (await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${pet}`)).json;
  assert.deepEqual([s.dialogue.length, s.epoch], [0, 2], '過期回答沒有寫入');
  const again = await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-epoch-01', text: 'hi' });
  assert.deepEqual([again.json.status, again.json.intent.epoch, again.json.intent.basisRevision], ['APPLIED', 2, s.rev]);
});

// ---------- P1-4：綁定與撤銷的跨文件寫入 ----------
test('P1-4 綁定：第 1 份（綁定碼作廢）成功、第 2 份（悅靈文件）失敗 → 沒有任何授權；碼不能再用；狀態為 failed', async (t) => {
  const faults = {};
  const h = await startHub(t, { faults });
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  const c = await h.fp('POST', '/api/allay/link/create', { pet: PET });
  faults.beforeWrite = (name) => {
    if (name !== 'hub') throw new Error('pet doc write failed');
  };
  const cl = await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: c.json.code });
  delete faults.beforeWrite;
  assert.deepEqual([cl.status, cl.json.error], [503, 'STORE_UNAVAILABLE']);
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: c.json.code })).json.error, 'CODE_INVALID', '單次使用：碼已作廢');
  assert.deepEqual((await h.fp('GET', `/api/allay/link/pending?pet=${PET}`)).json.pending, []);
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 403);
  assert.deepEqual((await h.mc(JAVA_A, 'GET', '/api/allay/whoami')).json.pets, []);
});

test('P1-4 確認與撤銷都是單一文件：寫入失敗時授權不生效（或維持原狀），重試才生效；重啟後一致', async (t) => {
  const faults = {};
  let h = await startHub(t, { faults });
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  const c = await h.fp('POST', '/api/allay/link/create', { pet: PET });
  const cl = await h.mc(BEDROCK_C, 'POST', '/api/allay/link/claim', { code: c.json.code });
  faults.beforeWrite = () => {
    throw new Error('disk error');
  };
  const conf = await h.fp('POST', '/api/allay/link/confirm', { linkId: cl.json.linkId, accept: true });
  delete faults.beforeWrite;
  assert.equal(conf.status, 503);
  assert.equal((await h.mc(BEDROCK_C, 'GET', `/api/allay/state?pet=${PET}`)).status, 403, '確認失敗 → 沒有授權');
  assert.equal((await h.mc(BEDROCK_C, 'GET', `/api/allay/link/status?linkId=${cl.json.linkId}`)).json.status, 'pending');
  assert.equal((await h.fp('POST', '/api/allay/link/confirm', { linkId: cl.json.linkId, accept: true })).json.status, 'active');
  assert.equal((await h.mc(BEDROCK_C, 'GET', `/api/allay/state?pet=${PET}`)).status, 200);
  faults.beforeWrite = () => {
    throw new Error('disk error');
  };
  const rv = await h.fp('POST', '/api/allay/link/revoke', { pet: PET, actor: BEDROCK_C.actor });
  delete faults.beforeWrite;
  assert.equal(rv.status, 503, '撤銷失敗會明確回報（不是假的成功）');
  assert.equal((await h.fp('POST', '/api/allay/link/revoke', { pet: PET, actor: BEDROCK_C.actor })).json.revoked, true);
  h = await h.restart();
  assert.equal((await h.mc(BEDROCK_C, 'GET', `/api/allay/state?pet=${PET}`)).status, 403, '重啟後仍是撤銷狀態');
  assert.equal((await h.mc(BEDROCK_C, 'GET', `/api/allay/link/status?linkId=${cl.json.linkId}`)).json.status, 'revoked');
});

test('P1-4 hub.json 損壞：所有綁定操作 fail-closed（503），既有授權只看悅靈文件', async (t) => {
  let h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  await h.close();
  fs.writeFileSync(path.join(h.dir, 'hub.json'), '{broken');
  h = await h.restart();
  assert.equal((await h.fp('POST', '/api/allay/link/create', { pet: PET })).status, 503);
  assert.equal((await h.mc(JAVA_B, 'POST', '/api/allay/link/claim', { code: '123456' })).status, 503);
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 200, '已確認的授權在悅靈文件裡，不受影響');
});

// ---------- P1-5：損壞復原 ----------
test('P1-5 撤銷後正式檔損壞：不退回前一版、不重新開放權限、不讓 epoch 回退；整隻 fail-closed 並保留證據', async (t) => {
  let h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  await h.mc(JAVA_A, 'POST', '/api/allay/control/claim', { pet: PET, baseRevision: 1, opId: 'claim-mc-0001' });
  await h.fp('POST', '/api/allay/link/revoke', { pet: PET, actor: JAVA_A.actor }); // 前一版仍是 active＋epoch 2
  await h.close();
  const f = path.join(h.dir, 'pets', `${PET}.json`);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"revoked"', '"active"')); // 損壞（檢查碼不符）
  h = await h.restart();
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 503, '沒有重新開放已撤銷的權限');
  assert.equal((await h.fp('GET', `/api/allay/state?pet=${PET}`)).status, 503);
  assert.equal((await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() })).json.error, 'EXISTS', '不能當成首次建立');
  assert.deepEqual(h.hub.report.pets.failed, [{ name: PET, why: 'checksum_or_format' }]);
  assert.ok(fs.readdirSync(path.join(h.dir, 'pets', 'quarantine')).length >= 1, '證據保留');
});

// ---------- P1-6：一致的備份 ----------
test('P1-6 執行中的 Hub 快照：同一時間點的一致視圖；還原到新資料夾後狀態相同', async (t) => {
  const h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  await h.fp('POST', '/api/allay/events', { pet: PET, baseRevision: 1, epoch: 1, events: [ev('op-bk-000001', 'PETTED')] });
  const snap = h.hub.backup(path.join(h.dir, '..', `${path.basename(h.dir)}-snaps`));
  t.after(() => fs.rmSync(path.dirname(snap), { recursive: true, force: true }));
  assert.equal(verifyBackup(snap).files.length, 2);
  const target = `${h.dir}-restored`;
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  restore(snap, target, Date.now());
  const h2 = createHub({ dir: target, now: () => h.clock.t });
  assert.deepEqual(h2.pets.get(PET).stats, h.hub.pets.get(PET).stats);
  assert.deepEqual(h2.pets.get(PET).links, h.hub.pets.get(PET).links);
});

// ---------- P1-7：私人記憶不會被擠掉 ----------
test('P1-7 Minecraft 大量新增共享記憶與對話：手機的私人記憶與對話一筆都不會被刪；Minecraft 只擠掉自己的舊內容', async (t) => {
  const h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  let rev = 1;
  const fpBatch = async (events) => {
    const r = await h.fp('POST', '/api/allay/events', { pet: PET, baseRevision: rev, epoch: 1, events });
    rev = r.json.rev;
  };
  await fpBatch(Array.from({ length: 40 }, (_, i) => ev(`op-fpm-${String(i).padStart(4, '0')}`, 'MEMORY_ADD', { memoryId: `mem-fp-${String(i).padStart(4, '0')}`, text: `私人記憶${i}`, visibility: 'private' })));
  await fpBatch(Array.from({ length: 32 }, (_, i) => ev(`op-fpd-${String(i).padStart(4, '0')}`, 'DIALOGUE_ADD', { messageId: `msg-fp-${String(i).padStart(4, '0')}`, who: 'user', name: '小明', text: `手機對話${i}` })));
  for (let b = 0; b < 3; b++) {
    const events = [];
    for (let i = 0; i < 15; i++) {
      const n = String(b * 15 + i).padStart(4, '0');
      events.push(ev(`op-mcm-${n}`, 'MEMORY_ADD', { memoryId: `mem-mc-${n}`, text: `共享${n}` }));
      events.push(ev(`op-mcd-${n}`, 'DIALOGUE_ADD', { messageId: `msg-mc-${n}`, who: 'user', name: 'TestSteve', text: `MC 對話${n}` }));
    }
    const r = await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet: PET, baseRevision: rev, epoch: 1, events });
    assert.equal(r.status, 200);
    rev = r.json.rev;
  }
  const s = (await h.fp('GET', `/api/allay/state?pet=${PET}`)).json;
  const fpMem = s.memories.filter((m) => m.src === 'fp');
  const mcMem = s.memories.filter((m) => m.src === 'mc');
  assert.equal(fpMem.length, 40, '手機的 40 條私人記憶全部還在');
  assert.ok(fpMem.every((m) => m.visibility === 'private'));
  assert.deepEqual([mcMem.length, mcMem[0].text, mcMem.at(-1).text], [20, '共享0025', '共享0044'], 'Minecraft 只留最新 20 條');
  assert.equal(s.dialogue.filter((d) => d.src === 'fp').length, 32, '手機的對話全部還在');
  assert.equal(s.dialogue.filter((d) => d.src === 'mc').length, 32);
});

// ---------- P1-8：真正的取消與實際並行數 ----------
test('P1-8 逾時：馬上回規則台詞並取消底層請求；名額要等底層真的結束才釋放 → 底層實際並行數永遠 1', async (t) => {
  const ai = fakeAI({ delay: 250, honorAbort: false }); // 模擬不理會取消、照樣跑完的底層請求
  const h = await startHub(t, { ai, scheduler: { timeoutMs: 60, capacity: 8 } });
  const who = [JAVA_A, JAVA_B, BEDROCK_C];
  const pets = [];
  for (const w of who) pets.push((await h.mc(w, 'POST', '/api/allay/mc/pet', {})).json.pet);
  const t0 = Date.now();
  const first = await h.mc(who[0], 'POST', '/api/allay/talk', { pet: pets[0], opId: 'talk-cancel-0', text: 'x' });
  assert.equal(first.json.route, 'RULES');
  assert.ok(Date.now() - t0 < 200, '逾時就先回答，不等底層跑完');
  const rs = await Promise.all(who.map((w, i) => h.mc(w, 'POST', '/api/allay/talk', { pet: pets[i], opId: `talk-cancel-${i + 1}`, text: 'y' })));
  assert.ok(rs.every((r) => r.status === 200 && r.json.route === 'RULES'));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(ai.maxInFlight, 1, '底層實際並行數 1（逾時沒有讓請求疊加）');
  assert.ok(ai.aborted >= 1, '有送出取消');
  assert.equal(h.hub.scheduler.stats.maxInFlight, 1);
});

test('P1-8 取消會傳到底層：支援取消的請求會立刻停止並釋放名額', async (t) => {
  const ai = fakeAI({ delay: 5_000, honorAbort: true });
  const sch = new Scheduler(ai, { timeoutMs: 50 });
  const t0 = Date.now();
  const r = await sch.submit('p1', 's', [{ role: 'user', content: 'x' }], 'RULE');
  assert.equal(r.reason, 'timeout');
  await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual([ai.aborted, ai.inFlight, sch.running], [1, 0, null]);
  assert.ok(Date.now() - t0 < 500);
});

// ---------- P2：同一個 talk opId 並行送達 ----------
test('P2 同一個 talk opId 同時送 3 次：只推論 1 次，三個回應是同一個意圖', async (t) => {
  const ai = fakeAI({ delay: 60 });
  const h = await startHub(t, { ai });
  const pet = (await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', {})).json.pet;
  const rs = await Promise.all([1, 2, 3].map(() => h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-same-001', text: 'hi' })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(new Set(rs.map((r) => r.json.intent.intentId)).size, 1);
  assert.equal(ai.calls.length, 1);
  const col = await Promise.all([
    h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-same-002', text: 'a' }),
    h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-same-002', text: 'b' }),
  ]);
  assert.deepEqual(col.map((r) => r.status).sort(), [200, 409], '同 opId 不同內容 → ID_COLLISION');
});
