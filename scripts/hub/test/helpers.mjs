// 測試共用：在暫存資料夾啟動「轉接服務＋Hub」，全部用合成玩家與測試資料（不連 Ollama、不連雲端、不碰正式資料）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRelay } from '../../ai-proxy.mjs';
import { createHub } from '../hub.mjs';
import { floodgateUuidFor } from '../schema.mjs';

export const FP_TOKEN = 'test-fp-token-aaaa';
export const MC_TOKEN = 'test-mc-token-bbbb';
export const FP_SOURCE = 'pocket-device-01';
export const MC_SOURCE = 'paper-server-01';

// 合成玩家（不是真實帳號）
export const JAVA_A = { actor: 'java:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b', name: 'TestSteve' };
export const JAVA_B = { actor: 'java:9a8b7c6d-1e2f-4a3b-9c4d-5e6f7a8b9c0d', name: 'TestAlex' };
export const BEDROCK_C = { actor: 'bedrock:2535412345678901', floodgateUuid: floodgateUuidFor('2535412345678901'), name: '.TestKid' };

/** FairyPocket v0.49.2 格式的合成 PetState */
export function pocketState(over = {}) {
  return {
    version: 1, id: 'TEST-0001', name: '測試悅靈', personality: 'playful',
    health: 20, hunger: 16, energy: 90, affection: 10, mood: 70, asleep: false, onboarded: true,
    createdAt: 1793800000000, lastSeen: 1793800000000,
    stats: { fed: 0, petted: 0, played: 0 },
    memory: { foods: {}, lastFood: null, lastFoodAt: 0, lastPlayAt: 0, lastDanceAt: 0, lastDay: '2026-11-06', streak: 1, days: 1, told: [] },
    ...over,
  };
}

/** 假的本機 AI：記錄收到的 prompt；可以設定延遲、失敗 */
export function fakeAI(opts = {}) {
  const ai = {
    route: opts.route ?? 'LOCAL_OLLAMA',
    calls: [],
    delay: opts.delay ?? 0,
    failNext: false,
    reply: opts.reply ?? '[開心] 好呀，我們一起去探險！',
    async ask(system, messages) {
      ai.calls.push({ system, messages });
      if (ai.delay) await new Promise((r) => setTimeout(r, ai.delay));
      if (ai.failNext) {
        ai.failNext = false;
        throw new Error('fake failure');
      }
      return ai.reply;
    },
  };
  return ai;
}

/** 假的雲端 AI：只用來確認 Minecraft 永遠不會呼叫到 */
export function fakeCloud() {
  const c = {
    calls: 0,
    isOwner: () => true,
    cloudStatus: () => ({ ready: true }),
    async cloudChat() {
      c.calls++;
      return [200, { text: 'cloud reply' }];
    },
  };
  return c;
}

export async function startHub(t, opts = {}) {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fairy-hub-test-'));
  const clock = opts.clock ?? { t: new Date(2026, 10, 6, 12, 0, 0).getTime() };
  const ai = opts.ai ?? fakeAI();
  const cloud = opts.cloud ?? fakeCloud();
  const hub = createHub({ dir, now: () => clock.t, ai, scheduler: opts.scheduler, faults: opts.faults, maxOps: opts.maxOps });
  const server = createRelay({ token: FP_TOKEN, mcToken: MC_TOKEN, hub, cloud, ollama: { host: '127.0.0.1', port: 9 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = () =>
    closed
      ? Promise.resolve()
      : new Promise((r) => {
          closed = true;
          server.closeAllConnections?.();
          server.close(() => r());
        });
  if (!opts.keepDir) t.after(async () => {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  else t.after(close);

  async function call(method, p, body, headers) {
    const res = await fetch(base + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const txt = await res.text();
    let json = null;
    try {
      json = txt ? JSON.parse(txt) : null;
    } catch {
      json = txt;
    }
    return { status: res.status, json };
  }
  const fpHeaders = { authorization: `Bearer ${FP_TOKEN}`, 'x-fairy-source': FP_SOURCE };
  const mcHeaders = (who, source = MC_SOURCE) => ({
    authorization: `Bearer ${MC_TOKEN}`,
    'x-fairy-source': source,
    'x-fairy-actor': who.actor,
    ...(who.floodgateUuid ? { 'x-fairy-floodgate-uuid': who.floodgateUuid } : {}),
    'x-fairy-actor-name': encodeURIComponent(who.name ?? ''),
  });
  return {
    dir, clock, ai, cloud, hub, base, close, call,
    fp: (method, p, body) => call(method, p, body, fpHeaders),
    mc: (who, method, p, body, source) => call(method, p, body, mcHeaders(who, source)),
    /** 關掉再用同一個資料夾重新開（模擬重啟） */
    async restart(more = {}) {
      await close();
      return startHub(t, { ...opts, ...more, dir, clock, ai, cloud, keepDir: true });
    },
  };
}

/** 登記測試悅靈，並完成一位 Minecraft 玩家的綁定 */
export async function registerAndLink(h, who = JAVA_A, pet = 'TEST-0001') {
  const reg = await h.fp('POST', '/api/allay/pet/register', { petState: pocketState({ id: pet }) });
  if (reg.status !== 201) throw new Error(`register ${reg.status} ${JSON.stringify(reg.json)}`);
  const { json: c } = await h.fp('POST', '/api/allay/link/create', { pet });
  const claim = await h.mc(who, 'POST', '/api/allay/link/claim', { code: c.code });
  const conf = await h.fp('POST', '/api/allay/link/confirm', { linkId: claim.json.linkId, accept: true });
  if (conf.status !== 200) throw new Error(`confirm ${conf.status}`);
  return pet;
}

export const ev = (opId, type, payload = {}, at = 0) => ({ opId, type, at, payload });
