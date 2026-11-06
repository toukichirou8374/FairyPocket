// 交易式耐久儲存（H2.1）：重啟、寫入失敗、當機、損壞（fail-closed、保留證據、人工復原）、
// 備份（來源不存在、空快照、損壞、不穩定、跨文件一致性）、還原（驗證、拒絕回退、中途失敗）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backup, recoverDoc, restore, Store, unwrap, verifyBackup, wrap } from '../store.mjs';

function tmpDir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fairy-store-test-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
const status = (fn) => {
  try {
    fn();
  } catch (e) {
    return `${e.status} ${e.code}`;
  }
  return 'ok';
};
const why = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.extra?.why ?? e.code;
  }
  return 'ok';
};
const quarantineFiles = (d) => (fs.existsSync(path.join(d, 'quarantine')) ? fs.readdirSync(path.join(d, 'quarantine'), { recursive: true }).map(String) : []);

/** 一組合法、跨文件一致的 Hub 資料 */
function seedHub(dir, pets = { 'TEST-0001': 7 }) {
  const h = new Store(dir);
  h.commit('hub', { codes: {}, linkIndex: {}, locks: {} });
  const p = new Store(path.join(dir, 'pets'));
  for (const [pet, rev] of Object.entries(pets)) p.commit(pet, { pet, rev, epoch: 1 });
}

// ---------- 交易與重啟 ----------
test('寫入後重啟仍在；檔案帶格式與 SHA-256 檢查碼', (t) => {
  const d = tmpDir(t);
  new Store(d).commit('pet1', { rev: 3, x: '悅靈' });
  const s2 = new Store(d);
  assert.deepEqual(s2.get('pet1'), { rev: 3, x: '悅靈' });
  const env = JSON.parse(fs.readFileSync(path.join(d, 'pet1.json'), 'utf8'));
  assert.equal(env.format, 'fairy-hub-doc');
  assert.match(env.sha256, /^[a-f0-9]{64}$/);
});

test('寫入失敗（寫檔前）：回 503，檔案與記憶體都不變', (t) => {
  const d = tmpDir(t);
  const s = new Store(d);
  s.commit('pet1', { rev: 1 });
  s.faults.beforeWrite = () => {
    throw new Error('disk full');
  };
  assert.equal(status(() => s.commit('pet1', { rev: 2 })), '503 STORE_UNAVAILABLE');
  assert.deepEqual(s.get('pet1'), { rev: 1 });
  assert.deepEqual(new Store(d).get('pet1'), { rev: 1 });
});

test('當機在「暫存檔寫好、還沒換上」：用最後 ACK 的正式檔；暫存檔移到 quarantine 保留證據', (t) => {
  const d = tmpDir(t);
  const s = new Store(d, { faults: {} });
  s.commit('pet1', { rev: 1 });
  Object.assign(s.faults, { afterTmp: () => { throw new Error('power loss'); }, keepTmp: true });
  assert.equal(status(() => s.commit('pet1', { rev: 2 })), '503 STORE_UNAVAILABLE');
  const s2 = new Store(d);
  assert.deepEqual(s2.get('pet1'), { rev: 1 });
  assert.ok(!fs.existsSync(path.join(d, 'pet1.tmp.json')));
  assert.ok(quarantineFiles(d).some((f) => f.endsWith('pet1.tmp.json')), '證據保留');
});

// ---------- P1-5：首次建立 vs 資料損壞 ----------
test('P1-5 第一次建立就中斷（只有暫存檔）：從未 ACK，當作不存在，之後可以正常建立', (t) => {
  const d = tmpDir(t);
  fs.writeFileSync(path.join(d, 'pet1.tmp.json'), wrap({ rev: 1 }));
  const s = new Store(d);
  assert.deepEqual([s.get('pet1'), s.isBroken('pet1'), s.report.aborted], [null, false, ['pet1']]);
  assert.ok(quarantineFiles(d).some((f) => f.endsWith('pet1.tmp.json')));
  s.commit('pet1', { rev: 1 });
  assert.deepEqual(new Store(d).get('pet1'), { rev: 1 });
});

test('P1-5 正式檔損壞：不自動退回前一版；整份無法使用、拒絕覆寫；證據保留；可人工復原並留紀錄', (t) => {
  const d = tmpDir(t);
  const s = new Store(d);
  s.commit('pet1', { pet: 'pet1', rev: 1, epoch: 1, links: ['active'] });
  s.commit('pet1', { pet: 'pet1', rev: 2, epoch: 2, links: ['revoked'] });
  const f = path.join(d, 'pet1.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"rev":2', '"rev":9')); // 檢查碼不符
  const s2 = new Store(d);
  assert.equal(s2.get('pet1'), null, '沒有退回前一版（前一版的權限還是 active）');
  assert.ok(s2.isBroken('pet1'));
  assert.deepEqual(s2.report.failed, [{ name: 'pet1', why: 'checksum_or_format' }]);
  assert.equal(status(() => s2.commit('pet1', { rev: 1 })), '503 STORE_UNAVAILABLE', '不能當成不存在而重建');
  const q = quarantineFiles(d);
  assert.ok(q.some((x) => x.endsWith('pet1.json')) && q.some((x) => x.endsWith('pet1.prev.json')), '正式檔與前一版都複製一份當證據');
  assert.ok(fs.existsSync(f), '原檔留在原地，重啟後仍然是損壞狀態');
  assert.ok(new Store(d).isBroken('pet1'));
  // 人工復原（管理者的決定）
  const r = recoverDoc(d, 'pet1', 'prev');
  assert.deepEqual([r.rev, r.epoch], [1, 1]);
  assert.ok(fs.existsSync(path.join(r.evidence, 'RECOVERY.txt')));
  assert.deepEqual(new Store(d).get('pet1').rev, 1);
});

test('P1-5 正式檔不見但有前一版：視為損壞（不是首次建立），拒絕使用', (t) => {
  const d = tmpDir(t);
  const s = new Store(d);
  s.commit('pet1', { rev: 1 });
  s.commit('pet1', { rev: 2 });
  fs.rmSync(path.join(d, 'pet1.json'));
  const s2 = new Store(d);
  assert.deepEqual([s2.get('pet1'), s2.report.failed], [null, [{ name: 'pet1', why: 'main_missing' }]]);
});

// ---------- P1-6：備份 ----------
test('P1-6 備份：來源不存在、空資料、損壞的來源、跨文件不一致都拒絕', (t) => {
  const root = tmpDir(t);
  assert.equal(status(() => backup(path.join(root, 'nope'), path.join(root, 'b'))), '400 BACKUP_SOURCE_MISSING');
  fs.mkdirSync(path.join(root, 'empty'));
  assert.equal(status(() => backup(path.join(root, 'empty'), path.join(root, 'b'))), '400 BACKUP_EMPTY');
  assert.ok(backup(path.join(root, 'empty'), path.join(root, 'b'), 1, { allowEmpty: true }), '明確允許才可以備份空資料');
  const dir = path.join(root, 'hub');
  seedHub(dir);
  fs.writeFileSync(path.join(dir, 'pets', 'TEST-0002.json'), '{broken');
  assert.equal(status(() => backup(dir, path.join(root, 'b'), 2)), '500 BACKUP_SOURCE_CORRUPT');
  fs.rmSync(path.join(dir, 'pets', 'TEST-0002.json'));
  new Store(dir).commit('hub', { codes: { x: { pet: 'GONE-0000', exp: 1 } }, linkIndex: {}, locks: {} });
  assert.equal(why(() => backup(dir, path.join(root, 'b'), 3)), 'code_without_pet');
  const dir2 = path.join(root, 'nohub');
  new Store(path.join(dir2, 'pets')).commit('TEST-0001', { pet: 'TEST-0001', rev: 1, epoch: 1 });
  assert.equal(why(() => backup(dir2, path.join(root, 'b'), 4)), 'hub_missing', '不完整（少了 hub.json）');
  const dir3 = path.join(root, 'misnamed');
  seedHub(dir3);
  new Store(path.join(dir3, 'pets')).commit('TEST-0009', { pet: 'TEST-0001', rev: 1, epoch: 1 });
  assert.equal(why(() => backup(dir3, path.join(root, 'b'), 5)), 'pet_name_mismatch');
});

test('P1-6 備份：資料在備份期間一直變動 → BACKUP_UNSTABLE；變動一次後穩定 → 成功並取得一致視圖', (t) => {
  const root = tmpDir(t);
  const dir = path.join(root, 'hub');
  seedHub(dir);
  const pets = new Store(path.join(dir, 'pets'));
  let rev = 7;
  const always = { betweenReads: () => pets.commit('TEST-0001', { pet: 'TEST-0001', rev: ++rev, epoch: 1 }) };
  assert.equal(status(() => backup(dir, path.join(root, 'b'), 1, { faults: always })), '409 BACKUP_UNSTABLE');
  const once = { betweenReads: (n) => n === 0 && pets.commit('TEST-0001', { pet: 'TEST-0001', rev: ++rev, epoch: 1 }) };
  const snap = backup(dir, path.join(root, 'b'), 2, { faults: once });
  assert.equal(verifyBackup(snap).docs['pets/TEST-0001.json'].rev, rev);
});

test('P1-6 驗證：少檔、多檔、清單空白、雜湊不符都拒絕', (t) => {
  const root = tmpDir(t);
  const dir = path.join(root, 'hub');
  seedHub(dir, { 'TEST-0001': 1, 'TEST-0002': 1 });
  const mk = (n) => backup(dir, path.join(root, `b${n}`), n);
  const s1 = mk(1);
  fs.rmSync(path.join(s1, 'pets', 'TEST-0002.json'));
  assert.equal(why(() => verifyBackup(s1)), 'missing');
  const s2 = mk(2);
  fs.writeFileSync(path.join(s2, 'pets', 'TEST-0003.json'), wrap({ pet: 'TEST-0003', rev: 1, epoch: 1 }));
  assert.equal(why(() => verifyBackup(s2)), 'unlisted_file');
  const s3 = mk(3);
  const m = JSON.parse(fs.readFileSync(path.join(s3, 'manifest.json'), 'utf8'));
  fs.writeFileSync(path.join(s3, 'manifest.json'), JSON.stringify({ ...m, files: {} }));
  for (const f of ['hub.json', 'pets/TEST-0001.json', 'pets/TEST-0002.json']) fs.rmSync(path.join(s3, f));
  assert.equal(status(() => verifyBackup(s3)), '400 BACKUP_EMPTY');
  const s4 = mk(4);
  const f = path.join(s4, 'pets', 'TEST-0001.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"rev":1', '"rev":70'));
  assert.equal(why(() => verifyBackup(s4)), 'checksum');
  assert.equal(why(() => verifyBackup(path.join(root, 'none'))), 'missing_snapshot');
});

// ---------- P1-6：還原 ----------
test('P1-6 還原：正常還原；目前資料比快照新時拒絕回退（明確允許才放行）', (t) => {
  const root = tmpDir(t);
  const dir = path.join(root, 'hub');
  seedHub(dir);
  const snap = backup(dir, path.join(root, 'b'), 1);
  new Store(path.join(dir, 'pets')).commit('TEST-0001', { pet: 'TEST-0001', rev: 8, epoch: 2 }); // 備份之後又前進
  assert.equal(status(() => restore(snap, dir, 2)), '409 ROLLBACK_REFUSED');
  assert.equal(new Store(path.join(dir, 'pets')).get('TEST-0001').rev, 8, '拒絕時完全不動');
  const r = restore(snap, dir, 3, { allowRollback: true });
  assert.equal(r.restored, 2);
  assert.ok(fs.existsSync(r.previous));
  assert.equal(new Store(path.join(dir, 'pets')).get('TEST-0001').rev, 7);
});

test('P1-6 還原中途失敗：複製到一半失敗 → 原資料不動、暫存資料夾清掉；替換時失敗 → 原資料夾復原', (t) => {
  const root = tmpDir(t);
  const dir = path.join(root, 'hub');
  seedHub(dir, { 'TEST-0001': 1, 'TEST-0002': 1 });
  const snap = backup(dir, path.join(root, 'b'), 1);
  const before = fs.readFileSync(path.join(dir, 'pets', 'TEST-0001.json'), 'utf8');
  const copyFail = { duringCopy: (i) => { if (i === 1) throw new Error('disk error'); } };
  assert.equal(why(() => restore(snap, dir, 2, { faults: copyFail })), 'copy');
  assert.equal(fs.readFileSync(path.join(dir, 'pets', 'TEST-0001.json'), 'utf8'), before);
  assert.ok(!fs.readdirSync(root).some((f) => f.startsWith('hub.restore-')), '暫存資料夾已清掉');
  const swapFail = { beforeSwap: () => { throw new Error('rename failed'); } };
  assert.equal(why(() => restore(snap, dir, 3, { faults: swapFail })), 'swap');
  assert.equal(fs.readFileSync(path.join(dir, 'pets', 'TEST-0001.json'), 'utf8'), before, '原資料夾回到原位');
  assert.ok(!fs.readdirSync(root).some((f) => f.startsWith('hub.restore-') || f.startsWith('hub.old-')));
});

test('備份工具（CLI）：backup／verify／restore／recover', async (t) => {
  const root = tmpDir(t);
  const dir = path.join(root, 'hub');
  seedHub(dir);
  const { execFileSync } = await import('node:child_process');
  const cli = path.resolve(import.meta.dirname, '..', 'backup-cli.mjs');
  const run = (...a) => execFileSync(process.execPath, [cli, ...a], { encoding: 'utf8' });
  const snap = run('backup', path.join(root, 'b'), '--dir', dir).match(/快照：(.+)/)[1].trim();
  assert.match(run('verify', snap), /快照正確，共 2 個檔案/);
  assert.match(run('restore', snap, '--dir', dir), /已還原 2 個檔案/);
  const p = new Store(path.join(dir, 'pets'));
  p.commit('TEST-0001', { pet: 'TEST-0001', rev: 8, epoch: 1 });
  fs.writeFileSync(path.join(dir, 'pets', 'TEST-0001.json'), '{broken');
  assert.match(run('recover', 'TEST-0001', 'prev', '--pets', '--dir', dir), /已用 prev 復原 TEST-0001（rev 7/);
  assert.ok(unwrap(fs.readFileSync(path.join(dir, 'pets', 'TEST-0001.json'), 'utf8')));
});
