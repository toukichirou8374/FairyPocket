// H2.3：hub.json 的初始化與 fail-closed（合成資料、暫存資料夾、測試埠）
// 只有完全全新的資料夾才建立 hub.json；已初始化的資料夾 hub.json 遺失／只剩暫存檔／只剩前一版／損壞 → 503，不重建、不刪證據
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHub } from '../hub.mjs';
import { wrap } from '../store.mjs';
import { JAVA_A, pocketState, registerAndLink, startHub } from './helpers.mjs';

const PET = 'TEST-0001';
const hubFile = (h, kind = '') => path.join(h.dir, `hub${kind}.json`);
const listAll = (d) => fs.readdirSync(d, { recursive: true }).map(String);

/** 已初始化、只有悅靈（沒做過綁定，所以沒有 hub.prev.json）的資料夾 */
async function withPetOnly(t) {
  const h = await startHub(t);
  await h.fp('POST', '/api/allay/pet/register', { petState: pocketState() });
  await h.close();
  assert.ok(fs.existsSync(hubFile(h)) && !fs.existsSync(hubFile(h, '.prev')));
  return h;
}
/** 綁定相關的寫入路徑都必須 503，而且不能重建 hub.json */
async function assertLinkClosed(h) {
  const c = await h.fp('POST', '/api/allay/link/create', { pet: PET });
  assert.deepEqual([c.status, c.json.error], [503, 'STORE_UNAVAILABLE'], 'link/create');
  assert.equal((await h.mc(JAVA_A, 'POST', '/api/allay/link/claim', { code: '123456' })).status, 503, 'link/claim');
  assert.equal((await h.fp('POST', '/api/allay/link/confirm', { linkId: 'a'.repeat(24), accept: true })).status, 503, 'link/confirm');
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/link/status?linkId=${'a'.repeat(24)}`)).status, 503, 'link/status');
  assert.ok(!fs.existsSync(hubFile(h)), '沒有產生新的 hub.json');
}

test('真正全新的空資料夾：建立 hub.json，綁定流程正常', async (t) => {
  const fresh = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fairy-h23-')), 'allay-hub');
  t.after(() => fs.rmSync(path.dirname(fresh), { recursive: true, force: true }));
  const h0 = createHub({ dir: fresh });
  assert.deepEqual([h0.report.fresh, h0.report.hub], [true, 'ok']);
  assert.ok(fs.existsSync(path.join(fresh, 'hub.json')));
  const h = await startHub(t); // 空的暫存資料夾
  assert.deepEqual([h.hub.report.fresh, h.hub.report.hub], [true, 'ok']);
  await registerAndLink(h, JAVA_A);
  assert.equal((await h.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 200);
});

test('已有悅靈但 hub.json 遺失：503，不重建空索引', async (t) => {
  let h = await withPetOnly(t);
  fs.rmSync(hubFile(h));
  h = await h.restart();
  assert.deepEqual([h.hub.report.fresh, h.hub.report.hub], [false, 'missing']);
  await assertLinkClosed(h);
  assert.equal((await h.fp('GET', `/api/allay/state?pet=${PET}`)).status, 200, '悅靈本身照常（授權只看悅靈文件）');
});

test('已有悅靈但只剩 hub.tmp.json：503，不重建；暫存檔保留在 quarantine 當證據', async (t) => {
  let h = await withPetOnly(t);
  fs.rmSync(hubFile(h));
  fs.writeFileSync(hubFile(h, '.tmp'), wrap({ codes: {}, linkIndex: {}, locks: {} }));
  h = await h.restart();
  assert.deepEqual([h.hub.report.fresh, h.hub.report.hub], [false, 'missing']);
  await assertLinkClosed(h);
  assert.ok(listAll(h.dir).some((f) => f.includes('quarantine') && f.endsWith('hub.tmp.json')), '證據沒有被刪');
});

test('只剩 hub.prev.json、或 hub.json 損壞：繼續拒絕；不覆寫、不刪證據', async (t) => {
  let h = await startHub(t);
  await registerAndLink(h, JAVA_A); // 綁定過，會有 hub.prev.json
  await h.close();
  fs.rmSync(hubFile(h));
  assert.ok(fs.existsSync(hubFile(h, '.prev')));
  h = await h.restart();
  assert.equal(h.hub.report.hub, 'broken');
  await assertLinkClosed(h);
  assert.ok(fs.existsSync(hubFile(h, '.prev')), '前一版留在原地');

  const h2 = await startHub(t);
  await registerAndLink(h2, JAVA_A);
  await h2.close();
  fs.writeFileSync(hubFile(h2), '{broken');
  const h3 = await h2.restart();
  assert.equal(h3.hub.report.hub, 'broken');
  const c = await h3.fp('POST', '/api/allay/link/create', { pet: PET });
  assert.equal(c.status, 503);
  assert.equal(fs.readFileSync(hubFile(h3), 'utf8'), '{broken', '損壞的檔案沒有被覆寫');
  assert.equal((await h3.mc(JAVA_A, 'GET', `/api/allay/state?pet=${PET}`)).status, 200, '已確認的授權不受影響');
});

test('不是全新：只有悅靈的暫存檔、或只有 quarantine 證據的資料夾，也不會建立 hub.json', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fairy-h23-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'a');
  fs.mkdirSync(path.join(a, 'pets'), { recursive: true });
  fs.writeFileSync(path.join(a, 'pets', `${PET}.tmp.json`), wrap({ pet: PET, rev: 1, epoch: 1 }));
  const ha = createHub({ dir: a });
  assert.deepEqual([ha.report.fresh, ha.report.hub], [false, 'missing']);
  assert.ok(!fs.existsSync(path.join(a, 'hub.json')));
  const b = path.join(root, 'b');
  fs.mkdirSync(path.join(b, 'quarantine', 'hub-2026-11-06'), { recursive: true });
  fs.writeFileSync(path.join(b, 'quarantine', 'hub-2026-11-06', 'hub.json'), '{evidence');
  const hb = createHub({ dir: b });
  assert.deepEqual([hb.report.fresh, hb.report.hub], [false, 'missing']);
  assert.ok(!fs.existsSync(path.join(b, 'hub.json')));
  assert.equal(fs.readFileSync(path.join(b, 'quarantine', 'hub-2026-11-06', 'hub.json'), 'utf8'), '{evidence');
  const c = path.join(root, 'c');
  fs.mkdirSync(path.join(c, 'pets'), { recursive: true }); // 只有空的子資料夾：仍算全新
  assert.equal(createHub({ dir: c }).report.fresh, true);
});
