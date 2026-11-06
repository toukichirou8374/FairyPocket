// H3-1：Pocket 同步適配器 × 真正的 Fairy Hub（H2.3＋RENAME），全部在隔離環境：
// 暫存資料夾、測試埠、測試用通行碼、合成悅靈與合成玩家；不連正式轉接服務、不碰真實存檔、不連 Ollama
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createRelay } from '../../scripts/ai-proxy.mjs';
import { createHub } from '../../scripts/hub/hub.mjs';
import { restore } from '../../scripts/hub/store.mjs';
import { createPet, feed, pet as petPet, play, type PetState } from '../../src/game/state';
import { httpTransport, noteId, PocketSync, SYNC_KEY, type KV, type RemoteApply, type Transport } from '../../src/hub/pocketSync';

const FP_TOKEN = 'test-fp-token-aaaa';
const MC_TOKEN = 'test-mc-token-bbbb';
const JAVA_A = { actor: 'java:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b', name: 'TestSteve' };
const PET = 'TEST-0001';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

// ---------- 隔離的 Hub ----------
async function startHub(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fairy-h3-'))) {
  const hub = createHub({ dir, ai: { route: 'RULES', ask: async () => '' } });
  const server: Server = createRelay({ token: FP_TOKEN, mcToken: MC_TOKEN, hub });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let closed = false;
  const close = () =>
    new Promise<void>((r) => {
      if (closed) return r();
      closed = true;
      server.closeAllConnections();
      server.close(() => r());
    });
  cleanups.push(close);
  return { dir, url, hub, close };
}
const hubUrl = { current: '' };
async function call(token: string, method: 'GET' | 'POST', p: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(hubUrl.current + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const fpCall = (m: 'GET' | 'POST', p: string, b?: unknown) => call(FP_TOKEN, m, p, b, { 'X-Fairy-Source': 'pocket-other-01' });
const mcCall = (m: 'GET' | 'POST', p: string, b?: unknown) =>
  call(MC_TOKEN, m, p, b, { 'X-Fairy-Source': 'paper-server-01', 'X-Fairy-Actor': JAVA_A.actor, 'X-Fairy-Actor-Name': JAVA_A.name });
const hubState = async () => (await fpCall('GET', `/api/allay/state?pet=${PET}`)).json;
async function linkMc() {
  const c = await fpCall('POST', '/api/allay/link/create', { pet: PET });
  const cl = await mcCall('POST', '/api/allay/link/claim', { code: c.json.code });
  await fpCall('POST', '/api/allay/link/confirm', { linkId: cl.json.linkId, accept: true });
}
async function mcEvents(events: { opId: string; type: string; payload: Record<string, unknown> }[]) {
  const s = (await mcCall('GET', `/api/allay/state?pet=${PET}`)).json;
  return mcCall('POST', '/api/allay/events', { pet: PET, baseRevision: s.rev, epoch: s.epoch, events });
}

// ---------- 合成的 App（本機狀態＋本機儲存） ----------
function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
interface FakeApp {
  pet: PetState;
  notes: string[];
  shared: string[];
  sync: PocketSync;
  types: string[];
  net: { offline: boolean; dropResponseOnce: boolean; beforeEvents: (() => Promise<void>) | null };
}
function makeApp(storage: KV, pet: PetState, notes: string[] = []): FakeApp {
  const app = { pet, notes, shared: [] as string[], types: [] as string[], net: { offline: false, dropResponseOnce: false, beforeEvents: null as (() => Promise<void>) | null } } as FakeApp;
  const transport = (sourceId: string): Transport => {
    return async (method, p, body) => {
      if (app.net.offline) throw new Error('offline');
      if (p === '/api/allay/events' && body) {
        for (const e of (body as { events: { type: string }[] }).events) app.types.push(e.type);
        if (app.net.beforeEvents) {
          const hook = app.net.beforeEvents;
          app.net.beforeEvents = null;
          await hook();
        }
      }
      const r = await httpTransport(hubUrl.current, FP_TOKEN, sourceId)(method, p, body);
      if (app.net.dropResponseOnce && p === '/api/allay/events') {
        app.net.dropResponseOnce = false;
        throw new Error('response lost'); // 請求已經到 Hub，但回應在路上遺失
      }
      return r;
    };
  };
  app.sync = new PocketSync({
    storage,
    transport,
    getPet: () => app.pet,
    getNotes: () => app.notes,
    applyRemote: (r: RemoteApply) => {
      if (r.name !== undefined) app.pet.name = r.name;
      if (r.affection !== undefined) app.pet.affection = r.affection;
      if (r.stats) app.pet.stats = { ...r.stats };
      if (r.vitals) Object.assign(app.pet, r.vitals);
      app.shared = r.sharedMemories ?? [];
    },
  });
  return app;
}
const synthPet = (): PetState => ({ ...createPet(1793800000000), id: PET, name: '測試悅靈', onboarded: true });

describe('H3-1 Pocket 同步（隔離 Hub）', () => {
  it('改名、感情、記憶：同步後一致；App 重啟＋Hub 重啟後仍一致、不重複計算', async () => {
    let hub = await startHub();
    hubUrl.current = hub.url;
    const kv = memoryKV();
    let app = makeApp(kv, synthPet(), ['小明喜歡恐龍']);
    expect((await app.sync.sync()).status).toBe('ok'); // 登記
    // 本機操作（照原本 App 的規則改本機狀態）＋記下事件
    app.pet.name = '小麻糬';
    app.sync.recordRename('小麻糬');
    petPet(app.pet);
    app.sync.recordPetted();
    play(app.pet);
    app.sync.recordPlayed();
    feed(app.pet, 'cookie');
    app.sync.recordFed('cookie');
    app.notes.push('媽媽的生日是三月');
    app.sync.syncNotes();
    const local = { name: app.pet.name, affection: app.pet.affection, stats: { ...app.pet.stats } };
    const r = await app.sync.sync();
    expect([r.status, r.pending]).toEqual(['ok', 0]);
    let s = await hubState();
    expect([s.profile.name, s.state.affection, s.stats]).toEqual([local.name, local.affection, local.stats]);
    expect(s.memories.map((m: { text: string }) => m.text).sort()).toEqual(['小明喜歡恐龍', '媽媽的生日是三月'].sort());
    expect(s.memories.every((m: { visibility: string }) => m.visibility === 'private')).toBe(true);

    // App 重啟（同一份本機儲存）＋Hub 重啟（同一個資料夾）
    await hub.close();
    hub = await startHub(hub.dir);
    hubUrl.current = hub.url;
    const savedPet = { ...app.pet, stats: { ...app.pet.stats } };
    app = makeApp(kv, savedPet, [...app.notes]);
    app.sync.syncNotes(); // 記憶沒變：不會產生新事件
    expect(app.sync.info().pending).toBe(0);
    expect((await app.sync.sync()).status).toBe('ok');
    s = await hubState();
    expect([s.profile.name, s.state.affection, s.stats.petted, s.stats.played, s.stats.fed]).toEqual([local.name, local.affection, 1, 1, 1]);
    expect([app.pet.name, app.pet.affection]).toEqual([local.name, local.affection]);
  });

  it('離線：動作留在本機佇列；App 重啟後佇列還在；連上後只套用一次', async () => {
    const hub = await startHub();
    hubUrl.current = hub.url;
    const kv = memoryKV();
    let app = makeApp(kv, synthPet());
    await app.sync.sync();
    app.net.offline = true;
    petPet(app.pet);
    app.sync.recordPetted();
    app.sync.recordPetted();
    expect((await app.sync.sync()).status).toBe('offline');
    // App 重啟：從本機儲存讀回佇列（同一個 sourceId、同一個 opId）
    const before = app.sync.info();
    app = makeApp(kv, app.pet);
    expect(app.sync.info()).toMatchObject({ pending: 2, sourceId: before.sourceId });
    expect(app.sync.info().outbox.map((e) => e.opId)).toEqual(before.outbox.map((e) => e.opId));
    expect((await app.sync.sync()).status).toBe('ok');
    expect((await hubState()).stats.petted).toBe(2);
    expect((await app.sync.sync()).status).toBe('ok');
    expect((await hubState()).stats.petted).toBe(2);
  });

  it('回應遺失：Hub 其實已套用，重送只回 DUPLICATE，不會多算', async () => {
    const hub = await startHub();
    hubUrl.current = hub.url;
    const app = makeApp(memoryKV(), synthPet());
    await app.sync.sync();
    app.sync.recordPlayed();
    app.net.dropResponseOnce = true;
    expect((await app.sync.sync()).status).toBe('offline');
    expect(app.sync.info().pending).toBe(1);
    expect((await app.sync.sync()).status).toBe('ok');
    expect((await hubState()).stats.played).toBe(1);
  });

  it('revision 衝突：送出前 Minecraft 先改了 → 重新讀取、同樣的 opId 重送，兩邊的變化都在', async () => {
    const hub = await startHub();
    hubUrl.current = hub.url;
    const app = makeApp(memoryKV(), synthPet());
    await app.sync.sync();
    await linkMc();
    app.sync.recordPetted();
    app.net.beforeEvents = async () => {
      await mcEvents([{ opId: 'mc-mem-000001', type: 'MEMORY_ADD', payload: { memoryId: 'mem-mc-000001', text: '一起蓋了城堡' } }]);
    };
    const r = await app.sync.sync();
    expect([r.status, r.pending]).toEqual(['ok', 0]);
    const s = await hubState();
    expect(s.stats.petted).toBe(1);
    expect(s.memories.map((m: { text: string }) => m.text)).toContain('一起蓋了城堡');
    expect(app.shared).toEqual(['一起蓋了城堡']);
  });

  it('控制權交接：Minecraft 控制中不搶（數值事件等待）；Minecraft 放開後接回，採用 Minecraft 期間的數值再送出', async () => {
    const hub = await startHub();
    hubUrl.current = hub.url;
    const app = makeApp(memoryKV(), synthPet());
    await app.sync.sync();
    await linkMc();
    let s = await hubState();
    const claim = await mcCall('POST', '/api/allay/control/claim', { pet: PET, baseRevision: s.rev, opId: 'mc-claim-0001' });
    await mcEvents([
      { opId: 'mc-gift-00001', type: 'GIFT', payload: { item: 'poppy' } },
      { opId: 'mc-time-00001', type: 'TIME_PASSED', payload: { seconds: 600, night: false } },
    ]);
    petPet(app.pet);
    app.sync.recordPetted();
    app.notes.push('今天去公園');
    app.sync.syncNotes();
    const w = await app.sync.sync();
    expect([w.status, w.pending]).toEqual(['waitingControl', 1]); // 記憶已送出，摸頭還在等
    expect((await hubState()).memories.map((m: { text: string }) => m.text)).toContain('今天去公園');
    s = await hubState();
    await mcCall('POST', '/api/allay/control/release', { pet: PET, epoch: claim.json.epoch, opId: 'mc-release-01' });
    const hungerOnHub = s.state.hunger;
    const r = await app.sync.sync();
    expect([r.status, r.pending]).toEqual(['ok', 0]);
    s = await hubState();
    expect(s.controller.role).toBe('fp');
    expect(s.state.affection).toBe(10 + 2 + 1.5); // 初始 10 ＋ Minecraft 的禮物 2 ＋ 手機摸頭 1.5
    expect(app.pet.affection).toBe(13.5);
    expect(app.pet.hunger).toBeCloseTo(hungerOnHub, 5); // 接回時採用 Minecraft 期間的數值（TIME_PASSED 讓飽食下降）
    expect(hungerOnHub).toBeLessThan(16);
  });

  it('主人明確「叫回手機」：即使 Minecraft 沒放開也接管；Minecraft 舊世代的數值事件被拒', async () => {
    const hub = await startHub();
    hubUrl.current = hub.url;
    const app = makeApp(memoryKV(), synthPet());
    await app.sync.sync();
    await linkMc();
    const s = await hubState();
    const claim = await mcCall('POST', '/api/allay/control/claim', { pet: PET, baseRevision: s.rev, opId: 'mc-claim-0001' });
    app.sync.recordPetted();
    expect((await app.sync.sync()).status).toBe('waitingControl');
    expect((await app.sync.takeover()).status).toBe('ok');
    const s2 = await hubState();
    const old = await mcCall('POST', '/api/allay/events', { pet: PET, baseRevision: s2.rev, epoch: claim.json.epoch, events: [{ opId: 'mc-pet-000001', type: 'PETTED', payload: {} }] });
    expect([old.status, old.json.error]).toEqual([409, 'STALE_EPOCH']);
  });

  it('防倒退：Hub 被還原成較舊的資料 → 停止同步、不採用遠端數值、保留佇列', async () => {
    let hub = await startHub();
    hubUrl.current = hub.url;
    const app = makeApp(memoryKV(), synthPet());
    await app.sync.sync();
    const snap = hub.hub.backup(`${hub.dir}-snaps`);
    cleanups.push(() => fs.rmSync(`${hub.dir}-snaps`, { recursive: true, force: true }));
    app.sync.recordPetted();
    app.sync.recordPlayed();
    expect((await app.sync.sync()).status).toBe('ok');
    const affection = app.pet.affection;
    await hub.close();
    restore(snap, hub.dir, Date.now(), { allowRollback: true }); // 模擬管理者還原了舊備份
    hub = await startHub(hub.dir);
    hubUrl.current = hub.url;
    app.sync.recordPetted();
    const r = await app.sync.sync();
    expect([r.status, r.pending]).toEqual(['hubRollback', 1]);
    expect(app.pet.affection).toBe(affection); // 沒有被舊資料拉回去
  });

  it('不送快照：適配器送出的事件只有 FED／PETTED／PLAYED／RENAME／MEMORY_*／DIALOGUE_ADD，沒有 VITALS_SYNC', async () => {
    const hub = await startHub();
    hubUrl.current = hub.url;
    const app = makeApp(memoryKV(), synthPet(), ['a note']);
    await app.sync.sync();
    app.sync.recordFed('bread');
    app.sync.recordPetted();
    app.sync.recordPlayed();
    app.sync.recordRename('新名字');
    app.sync.recordDialogue('user', '小明', '你好');
    app.sync.syncNotes();
    await app.sync.sync();
    expect(new Set(app.types)).toEqual(new Set(['FED', 'PETTED', 'PLAYED', 'RENAME', 'DIALOGUE_ADD', 'MEMORY_ADD']));
    expect('recordVitals' in app.sync).toBe(false);
  });

  it('記憶：刪除會同步；同一句記憶永遠同一個 ID；Minecraft 的記憶分開保存、不擠掉手機的記憶', async () => {
    const hub = await startHub();
    hubUrl.current = hub.url;
    const app = makeApp(memoryKV(), synthPet(), ['喜歡藍色', '養了一隻狗']);
    await app.sync.sync();
    app.sync.syncNotes();
    await app.sync.sync();
    app.notes = ['養了一隻狗'];
    app.sync.syncNotes();
    await app.sync.sync();
    let s = await hubState();
    expect(s.memories.map((m: { text: string }) => m.text)).toEqual(['養了一隻狗']);
    expect(s.memories[0].memoryId).toBe(noteId('養了一隻狗'));
    await linkMc();
    for (let b = 0; b < 2; b++)
      await mcEvents(Array.from({ length: 15 }, (_, i) => ({ opId: `mc-m-${b}-${String(i).padStart(4, '0')}`, type: 'MEMORY_ADD', payload: { memoryId: `mem-mc-${b}-${i}x`, text: `MC 回憶 ${b}-${i}` } })));
    await app.sync.sync();
    expect(app.notes).toEqual(['養了一隻狗']); // 本機記憶沒被動到
    expect(app.shared.length).toBe(20); // Minecraft 的只留最新 20 條（Hub 依來源分額）
    s = await hubState();
    expect(s.memories.filter((m: { src: string }) => m.src === 'fp').map((m: { text: string }) => m.text)).toEqual(['養了一隻狗']);
  });

  it('改名 Minecraft 也看得到；Minecraft 不能改名', async () => {
    const hub = await startHub();
    hubUrl.current = hub.url;
    const app = makeApp(memoryKV(), synthPet());
    await app.sync.sync();
    await linkMc();
    app.sync.recordRename('露露');
    expect((await app.sync.sync()).status).toBe('ok');
    expect((await mcCall('GET', `/api/allay/state?pet=${PET}`)).json.profile.name).toBe('露露');
    const r = await mcEvents([{ opId: 'mc-rename-001', type: 'RENAME', payload: { name: '偷改' } }]);
    expect(r.status).toBe(403);
  });

  it('本機同步資料損壞：重建（只會少送、不會重複送），不影響 App 存檔', async () => {
    const hub = await startHub();
    hubUrl.current = hub.url;
    const kv = memoryKV();
    kv.setItem('fairypocket.save.v1', '{"keep":true}');
    kv.setItem(SYNC_KEY, '{broken');
    const app = makeApp(kv, synthPet());
    expect(app.sync.info()).toMatchObject({ pending: 0, registered: false });
    expect((await app.sync.sync()).status).toBe('ok');
    expect(kv.getItem('fairypocket.save.v1')).toBe('{"keep":true}');
  });
});
