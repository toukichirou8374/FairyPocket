// H3-1 的 Hub 小擴充：RENAME（只限手機）與 lastController（只給手機看）
import assert from 'node:assert/strict';
import test from 'node:test';
import { ev, JAVA_A, registerAndLink, startHub } from './helpers.mjs';

const PET = 'TEST-0001';

test('RENAME：手機可以改名（不需控制權，但要符合 epoch／revision）；Minecraft 403；名字超過 12 字 400', async (t) => {
  const h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  const s = (await h.fp('GET', `/api/allay/state?pet=${PET}`)).json;
  const ok = await h.fp('POST', '/api/allay/events', { pet: PET, baseRevision: s.rev, epoch: s.epoch, events: [ev('op-rename-001', 'RENAME', { name: '露露' })] });
  assert.equal(ok.json.results[0].status, 'APPLIED');
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).json.profile.name, '露露');
  const s2 = (await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).json;
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/events', { pet: PET, baseRevision: s2.rev, epoch: s2.epoch, events: [ev('op-rename-mc1', 'RENAME', { name: '偷改' })] })).status, 403);
  assert.equal((await h.fp('POST', '/api/allay/events', { pet: PET, baseRevision: s2.rev, epoch: s2.epoch, events: [ev('op-rename-002', 'RENAME', { name: '一二三四五六七八九十一二三' })] })).status, 400);
  assert.equal((await h.fp('POST', '/api/allay/events', { pet: PET, baseRevision: s2.rev - 1, epoch: s2.epoch, events: [ev('op-rename-003', 'RENAME', { name: '舊版' })] })).json.error, 'REVISION_CONFLICT');
});

test('lastController：Minecraft 放開控制權後，手機看得到上一個控制者是 Minecraft；Minecraft 的公開狀態沒有這個欄位', async (t) => {
  const h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  const c = await h.mc(JAVA_A, 'POST', '/api/allay/control/claim', { pet: PET, baseRevision: 1, opId: 'claim-mc-0001' });
  assert.equal((await h.fp('GET', `/api/allay/state?pet=${PET}`)).json.lastController.role, 'fp');
  await h.mc(JAVA_A, 'POST', '/api/allay/control/release', { pet: PET, epoch: c.json.epoch, opId: 'release-mc-01' });
  const fp = (await h.fp('GET', `/api/allay/state?pet=${PET}`)).json;
  assert.deepEqual([fp.controller, fp.lastController.role], [null, 'mc']);
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).json.lastController, undefined);
});
