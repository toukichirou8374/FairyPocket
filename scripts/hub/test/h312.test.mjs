// H3-1.2：登記紀錄（來源 ID＋識別碼雜湊）由 Hub 保存與核對；跟著耐久儲存與備份走
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pocketState, startHub, FP_TOKEN } from './helpers.mjs';

const PET = 'TEST-0001';
const REG = `reg-${'a1'.repeat(16)}`;
const other = (h, body, source) => h.call('POST', '/api/allay/pet/register', body, { authorization: `Bearer ${FP_TOKEN}`, 'x-fairy-source': source });

test('同一來源＋同一識別碼 → 200 DUPLICATE（不改資料）；識別碼或來源不同 → 409 other；舊資料沒有紀錄 → 409 unknown', async (t) => {
  const h = await startHub(t);
  const r1 = await h.fp('POST', '/api/allay/pet/register', { petState: pocketState(), registration: { regId: REG } });
  assert.equal(r1.status, 201);
  const r2 = await h.fp('POST', '/api/allay/pet/register', { petState: pocketState({ hunger: 1 }), registration: { regId: REG } });
  assert.deepEqual([r2.status, r2.json.status, r2.json.rev, r2.json.state.hunger], [200, 'DUPLICATE', 1, 16]);
  const r3 = await h.fp('POST', '/api/allay/pet/register', { petState: pocketState(), registration: { regId: `reg-${'b2'.repeat(16)}` } });
  assert.deepEqual([r3.status, r3.json.error, r3.json.registration], [409, 'EXISTS', 'other']);
  const r4 = await other(h, { petState: pocketState(), registration: { regId: REG } }, 'pocket-device-99');
  assert.deepEqual([r4.status, r4.json.registration], [409, 'other'], '別的來源拿到同樣的識別碼也不承認');
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState({ id: 'TEST-0002' }) }); // 沒帶識別碼（舊資料）
  const r5 = await h.fp('POST', '/api/allay/pet/register', { petState: pocketState({ id: 'TEST-0002' }), registration: { regId: REG } });
  assert.deepEqual([r5.status, r5.json.registration], [409, 'unknown']);
  assert.equal((await h.fp('POST', '/api/allay/pet/register', { petState: pocketState(), registration: { regId: 'reg-short' } })).status, 400);
});

test('登記紀錄寫進悅靈文件：重啟後仍可核對；備份裡只有雜湊、沒有識別碼本身；Minecraft／手機的狀態都不顯示', async (t) => {
  let h = await startHub(t);
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState(), registration: { regId: REG } });
  h = await h.restart();
  const r = await h.fp('POST', '/api/allay/pet/register', { petState: pocketState(), registration: { regId: REG } });
  assert.deepEqual([r.status, r.json.status], [200, 'DUPLICATE']);
  assert.equal(r.json.registration, undefined);
  const snap = h.hub.backup(`${h.dir}-snaps`);
  t.after(() => fs.rmSync(`${h.dir}-snaps`, { recursive: true, force: true }));
  const raw = fs.readFileSync(path.join(snap, 'pets', `${PET}.json`), 'utf8');
  assert.ok(raw.includes('regIdHash') && !raw.includes(REG));
});
