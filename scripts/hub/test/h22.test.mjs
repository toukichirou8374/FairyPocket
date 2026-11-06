// H2.2：Astra 第二次複審的兩項儲存安全問題（合成資料、暫存資料夾、測試埠）
// 問題一：撤銷非控制者後還原舊備份，會重新開放權限
// 問題二：完整備份漏掉損壞的悅靈
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backup, restore, Store, verifyBackup } from '../store.mjs';
import { JAVA_A, pocketState, registerAndLink, startHub } from './helpers.mjs';

const PET = 'TEST-0001';
const code = (fn) => {
  try {
    fn();
  } catch (e) {
    return `${e.status} ${e.code} ${e.extra?.why ?? ''}`.trim();
  }
  return 'ok';
};
function snapsDir(t, h) {
  const d = `${h.dir}-snaps`;
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

// ---------- 問題一 ----------
test('問題一 回歸：綁定 → 備份 → 撤銷非控制者 → 403 → 不帶 --allow-rollback 還原 → 被拒；重啟後舊玩家仍是 403', async (t) => {
  let h = await startHub(t);
  await registerAndLink(h, JAVA_A); // 控制者是手機；JAVA_A 不是控制者
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 200);
  const snap = h.hub.backup(snapsDir(t, h));
  const rv = await h.fp('POST', '/api/allay/link/revoke', { pet: PET, actor: JAVA_A.actor });
  assert.deepEqual([rv.json.revoked, rv.json.epoch], [true, 1], '非控制者：epoch 不變');
  assert.equal(rv.json.authVersion, 2, '授權版本 +1（綁定 1 → 撤銷 2）');
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 403);
  await h.close();
  assert.equal(code(() => restore(snap, h.dir, Date.now())), '409 ROLLBACK_REFUSED auth_version');
  h = await h.restart();
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 403, '權限沒有被默默恢復');
});

test('問題一 對照：沒有任何變更時，正常備份 → 還原 → 重啟，資料與權限都相同', async (t) => {
  let h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  const before = (await h.fp('GET', `/api/allay/state?pet=${PET}`)).json;
  const snap = h.hub.backup(snapsDir(t, h));
  await h.close();
  assert.equal(restore(snap, h.dir, Date.now()).restored, 2);
  h = await h.restart();
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 200);
  const after = (await h.fp('GET', `/api/allay/state?pet=${PET}`)).json;
  assert.deepEqual([after.rev, after.epoch, after.links], [before.rev, before.epoch, before.links]);
});

test('問題一：明確加上 --allow-rollback 才會回到舊授權（管理者的決定）', async (t) => {
  let h = await startHub(t);
  await registerAndLink(h, JAVA_A);
  const snap = h.hub.backup(snapsDir(t, h));
  await h.fp('POST', '/api/allay/link/revoke', { pet: PET, actor: JAVA_A.actor });
  await h.close();
  restore(snap, h.dir, Date.now(), { allowRollback: true });
  h = await h.restart();
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 200);
});

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fairy-h22-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function seed(dir, petBody) {
  new Store(dir).commit('hub', { codes: {}, linkIndex: {}, locks: {} });
  new Store(path.join(dir, 'pets')).commit(PET, { pet: PET, rev: 5, epoch: 1, controller: null, ...petBody });
}

test('問題一：版本相同但生效的授權不同 → 拒絕危險覆寫（含沒有授權版本的舊格式）', (t) => {
  const root = tmp(t);
  const active = [{ key: JAVA_A.actor, status: 'active' }];
  const revoked = [{ key: JAVA_A.actor, status: 'revoked' }];
  seed(path.join(root, 'a'), { authVersion: 2, links: active });
  seed(path.join(root, 'b'), { authVersion: 2, links: revoked });
  const snap = backup(path.join(root, 'a'), path.join(root, 's'), 1);
  assert.equal(code(() => restore(snap, path.join(root, 'b'), 2)), '409 ROLLBACK_REFUSED auth_state');
  seed(path.join(root, 'c'), { links: active });
  seed(path.join(root, 'd'), { links: revoked });
  const snap2 = backup(path.join(root, 'c'), path.join(root, 's2'), 3);
  assert.equal(code(() => restore(snap2, path.join(root, 'd'), 4)), '409 ROLLBACK_REFUSED auth_state');
  // 授權完全相同：可以還原
  seed(path.join(root, 'e'), { authVersion: 2, links: active });
  assert.equal(restore(snap, path.join(root, 'e'), 5).restored, 2);
});

// ---------- 問題二 ----------
test('問題二 回歸：一隻正常、一隻損壞 → 重啟標記損壞 → hub.backup() 拒絕，不產生少一隻的快照', async (t) => {
  let h = await startHub(t);
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState({ id: 'TEST-0002' }) });
  await h.close();
  fs.writeFileSync(path.join(h.dir, 'pets', 'TEST-0002.json'), '{broken');
  h = await h.restart();
  assert.deepEqual(h.hub.report.pets.failed.map((f) => f.name), ['TEST-0002']);
  const dest = snapsDir(t, h);
  assert.equal(code(() => h.hub.backup(dest)), '500 BACKUP_SOURCE_CORRUPT unresolved');
  assert.ok(!fs.existsSync(dest) || fs.readdirSync(dest).length === 0, '沒有產生任何快照');
  await h.close();
  assert.equal(code(() => backup(h.dir, dest, Date.now())), '500 BACKUP_SOURCE_CORRUPT', '離線備份（CLI）也拒絕');
});

test('問題二：正式檔不見、只剩前一版（尚未處理的損壞）→ 離線備份也拒絕', async (t) => {
  const h = await startHub(t);
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState({ id: 'TEST-0002' }) });
  await h.fp('POST', '/api/allay/events', { pet: 'TEST-0002', baseRevision: 1, epoch: 1, events: [{ opId: 'op-h22-00001', type: 'PETTED', payload: {} }] });
  await h.close();
  fs.rmSync(path.join(h.dir, 'pets', 'TEST-0002.json'));
  assert.ok(fs.existsSync(path.join(h.dir, 'pets', 'TEST-0002.prev.json')));
  assert.equal(code(() => backup(h.dir, snapsDir(t, h), Date.now())), '500 BACKUP_SOURCE_CORRUPT unresolved');
});

test('問題二 對照：全部正常時可以完整備份，兩隻都在，驗證通過', async (t) => {
  const h = await startHub(t);
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState({ id: 'TEST-0002' }) });
  const snap = h.hub.backup(snapsDir(t, h));
  const v = verifyBackup(snap);
  assert.deepEqual(v.files.sort(), ['hub.json', 'pets/TEST-0001.json', 'pets/TEST-0002.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(snap, 'manifest.json'), 'utf8')).complete, true);
});

test('問題二：沒有「完整」標記的快照（例如舊版產生、可能漏掉損壞文件）驗證不通過', (t) => {
  const root = tmp(t);
  seed(path.join(root, 'a'), { authVersion: 0, links: [] });
  const snap = backup(path.join(root, 'a'), path.join(root, 's'), 1);
  const mf = path.join(snap, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  delete m.complete;
  fs.writeFileSync(mf, JSON.stringify(m));
  assert.equal(code(() => verifyBackup(snap)), '400 BACKUP_INVALID not_complete');
});
