// 交易式耐久儲存：重啟、當機在各個時間點、檔案損壞、寫入失敗、備份與還原
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backup, restore, Store, unwrap, verifyBackup, wrap } from '../store.mjs';

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

test('寫入後重啟仍在；檔案帶格式與 SHA-256 檢查碼', (t) => {
  const d = tmpDir(t);
  new Store(d).commit('pet1', { rev: 3, x: '悅靈' });
  const s2 = new Store(d);
  assert.deepEqual(s2.get('pet1'), { rev: 3, x: '悅靈' });
  const env = JSON.parse(fs.readFileSync(path.join(d, 'pet1.json'), 'utf8'));
  assert.equal(env.format, 'fairy-hub-doc');
  assert.match(env.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(s2.report.loaded, ['pet1']);
});

test('寫入失敗（寫檔前）：回 503 STORE_UNAVAILABLE，檔案與記憶體都不變', (t) => {
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

test('當機在「暫存檔寫好、還沒換上」：重啟用舊的正式檔（沒有 ACK 的寫入不算），並清掉暫存檔', (t) => {
  const d = tmpDir(t);
  const s = new Store(d, { faults: {} });
  s.commit('pet1', { rev: 1 });
  s.faults.afterTmp = () => {
    throw new Error('power loss');
  };
  s.faults.keepTmp = true;
  assert.equal(status(() => s.commit('pet1', { rev: 2 })), '503 STORE_UNAVAILABLE');
  assert.ok(fs.existsSync(path.join(d, 'pet1.tmp.json')));
  const s2 = new Store(d);
  assert.deepEqual(s2.get('pet1'), { rev: 1 });
  assert.deepEqual(s2.report.cleaned, ['pet1']);
  assert.ok(!fs.existsSync(path.join(d, 'pet1.tmp.json')));
});

test('正式檔損壞：用前一版復原；正式檔不見但暫存檔完整：用暫存檔復原', (t) => {
  const d = tmpDir(t);
  const s = new Store(d);
  s.commit('pet1', { rev: 1 });
  s.commit('pet1', { rev: 2 });
  const f = path.join(d, 'pet1.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"rev":2', '"rev":9')); // 竄改：檢查碼不符
  const s2 = new Store(d);
  assert.deepEqual(s2.get('pet1'), { rev: 1 });
  assert.deepEqual(s2.report.recovered, [{ name: 'pet1', from: 'prev' }]);
  assert.ok(unwrap(fs.readFileSync(f, 'utf8')), '復原後正式檔重新寫好');

  fs.rmSync(f);
  fs.writeFileSync(path.join(d, 'pet1.tmp.json'), wrap({ rev: 5 }));
  const s3 = new Store(d);
  assert.deepEqual(s3.get('pet1'), { rev: 5 });
  assert.deepEqual(s3.report.recovered, [{ name: 'pet1', from: 'tmp' }]);
});

test('全部損壞：拒絕載入並回報，不會當成不存在（避免被空資料蓋掉）', (t) => {
  const d = tmpDir(t);
  fs.writeFileSync(path.join(d, 'pet1.json'), '{broken');
  fs.writeFileSync(path.join(d, 'pet1.prev.json'), '{"format":"fairy-hub-doc","hubSchema":1,"sha256":"00","body":{}}');
  const s = new Store(d);
  assert.equal(s.get('pet1'), null);
  assert.ok(s.isBroken('pet1'));
  assert.deepEqual(s.report.failed, ['pet1']);
  assert.ok(fs.existsSync(path.join(d, 'pet1.json')), '壞掉的檔案保留下來給人檢查');
});

test('備份 → 驗證 → 還原；竄改過的快照拒絕還原；原資料保留', (t) => {
  const root = tmpDir(t);
  const dir = path.join(root, 'hub');
  new Store(dir).commit('hub', { links: 1 });
  new Store(path.join(dir, 'pets')).commit('TEST-0001', { rev: 7 });
  const snap = backup(dir, path.join(root, 'backups'), 1793900000000);
  assert.deepEqual(verifyBackup(snap).sort(), ['hub.json', 'pets/TEST-0001.json']);

  new Store(path.join(dir, 'pets')).commit('TEST-0001', { rev: 8 }); // 備份之後又改了
  const r = restore(snap, dir, 1793900001000);
  assert.equal(r.restored, 2);
  assert.ok(r.previous && fs.existsSync(r.previous));
  assert.deepEqual(new Store(path.join(dir, 'pets')).get('TEST-0001'), { rev: 7 });

  const bad = backup(dir, path.join(root, 'backups2'), 1793900002000);
  const f = path.join(bad, 'pets', 'TEST-0001.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"rev":7', '"rev":70'));
  assert.equal(status(() => verifyBackup(bad)), '400 BACKUP_INVALID');
  assert.equal(status(() => restore(bad, dir, 1793900003000)), '400 BACKUP_INVALID');
  assert.deepEqual(new Store(path.join(dir, 'pets')).get('TEST-0001'), { rev: 7 }, '驗證失敗時完全不動原資料');
});

test('備份工具（CLI）：backup／verify／restore', async (t) => {
  const root = tmpDir(t);
  const dir = path.join(root, 'hub');
  new Store(path.join(dir, 'pets')).commit('TEST-0002', { rev: 1 });
  const { execFileSync } = await import('node:child_process');
  const cli = path.resolve(import.meta.dirname, '..', 'backup-cli.mjs');
  const out = execFileSync(process.execPath, [cli, 'backup', path.join(root, 'b'), '--dir', dir], { encoding: 'utf8' });
  const snap = out.match(/快照：(.+)/)[1].trim();
  assert.match(execFileSync(process.execPath, [cli, 'verify', snap], { encoding: 'utf8' }), /快照正確，共 1 個檔案/);
  assert.match(execFileSync(process.execPath, [cli, 'restore', snap, '--dir', dir], { encoding: 'utf8' }), /已還原 1 個檔案/);
});
