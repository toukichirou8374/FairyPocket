// Hub HTTP API：憑證與角色、去重／revision／epoch、權限隔離、公開與私人、綁定、聊天與排程、意圖收據、耐久與重啟
// 對應 H1 的主要測試情境（見 docs/hub/RESULTS.md 的對照表）。全部是合成玩家與測試資料。
import assert from 'node:assert/strict';
import test from 'node:test';
import { BEDROCK_C, ev, fakeAI, FP_TOKEN, JAVA_A, JAVA_B, MC_TOKEN, pocketState, registerAndLink, startHub } from './helpers.mjs';

const PET = 'TEST-0001';
const state = async (h) => (await h.fp('GET', `/api/allay/state?pet=${PET}`)).json;
const send = (h, base, epoch, events) => h.fp('POST', '/api/allay/events', { pet: PET, baseRevision: base, epoch, events });

// ---------- 憑證、角色、路由 ----------
test('憑證：沒有或錯的通行碼 401；別的網站 403；Hub 關閉時路徑不存在', async (t) => {
  const h = await startHub(t);
  assert.equal((await h.call('GET', `/api/allay/state?pet=${PET}`)).status, 401);
  assert.equal((await h.call('GET', `/api/allay/state?pet=${PET}`, null, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await h.call('GET', '/api/tags', null, { authorization: `Bearer ${FP_TOKEN}`, origin: 'https://evil.example' })).status, 403);
  const { createRelay } = await import('../../ai-proxy.mjs');
  const off = createRelay({ token: FP_TOKEN, mcToken: MC_TOKEN, hub: null });
  await new Promise((r) => off.listen(0, '127.0.0.1', r));
  t.after(() => off.close());
  const r = await fetch(`http://127.0.0.1:${off.address().port}/api/allay/state?pet=${PET}`, { headers: { authorization: `Bearer ${FP_TOKEN}` } });
  assert.equal(r.status, 404);
});

test('Minecraft 憑證：本機 AI 原始路徑 403、雲端 AI 一律 403 CLOUD_FORBIDDEN（雲端完全沒被呼叫）；FairyPocket 的雲端照常', async (t) => {
  const h = await startHub(t);
  const mcAuth = { authorization: `Bearer ${MC_TOKEN}` };
  assert.equal((await h.call('POST', '/api/chat', { model: 'x', messages: [] }, mcAuth)).status, 403);
  assert.equal((await h.call('GET', '/api/tags', null, mcAuth)).status, 403);
  const c1 = await h.call('POST', '/api/cloud/chat', { system: 's', messages: [{ role: 'user', content: 'hi' }] }, mcAuth);
  assert.deepEqual([c1.status, c1.json.error], [403, 'CLOUD_FORBIDDEN']);
  assert.equal((await h.call('GET', '/api/cloud/status', null, mcAuth)).json.error, 'CLOUD_FORBIDDEN');
  assert.equal(h.cloud.calls, 0);
  // FairyPocket（fp）的個人雲端 AI 不受影響
  const c2 = await h.call('POST', '/api/cloud/chat', { system: 's', messages: [{ role: 'user', content: 'hi' }] }, { authorization: `Bearer ${FP_TOKEN}` });
  assert.deepEqual([c2.status, c2.json.text], [200, 'cloud reply']);
  assert.equal(h.cloud.calls, 1);
});

test('路由權限：手機不能用 Minecraft 的路徑，Minecraft 不能用手機的路徑', async (t) => {
  const h = await startHub(t);
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/pet/register', { petState: pocketState() })).status, 403);
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/link/create', { pet: PET })).status, 403);
  assert.equal((await h.fp('POST', '/api/allay/talk', { pet: PET, opId: 'talk-0001', text: 'hi' })).status, 403);
  assert.equal((await h.fp('POST', '/api/allay/mc/pet', {})).status, 403);
  assert.equal((await h.fp('POST', '/api/allay/state', {})).status, 404, '沒有整份覆寫的路徑');
  assert.equal((await h.fp('POST', '/api/allay/state/patch', {})).status, 404, '沒有任意 patch 的路徑');
});

test('Minecraft 身分：沒有行動者、離線 UUID、偽造的 Floodgate UUID 都拒絕', async (t) => {
  const h = await startHub(t);
  const r1 = await h.call('GET', '/api/allay/whoami', null, { authorization: `Bearer ${MC_TOKEN}` });
  assert.equal(r1.status, 400);
  assert.equal((await h.mc({ actor: 'java:3f2a1b4c-5d6e-3f70-8a9b-0c1d2e3f4a5b' }, 'GET', '/api/allay/whoami')).status, 400);
  assert.equal((await h.mc({ ...BEDROCK_C, floodgateUuid: '00000000-0000-0000-0000-000000000001' }, 'GET', '/api/allay/whoami')).status, 400);
  assert.equal((await h.mc(BEDROCK_C, 'GET', '/api/allay/whoami')).status, 200);
});

// ---------- 登記、去重、revision ----------
test('登記：真實格式才收；同一隻不能重登（不覆寫）', async (t) => {
  const h = await startHub(t);
  assert.equal((await h.fp('POST', '/api/allay/pet/register', { petState: pocketState({ version: 2 }) })).status, 400);
  const r = await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  assert.deepEqual([r.status, r.json.rev, r.json.epoch, r.json.controller.role], [201, 1, 1, 'fp']);
  const again = await h.fp('POST', '/api/allay/pet/register', { petState: pocketState({ hunger: 1 }) });
  assert.deepEqual([again.status, again.json.error], [409, 'EXISTS']);
  assert.equal((await state(h)).state.hunger, 16);
});

test('去重：重送回 DUPLICATE 不重算；同 ID 不同內容 ID_COLLISION；舊 revision 被拒並附最新 rev', async (t) => {
  const h = await startHub(t);
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  const a = await send(h, 1, 1, [ev('op-pet-0001', 'PETTED')]);
  assert.deepEqual([a.status, a.json.rev, a.json.results[0].status], [200, 2, 'APPLIED']);
  const dup = await send(h, 1, 1, [ev('op-pet-0001', 'PETTED')]);
  assert.deepEqual([dup.status, dup.json.results[0].status, dup.json.rev], [200, 'DUPLICATE', 2]);
  assert.equal((await state(h)).stats.petted, 1, '重送沒有重複計算');
  const col = await send(h, 2, 1, [ev('op-pet-0001', 'PLAYED')]);
  assert.deepEqual([col.status, col.json.error], [409, 'ID_COLLISION']);
  const stale = await send(h, 1, 1, [ev('op-pet-0002', 'PETTED')]);
  assert.deepEqual([stale.status, stale.json.error, stale.json.rev], [409, 'REVISION_CONFLICT', 2]);
  // 整批成功或整批失敗：第二筆不合格時第一筆也不套用
  const bad = await send(h, 2, 1, [ev('op-pet-0003', 'PETTED'), ev('op-pet-0004', 'PETTED', { x: 1 })]);
  assert.equal(bad.status, 400);
  assert.equal((await state(h)).rev, 2);
});

test('並行重送：同一個事件同時送 4 次，只套用 1 次', async (t) => {
  const h = await startHub(t);
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  const rs = await Promise.all([1, 2, 3, 4].map(() => send(h, 1, 1, [ev('op-race-0001', 'PLAYED')])));
  assert.equal(rs.filter((r) => r.json.results?.[0]?.status === 'APPLIED').length, 1);
  assert.equal(rs.filter((r) => r.json.results?.[0]?.status === 'DUPLICATE').length, 3);
  assert.equal((await state(h)).stats.played, 1);
});

test('容量：去重紀錄到上限時明確拒絕（507），不刪掉舊紀錄換取成功', async (t) => {
  const h = await startHub(t, { maxOps: 3 });
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  const r = await send(h, 1, 1, [ev('op-cap-00001', 'PETTED'), ev('op-cap-00002', 'PETTED'), ev('op-cap-00003', 'PETTED')]);
  assert.equal(r.status, 200);
  const full = await send(h, 4, 1, [ev('op-cap-00004', 'PETTED')]);
  assert.deepEqual([full.status, full.json.error], [507, 'CAPACITY_REJECTED']);
  assert.equal((await send(h, 4, 1, [ev('op-cap-00001', 'PETTED')])).json.results[0].status, 'DUPLICATE', '舊紀錄還在');
});

// ---------- 控制權 epoch ----------
test('epoch：Minecraft 取得控制權後手機的數值事件被拒；舊世代失效；重複的舊事件只回歷史結果；手機再取回', async (t) => {
  const h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  await send(h, 1, 1, [ev('op-fp-000001', 'PETTED')]);
  const claim = await h.mc(JAVA_A, 'POST', '/api/allay/control/claim', { pet: PET, baseRevision: 2, opId: 'claim-mc-0001' });
  assert.deepEqual([claim.status, claim.json.epoch, claim.json.rev], [200, 2, 3]);

  const notCtl = await send(h, 3, 2, [ev('op-fp-000002', 'PETTED')]);
  assert.deepEqual([notCtl.status, notCtl.json.error], [409, 'NOT_CONTROLLER']);
  const old = await send(h, 3, 1, [ev('op-fp-000003', 'PETTED')]);
  assert.deepEqual([old.status, old.json.error, old.json.epoch], [409, 'STALE_EPOCH', 2]);
  const hist = await send(h, 1, 1, [ev('op-fp-000001', 'PETTED')]);
  assert.deepEqual([hist.status, hist.json.results[0].status, hist.json.results[0].rev], [200, 'DUPLICATE', 2]);
  // 不改數值的事件：非控制者也可以，但要符合目前 epoch 與 revision
  const mem = await send(h, 3, 2, [ev('op-fp-mem-01', 'MEMORY_ADD', { memoryId: 'mem-fp-0001', text: '小明喜歡恐龍' })]);
  assert.equal(mem.status, 200);

  const mcEv = await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet: PET, baseRevision: 4, epoch: 2, events: [ev('op-mc-000001', 'GIFT', { item: 'minecraft:poppy' })] });
  assert.equal(mcEv.json.results[0].status, 'APPLIED');
  // 手機取回控制權：Minecraft 手上的 epoch 立刻失效
  const back = await h.fp('POST', '/api/allay/control/claim', { pet: PET, baseRevision: 5, opId: 'claim-fp-0001' });
  assert.equal(back.json.epoch, 3);
  const mcOld = await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet: PET, baseRevision: 6, epoch: 2, events: [ev('op-mc-000002', 'PETTED')] });
  assert.deepEqual([mcOld.status, mcOld.json.error], [409, 'STALE_EPOCH']);
  // 放開控制權也會換世代
  const rel = await h.fp('POST', '/api/allay/control/release', { pet: PET, epoch: 3, opId: 'release-fp-01' });
  assert.deepEqual([rel.status, rel.json.epoch], [200, 4]);
  assert.equal((await state(h)).controller, null);
});

test('Minecraft 不能直接改數值：VITALS_SYNC 403；數值只由 Hub 依事件計算，並有每日上限', async (t) => {
  const h = await startHub(t);
  const own = await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', { name: '小幫手', personality: 'brave' });
  const pet = own.json.pet;
  const vit = await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet, baseRevision: 1, epoch: 1, events: [ev('op-vit-00001', 'VITALS_SYNC', { health: 20, hunger: 20, energy: 100, mood: 100, affection: 100, asleep: false })] });
  assert.equal(vit.status, 403);
  const gifts = [1, 2, 3, 4].map((i) => ev(`op-gift-000${i}`, 'GIFT', { item: 'poppy' }));
  const g = await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet, baseRevision: 1, epoch: 1, events: gifts });
  assert.deepEqual(g.json.results.map((r) => r.result.affection), [2, 2, 2, 0], '禮物的感情每天最多 +6');
  const after = (await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${pet}`)).json;
  assert.equal(after.state.affection, 16);
  const found = await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet, baseRevision: after.rev, epoch: 1, events: [ev('op-found-0001', 'FOUND', { item: 'diamond' }), ev('op-found-0002', 'FOUND', { item: 'dirt' })] });
  assert.deepEqual(found.json.results.map((r) => r.result.rare), [true, false], '稀有與否由 Hub 判斷');
  h.clock.t += 86_400_000; // 隔天上限重置
  const s2 = (await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${pet}`)).json;
  const g2 = await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet, baseRevision: s2.rev, epoch: 1, events: [ev('op-gift-0005', 'GIFT', { item: 'poppy' })] });
  assert.equal(g2.json.results[0].result.affection, 2);
  const tp = await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet, baseRevision: s2.rev + 1, epoch: 1, events: [ev('op-time-0001', 'TIME_PASSED', { seconds: 600, night: false })] });
  assert.equal(tp.status, 200);
  assert.ok((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${pet}`)).json.state.hunger < 16);
});

// ---------- 權限隔離 ----------
test('隔離：每位玩家一隻專用悅靈（冪等）；別的玩家、手機都不能讀寫；拒絕時不洩漏 revision', async (t) => {
  const h = await startHub(t);
  const a1 = await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', {});
  const a2 = await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', { name: '改名' });
  assert.deepEqual([a1.status, a2.status, a1.json.pet === a2.json.pet, a2.json.profile.name], [201, 200, true, '悅靈']);
  const b = await h.mc(JAVA_B, 'POST', '/api/allay/mc/pet', {});
  const c = await h.mc(BEDROCK_C, 'POST', '/api/allay/mc/pet', {});
  assert.equal(new Set([a1.json.pet, b.json.pet, c.json.pet]).size, 3, 'Java 與基岩版各自一隻，不會撞');
  const peek = await h.mc(JAVA_B, 'GET', `/api/allay/state?pet=${a1.json.pet}`);
  assert.deepEqual([peek.status, peek.json.rev], [403, undefined]);
  const write = await h.mc(JAVA_B, 'POST', '/api/allay/events', { pet: a1.json.pet, baseRevision: 1, epoch: 1, events: [ev('op-x-000001', 'PETTED')] });
  assert.equal(write.status, 403);
  assert.equal((await h.fp('GET', `/api/allay/state?pet=${a1.json.pet}`)).status, 403);
  assert.deepEqual((await h.mc(JAVA_A, 'GET', '/api/allay/whoami')).json.pets, [{ pet: a1.json.pet, kind: 'mc' }]);
  // 同一台 Paper 代表別的玩家送「控制者」事件也不行（控制者綁定行動者）
  const imp = await h.mc(JAVA_B, 'POST', '/api/allay/events', { pet: b.json.pet, baseRevision: 1, epoch: 1, events: [ev('op-b-000001', 'PETTED')] });
  assert.equal(imp.status, 200);
});

test('公開與私人：Minecraft 拿不到手機的私人記憶與手機上的對話；聊天的 prompt 也不含', async (t) => {
  const h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  await send(h, 1, 1, [
    ev('op-priv-0001', 'MEMORY_ADD', { memoryId: 'mem-priv-001', text: '媽媽的生日是三月', visibility: 'private' }),
    ev('op-shar-0001', 'MEMORY_ADD', { memoryId: 'mem-shar-001', text: '主人喜歡蓋城堡', visibility: 'shared' }),
    ev('op-dlg-00001', 'DIALOGUE_ADD', { messageId: 'msg-fp-00001', who: 'user', name: '小明', text: '今天在學校被罵了' }),
  ]);
  const mcView = (await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).json;
  assert.deepEqual(mcView.memories.map((m) => m.text), ['主人喜歡蓋城堡']);
  assert.deepEqual(mcView.dialogue, []);
  assert.equal(mcView.links, undefined);
  assert.deepEqual(Object.keys(mcView.controller), ['role']);
  const fpView = await state(h);
  assert.equal(fpView.memories.length, 2);
  assert.equal(fpView.dialogue.length, 1);
  await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet: PET, opId: 'talk-priv-01', text: '你記得什麼？' });
  const prompt = h.ai.calls.at(-1).system + JSON.stringify(h.ai.calls.at(-1).messages);
  assert.ok(prompt.includes('主人喜歡蓋城堡'));
  assert.ok(!prompt.includes('媽媽的生日') && !prompt.includes('被罵'), 'prompt 不含私人內容');
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).json.dialogue.length, 2, 'Minecraft 自己的對話看得到');
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/adventures?pet=${PET}`)).status, 403);
});

// ---------- 綁定 ----------
test('綁定：六位數碼 → 待確認 → 手機確認才生效；碼只能用一次；別的玩家查不到狀態', async (t) => {
  const h = await startHub(t);
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  const c = await h.fp('POST', '/api/allay/link/create', { pet: PET });
  assert.match(c.json.code, /^\d{6}$/);
  const cl = await h.mc(BEDROCK_C, 'POST', '/api/allay/link/claim', { code: c.json.code });
  assert.deepEqual([cl.status, cl.json.status], [200, 'pending']);
  assert.equal((await h.mc(BEDROCK_C, 'GET', `/api/allay/state?pet=${PET}`)).status, 403, '還沒確認不能存取');
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: c.json.code })).json.error, 'CODE_INVALID', '單次使用');
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/link/status?linkId=${cl.json.linkId}`)).status, 403);
  const pend = (await h.fp('GET', `/api/allay/link/pending?pet=${PET}`)).json.pending;
  assert.deepEqual([pend.length, pend[0].platform, pend[0].name, pend[0].idPrefix], [1, 'bedrock', '.TestKid', '25354123']);
  await h.fp('POST', '/api/allay/link/confirm', { linkId: cl.json.linkId, accept: true });
  assert.deepEqual((await h.mc(BEDROCK_C, 'GET', `/api/allay/link/status?linkId=${cl.json.linkId}`)).json, { status: 'active', pet: PET });
  assert.equal((await h.mc(BEDROCK_C, 'GET', `/api/allay/state?pet=${PET}`)).status, 200);
  assert.deepEqual((await h.mc(BEDROCK_C, 'GET', '/api/allay/whoami')).json.pets, [{ pet: PET, kind: 'pocket' }]);
  // 拒絕的綁定
  const c2 = await h.fp('POST', '/api/allay/link/create', { pet: PET });
  const cl2 = await h.mc(JAVA_B, 'POST', '/api/allay/link/claim', { code: c2.json.code });
  await h.fp('POST', '/api/allay/link/confirm', { linkId: cl2.json.linkId, accept: false });
  assert.equal((await h.mc(JAVA_B, 'GET', `/api/allay/link/status?linkId=${cl2.json.linkId}`)).json.status, 'rejected');
  assert.equal((await h.mc(JAVA_B, 'GET', `/api/allay/state?pet=${PET}`)).status, 403);
});

test('綁定：10 分鐘逾時；產生新碼舊碼作廢；待確認逾時不能確認', async (t) => {
  const h = await startHub(t);
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  const c = await h.fp('POST', '/api/allay/link/create', { pet: PET });
  h.clock.t += 10 * 60_000 + 1;
  assert.deepEqual((await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: c.json.code })).json.error, 'CODE_EXPIRED');
  const c1 = await h.fp('POST', '/api/allay/link/create', { pet: PET });
  const c2 = await h.fp('POST', '/api/allay/link/create', { pet: PET });
  if (c1.json.code !== c2.json.code) assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: c1.json.code })).json.error, 'CODE_INVALID');
  const cl = await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: c2.json.code });
  h.clock.t += 10 * 60_000 + 1;
  assert.equal((await h.fp('POST', '/api/allay/link/confirm', { linkId: cl.json.linkId, accept: true })).status, 410);
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 403);
});

test('綁定：錯 5 次鎖 15 分鐘；鎖定寫入磁碟，重啟後仍有效', async (t) => {
  let h = await startHub(t);
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  for (let i = 0; i < 5; i++) assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: '000000' })).json.error, 'CODE_INVALID');
  const c = await h.fp('POST', '/api/allay/link/create', { pet: PET });
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: c.json.code })).json.error, 'LOCKED', '鎖定時連正確的碼也不收');
  h = await h.restart();
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: c.json.code })).json.error, 'LOCKED');
  h.clock.t += 15 * 60_000 + 1;
  const c2 = await h.fp('POST', '/api/allay/link/create', { pet: PET });
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: c2.json.code })).json.status, 'pending');
});

test('撤銷：解除綁定後所有請求立即 403（連重送也一樣）；若正拿著控制權則換新世代', async (t) => {
  const h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  await h.mc(JAVA_A, 'POST', '/api/allay/control/claim', { pet: PET, baseRevision: 1, opId: 'claim-mc-0001' });
  const e1 = await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet: PET, baseRevision: 2, epoch: 2, events: [ev('op-mc-rev-01', 'PETTED')] });
  assert.equal(e1.status, 200);
  const rv = await h.fp('POST', '/api/allay/link/revoke', { pet: PET, actor: JAVA_A.actor });
  assert.deepEqual([rv.json.revoked, rv.json.epoch], [true, 3]);
  const dup = await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet: PET, baseRevision: 2, epoch: 2, events: [ev('op-mc-rev-01', 'PETTED')] });
  assert.equal(dup.status, 403);
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 403);
  assert.equal((await state(h)).controller, null);
});

// ---------- 聊天、排程、意圖 ----------
test('聊天：只用本機 AI；意圖帶保留合成音效政策、沒有任何音訊欄位；重送不重問 AI', async (t) => {
  const h = await startHub(t);
  const own = (await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', {})).json.pet;
  const r = await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet: own, opId: 'talk-000001', text: '我們去挖礦吧', lang: 'zh_tw', place: '礦坑', speaker: { actor: JAVA_B.actor, name: 'TestAlex' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.route, 'LOCAL_OLLAMA');
  const it = r.json.intent;
  assert.deepEqual([it.kind, it.emotion, it.dialogueText, it.soundPolicy, it.textPolicy], ['DIALOGUE', 'happy', '好呀，我們一起去探險！', 'MINECRAFT_PRESERVE_EXISTING_SYNTHETIC', 'APPROVED_TEXT_ONLY']);
  for (const k of Object.keys(it)) assert.ok(!/audio|voice|tts|pitch|sound(?!Policy)|url/i.test(k), `意圖不能有音訊欄位：${k}`);
  assert.ok(h.ai.calls[0].system.includes('主人的朋友'), '說話的人不是主人時稱呼不同');
  const again = await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet: own, opId: 'talk-000001', text: '我們去挖礦吧', lang: 'zh_tw', place: '礦坑', speaker: { actor: JAVA_B.actor, name: 'TestAlex' } });
  assert.deepEqual([again.json.status, again.json.intent.intentId, h.ai.calls.length], ['DUPLICATE', it.intentId, 1]);
  assert.equal(h.cloud.calls, 0);
});

test('聊天：AI 失敗或逾時就退回規則台詞（不會改用雲端）', async (t) => {
  const ai = fakeAI();
  const h = await startHub(t, { ai, scheduler: { timeoutMs: 50 } });
  const own = (await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', {})).json.pet;
  ai.failNext = true;
  const f = await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet: own, opId: 'talk-fail-01', text: 'hi', lang: 'en_us' });
  assert.equal(f.json.route, 'RULES');
  assert.match(f.json.intent.dialogueText, /here|explor|follow/i);
  ai.delay = 200;
  const s = await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet: own, opId: 'talk-slow-01', text: 'hi', lang: 'zh_tw' });
  assert.equal(s.json.route, 'RULES');
  assert.equal(h.cloud.calls, 0);
});

test('排程：每隻悅靈最多 1 個執行中＋1 個等待中；佇列滿了明確拒絕', async (t) => {
  const ai = fakeAI({ delay: 80 });
  const h = await startHub(t, { ai, scheduler: { capacity: 2 } });
  const pets = [];
  for (const who of [JAVA_A, JAVA_B, BEDROCK_C]) pets.push((await h.mc(who, 'POST', '/api/allay/mc/pet', {})).json.pet);
  const a = [1, 2, 3].map((i) => h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet: pets[0], opId: `talk-busy-0${i}`, text: `hi ${i}` }));
  const ra = await Promise.all(a);
  assert.deepEqual(ra.map((r) => r.status).sort(), [200, 200, 429]);
  assert.equal(ra.find((r) => r.status === 429).json.error, 'PET_BUSY');
  // 4 隻不同的悅靈同時說話：1 個執行中＋2 個等待中，第 4 個明確回 QUEUE_FULL
  const D = { actor: 'java:0d0d0d0d-0000-4000-8000-00000000000d', name: 'TestD' };
  pets.push((await h.mc(D, 'POST', '/api/allay/mc/pet', {})).json.pet);
  const who = [JAVA_A, JAVA_B, BEDROCK_C, D];
  const b = await Promise.all(who.map((w, i) => h.mc(w, 'POST', '/api/allay/talk', { pet: pets[i], opId: `talk-full-0${i}`, text: 'x' })));
  assert.deepEqual(b.map((r) => r.status).sort(), [200, 200, 200, 503]);
  assert.equal(b.find((r) => r.status === 503).json.error, 'QUEUE_FULL');
});

test('多隻悅靈：1／2／5／10／20 隻同時聊天都完成，佇列不超過上限', async (t) => {
  const ai = fakeAI({ delay: 2 });
  const h = await startHub(t, { ai, scheduler: { capacity: 20 } });
  let maxQueue = 0;
  const q = h.hub.scheduler;
  const orig = q.submit.bind(q);
  q.submit = (...a) => {
    const p = orig(...a);
    maxQueue = Math.max(maxQueue, q.queue.length);
    return p;
  };
  for (const n of [1, 2, 5, 10, 20]) {
    const players = Array.from({ length: n }, (_, i) => ({ actor: `java:${String(i + 1).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`, name: `P${i}` }));
    const ids = [];
    for (const p of players) ids.push((await h.mc(p, 'POST', '/api/allay/mc/pet', {})).json.pet);
    const rs = await Promise.all(players.map((p, i) => h.mc(p, 'POST', '/api/allay/talk', { pet: ids[i], opId: `talk-n${n}-${String(i).padStart(3, '0')}`, text: 'hello' })));
    assert.ok(rs.every((r) => r.status === 200), `${n} 隻都完成`);
  }
  assert.ok(maxQueue <= 20);
});

test('意圖收據：Hub 簽發且有效才收；偽造、過期、舊世代都拒絕；重送 DUPLICATE', async (t) => {
  const h = await startHub(t);
  const pet = (await h.mc(JAVA_A, 'POST', '/api/allay/mc/pet', {})).json.pet;
  const it = (await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-rcpt-01', text: 'hi' })).json.intent;
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/intent/receipt', { pet, intentId: 'f'.repeat(24), epoch: 1, status: 'APPLIED' })).status, 404, '偽造的意圖');
  const ok = await h.mc(JAVA_A, 'POST', '/api/allay/intent/receipt', { pet, intentId: it.intentId, epoch: 1, status: 'APPLIED' });
  assert.equal(ok.json.status, 'RECORDED');
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/intent/receipt', { pet, intentId: it.intentId, epoch: 1, status: 'APPLIED' })).json.status, 'DUPLICATE');
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/intent/receipt', { pet, intentId: it.intentId, epoch: 1, status: 'REJECTED' })).json.error, 'ID_COLLISION');
  const it2 = (await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-rcpt-02', text: 'hi' })).json.intent;
  h.clock.t += 31_000;
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/intent/receipt', { pet, intentId: it2.intentId, epoch: 1, status: 'APPLIED' })).json.error, 'INTENT_EXPIRED');
  const it3 = (await h.mc(JAVA_A, 'POST', '/api/allay/talk', { pet, opId: 'talk-rcpt-03', text: 'hi' })).json.intent;
  const s = (await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${pet}`)).json;
  await h.mc(JAVA_A, 'POST', '/api/allay/control/claim', { pet, baseRevision: s.rev, opId: 'claim-rcpt-01' });
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/intent/receipt', { pet, intentId: it3.intentId, epoch: 1, status: 'APPLIED' })).json.error, 'STALE_EPOCH');
});

// ---------- 耐久 ----------
test('重啟：狀態、epoch、去重紀錄、綁定都還在；斷線前已 ACK 的事件重送只回 DUPLICATE', async (t) => {
  let h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  const a = await send(h, 1, 1, [ev('op-dur-00001', 'FED', { food: 'cookie' })]);
  assert.equal(a.json.results[0].status, 'APPLIED');
  h = await h.restart();
  const dup = await send(h, 1, 1, [ev('op-dur-00001', 'FED', { food: 'cookie' })]);
  assert.equal(dup.json.results[0].status, 'DUPLICATE');
  const s = await state(h);
  assert.deepEqual([s.rev, s.stats.fed, s.state.affection], [2, 1, 16]);
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 200, '綁定還在');
  assert.deepEqual(h.hub.report.pets.failed, []);
});

test('儲存不可用：回 503，不假報成功、不部分寫入；恢復後重送才套用', async (t) => {
  const faults = {};
  const h = await startHub(t, { faults });
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  faults.beforeWrite = () => {
    throw new Error('disk unavailable');
  };
  const r = await send(h, 1, 1, [ev('op-store-001', 'PETTED'), ev('op-store-002', 'PLAYED')]);
  assert.deepEqual([r.status, r.json.error], [503, 'STORE_UNAVAILABLE']);
  delete faults.beforeWrite;
  const s = await state(h);
  assert.deepEqual([s.rev, s.stats.petted, s.stats.played], [1, 0, 0]);
  const again = await send(h, 1, 1, [ev('op-store-001', 'PETTED'), ev('op-store-002', 'PLAYED')]);
  assert.deepEqual(again.json.results.map((x) => x.status), ['APPLIED', 'APPLIED']);
});
