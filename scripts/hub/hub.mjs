// Fairy Hub v1（H2）：HTTP API。由本機轉接服務（scripts/ai-proxy.mjs）依憑證判定角色後呼叫 handle()。
// 契約：docs/hub/CONTRACT.md。所有寫入都是事件；處理順序：權限 → 去重 → epoch → revision → 規則。
// 一個請求從讀文件到寫入之間沒有 await（Node 單執行緒），所以每次寫入對同一份文件是原子的。

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkRoute, ruleLine, Scheduler } from './localai.mjs';
import { applyEvent } from './rules.mjs';
import {
  canonical, fail, HubError, LIMITS, mcPetId, MC_PET_RE, NUMERIC_TYPES, onlyKeys, optText, parseActor,
  PERSONALITIES, POCKET_ID_RE, range, sha256, SOURCE_RE, text, validateEvent, validatePocketState, OP_ID_RE,
} from './schema.mjs';
import { backupFromStores, Store } from './store.mjs';

const MAX_BODY = 64 * 1024;
const OP_DAYS = 30;
const MAX_OPS = 20_000;
const CODE_MS = 10 * 60_000;
const PENDING_MS = 10 * 60_000;
const LOCK = { window: 10 * 60_000, max: 5, lockMs: 15 * 60_000 };
const INTENT_MS = 30_000;
export const SOUND_POLICY = 'MINECRAFT_PRESERVE_EXISTING_SYNTHETIC';
export const TEXT_POLICY = 'APPROVED_TEXT_ONLY';
const PERSONA = {
  guardian: '溫柔沉穩，總是守在主人身邊照顧大家',
  brave: '勇敢活潑，喜歡飛在前面探路，遇到怪物會替大家加油',
  cautious: '有點膽小但很細心，遇到危險會躲到主人身後，提醒大家小心',
  playful: '愛玩好奇，喜歡到處繞圈、撿東西、找新奇的事',
};
const LANG_RULE = {
  zh_tw: '請只用台灣的繁體中文和台灣用語回答。',
  ja_jp: '必ず自然でやさしい日本語だけで答えてください。中国語はまぜないでください。',
  en_us: 'Answer only in simple, friendly English.',
};
const FEELINGS = { 開心: 'happy', 難過: 'sad', 驚訝: 'surprised', 害羞: 'shy', 想睡: 'sleepy', happy: 'happy', sad: 'sad', surprised: 'surprised', shy: 'shy', sleepy: 'sleepy' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HubError(413, 'TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HubError(400, 'SCHEMA', { where: 'json' }));
      }
    });
    req.on('error', () => reject(new HubError(400, 'SCHEMA', { where: 'body' })));
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** 錯誤回應只帶安全的資訊（不在拒絕存取時洩漏 revision） */
function sendError(res, e) {
  if (!(e instanceof HubError)) {
    send(res, 500, { error: 'INTERNAL' });
    return;
  }
  const safe = {};
  for (const k of ['rev', 'epoch', 'where', 'field', 'type', 'results', 'registration']) if (e.extra?.[k] !== undefined) safe[k] = e.extra[k];
  send(res, e.status, { error: e.code, ...safe });
}

/** 比對兩個十六進位雜湊（固定時間） */
function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** 資料夾不存在，或裡面（含所有子資料夾）沒有任何檔案 */
function isFreshDir(dir) {
  if (!fs.existsSync(dir)) return true;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).every((e) => e.isDirectory() && walk(path.join(d, e.name)));
  return walk(dir);
}

export function createHub(opts = {}) {
  const dir = opts.dir ?? path.resolve(import.meta.dirname, '..', '..', 'private', 'allay-hub');
  const now = opts.now ?? (() => Date.now());
  // H2.3：在建立 Store「之前」判斷是不是完全全新的資料夾（Store 啟動時會把暫存檔移到 quarantine，
  // 先判斷才不會把「只剩暫存檔」誤認成全新）。全新＝資料夾不存在，或裡面（含子資料夾）沒有任何檔案。
  const fresh = isFreshDir(dir);
  const pets = new Store(path.join(dir, 'pets'), { faults: opts.faults, now });
  const global = new Store(dir, { faults: opts.faults, now });
  /** 進行中的聊天（同一個 opId 並行送達時共用同一次推論） */
  const inflight = new Map();
  const adapter = opts.ai ?? { route: 'RULES', ask: async () => '' };
  checkRoute(adapter.route);
  const scheduler = new Scheduler(adapter, opts.scheduler);
  // 只有完全全新的資料夾才建立空的 hub.json。既有悅靈、暫存檔、前一版、復原殘留、損壞證據都不算全新。
  // 之後「hub.json 不存在」一律代表資料異常（hubDoc() 回 503），不會再有任何路徑重建它。
  if (fresh) global.commit('hub', { codes: {}, linkIndex: {}, locks: {} });
  /** hub.json 的有效狀態：ok／missing（已初始化卻不見）／broken（損壞）；初始化之後所有路徑都用這個判定 */
  const hubStatus = () => (global.isBroken('hub') ? 'broken' : global.has('hub') ? 'ok' : 'missing');

  // ---------- 文件 ----------
  function hubDoc() {
    // hub.json 損壞或不見：所有綁定相關操作 fail-closed，不回傳可寫入的空結構（不重建索引、不覆寫、不刪證據）
    if (hubStatus() !== 'ok') fail(503, 'STORE_UNAVAILABLE');
    return { codes: {}, linkIndex: {}, locks: {}, ...global.get('hub') };
  }
  function loadPet(pet) {
    if (typeof pet !== 'string' || !(POCKET_ID_RE.test(pet) || MC_PET_RE.test(pet))) fail(400, 'SCHEMA', { where: 'pet' });
    if (pets.isBroken(pet)) fail(503, 'STORE_UNAVAILABLE');
    const d = pets.get(pet);
    if (!d) fail(404, 'NOT_FOUND');
    return d;
  }
  function newDoc(pet, kind, owner, init, controller) {
    return {
      pet, kind, owner, createdAt: now(), rev: 1, epoch: 1, controller,
      profile: init.profile, state: init.state, stats: init.stats, days: init.days,
      memories: [], dialogue: [], adventures: [], links: [], pendingLinks: {}, ops: {}, intents: {}, daily: null,
      // H2.2：授權版本（綁定生效、撤銷都 +1，只增不減）。還原時用來判斷快照的授權是不是比較舊
      authVersion: 0,
    };
  }

  // ---------- 身分與權限 ----------
  function source(req) {
    const s = req.headers['x-fairy-source'];
    if (typeof s !== 'string' || !SOURCE_RE.test(s)) fail(400, 'SCHEMA', { where: 'source' });
    return s;
  }
  function actorOf(req) {
    return parseActor(req.headers['x-fairy-actor'], req.headers['x-fairy-floodgate-uuid'], decodeName(req.headers['x-fairy-actor-name']));
  }
  function decodeName(v) {
    if (typeof v !== 'string') return '';
    try {
      return decodeURIComponent(v);
    } catch {
      return '';
    }
  }
  function canAccess(doc, ctx) {
    if (ctx.role === 'fp') return doc.kind === 'pocket';
    return doc.owner === ctx.actor.key || doc.links.some((l) => l.key === ctx.actor.key && l.status === 'active');
  }
  function access(doc, ctx) {
    if (!canAccess(doc, ctx)) fail(403, 'FORBIDDEN');
  }
  const isController = (doc, ctx) =>
    !!doc.controller && doc.controller.role === ctx.role && doc.controller.source === ctx.source && (ctx.role !== 'mc' || doc.controller.actor === ctx.actor.key);

  // ---------- 去重 ----------
  function pruneOps(doc) {
    const since = now() - OP_DAYS * 86_400_000;
    for (const [k, v] of Object.entries(doc.ops)) if (v.at < since) delete doc.ops[k];
  }
  /** 回傳已存在的操作（同內容），或 null；不同內容丟出 409 ID_COLLISION */
  function seen(doc, key, hash) {
    const op = doc.ops[key];
    if (!op) return null;
    if (op.hash !== hash) fail(409, 'ID_COLLISION');
    return op;
  }
  function room(doc, n) {
    pruneOps(doc);
    if (Object.keys(doc.ops).length + n > (opts.maxOps ?? MAX_OPS)) fail(507, 'CAPACITY_REJECTED');
  }
  const opKey = (ctx, opId) => `${ctx.role}|${ctx.source}|${opId}`;
  function needOpId(v) {
    if (typeof v !== 'string' || !OP_ID_RE.test(v)) fail(400, 'SCHEMA', { where: 'opId' });
    return v;
  }
  function needInt(v, where) {
    if (!Number.isInteger(v) || v < 0) fail(400, 'SCHEMA', { where });
    return v;
  }

  // ---------- 讀取的樣子 ----------
  const round = (v) => Math.round(v * 10) / 10;
  function view(doc, role) {
    const base = { pet: doc.pet, kind: doc.kind, rev: doc.rev, epoch: doc.epoch, profile: doc.profile, stats: doc.stats, days: doc.days };
    if (role === 'fp')
      return {
        ...base, state: doc.state, controller: doc.controller, lastController: doc.lastController ?? null,
        memories: doc.memories.map(({ memoryId, text, visibility, srcRole, at }) => ({ memoryId, text, visibility, src: srcRole, at })),
        dialogue: doc.dialogue.map(({ messageId, who, name, text, srcRole, at }) => ({ messageId, who, name, text, src: srcRole, at })),
        links: doc.links.map(({ key, platform, name, status, at }) => ({ key, platform, name, status, at })),
      };
    // Minecraft：公開狀態；手機的私人記憶與手機上的對話不回傳
    return {
      ...base,
      state: Object.fromEntries(Object.entries(doc.state).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])),
      controller: doc.controller ? { role: doc.controller.role } : null,
      memories: doc.memories.filter((m) => m.visibility === 'shared').map(({ memoryId, text, at }) => ({ memoryId, text, at })),
      dialogue: doc.dialogue.filter((d) => d.srcRole === 'mc').map(({ messageId, who, name, text, at }) => ({ messageId, who, name, text, at })),
    };
  }

  // ---------- 路徑 ----------
  const routes = {
    // FairyPocket 把現有的悅靈登記到 Hub（只建立，不覆寫）
    'POST /api/allay/pet/register': {
      roles: ['fp'],
      async run(ctx, body) {
        onlyKeys(body, ['petState', 'registration'], 'body');
        // H3-1.2：登記識別碼（裝置產生、隨機、只用來確認「同一次登記的重試」，不是裝置身分認證）
        let regId = null;
        if (body.registration !== undefined) {
          onlyKeys(body.registration, ['regId'], 'registration');
          if (typeof body.registration.regId !== 'string' || !/^reg-[a-f0-9]{32}$/.test(body.registration.regId)) fail(400, 'SCHEMA', { where: 'registration.regId' });
          regId = body.registration.regId;
        }
        const init = validatePocketState(body.petState);
        const pet = body.petState.id;
        // 損壞的文件：維持 H2.1 的行為（409 EXISTS，不能當成首次建立），登記來源無法確認
        if (pets.isBroken(pet)) fail(409, 'EXISTS', { registration: 'unknown' });
        const existing = pets.get(pet);
        if (existing) {
          // 已存在：只有 Hub 保存的登記紀錄（來源 ID＋識別碼雜湊）與這次完全相同，才承認是同一次登記的重試
          const rec = existing.registration;
          if (regId && rec && rec.source === ctx.source && sameHash(rec.regIdHash, sha256(`reg|${regId}`))) return [200, { status: 'DUPLICATE', ...view(existing, 'fp') }];
          // other：有紀錄但不是這次登記；unknown：舊資料沒有可靠的登記紀錄（不推測）
          fail(409, 'EXISTS', { registration: rec ? 'other' : 'unknown' });
        }
        const doc = newDoc(pet, 'pocket', 'pocket', init, { role: 'fp', source: ctx.source, actor: null, since: now() });
        // 只存雜湊，與悅靈文件同一個交易寫入（跟著耐久儲存與備份走）
        if (regId) doc.registration = { source: ctx.source, regIdHash: sha256(`reg|${regId}`), at: now() };
        pets.commit(pet, doc);
        return [201, view(doc, 'fp')];
      },
    },

    'GET /api/allay/state': {
      roles: ['fp', 'mc'],
      async run(ctx, _b, q) {
        const doc = loadPet(q.get('pet'));
        access(doc, ctx);
        return [200, view(doc, ctx.role)];
      },
    },

    'GET /api/allay/adventures': {
      roles: ['fp'],
      async run(ctx, _b, q) {
        const doc = loadPet(q.get('pet'));
        access(doc, ctx);
        const since = Number(q.get('since') ?? 0) || 0;
        return [200, { rev: doc.rev, adventures: doc.adventures.filter((a) => a.rev > since) }];
      },
    },

    'POST /api/allay/events': {
      roles: ['fp', 'mc'],
      async run(ctx, body) {
        onlyKeys(body, ['pet', 'baseRevision', 'epoch', 'events'], 'body');
        const doc = loadPet(body.pet);
        access(doc, ctx);
        if (!Array.isArray(body.events) || !body.events.length || body.events.length > 50) fail(400, 'SCHEMA', { where: 'events' });
        const list = body.events.map((e) => validateEvent(e, ctx.role));
        const results = [];
        const fresh = [];
        const batchIds = new Set();
        for (const ev of list) {
          const hash = sha256(canonical({ type: ev.type, at: ev.at, payload: ev.payload }));
          const key = opKey(ctx, ev.opId);
          if (batchIds.has(key)) fail(400, 'SCHEMA', { where: 'events.duplicateOpId' });
          batchIds.add(key);
          const op = seen(doc, key, hash);
          if (op) results.push({ opId: ev.opId, status: 'DUPLICATE', rev: op.rev, result: op.result });
          else fresh.push({ ev, key, hash });
        }
        if (!fresh.length) return [200, { rev: doc.rev, epoch: doc.epoch, results }];
        if (needInt(body.epoch, 'epoch') !== doc.epoch) fail(409, 'STALE_EPOCH', { epoch: doc.epoch });
        if (needInt(body.baseRevision, 'baseRevision') !== doc.rev) fail(409, 'REVISION_CONFLICT', { rev: doc.rev });
        if (fresh.some((f) => NUMERIC_TYPES.includes(f.ev.type)) && !isController(doc, ctx)) fail(409, 'NOT_CONTROLLER', { epoch: doc.epoch });
        room(doc, fresh.length);
        for (const { ev, key, hash } of fresh) {
          doc.rev++;
          const result = applyEvent(doc, { ...ev, role: ctx.role, source: ctx.source, now: now() });
          doc.ops[key] = { hash, rev: doc.rev, result, at: now() };
          results.push({ opId: ev.opId, status: 'APPLIED', rev: doc.rev, result });
        }
        pets.commit(doc.pet, doc);
        return [200, { rev: doc.rev, epoch: doc.epoch, results }];
      },
    },

    'POST /api/allay/control/claim': {
      roles: ['fp', 'mc'],
      async run(ctx, body) {
        onlyKeys(body, ['pet', 'baseRevision', 'opId'], 'body');
        const doc = loadPet(body.pet);
        access(doc, ctx);
        const key = opKey(ctx, needOpId(body.opId));
        const op = seen(doc, key, sha256(canonical({ claim: body.pet })));
        if (op) return [200, { status: 'DUPLICATE', ...op.result }];
        if (needInt(body.baseRevision, 'baseRevision') !== doc.rev) fail(409, 'REVISION_CONFLICT', { rev: doc.rev });
        room(doc, 1);
        doc.epoch++;
        doc.rev++;
        // H3-1：記下上一個控制者的角色（手機接回控制權時，用來判斷要不要採用 Minecraft 期間的數值）
        if (doc.controller) doc.lastController = { role: doc.controller.role, at: now() };
        doc.controller = { role: ctx.role, source: ctx.source, actor: ctx.actor?.key ?? null, since: now() };
        const result = { epoch: doc.epoch, rev: doc.rev };
        doc.ops[key] = { hash: sha256(canonical({ claim: body.pet })), rev: doc.rev, result, at: now() };
        pets.commit(doc.pet, doc);
        return [200, { status: 'APPLIED', ...result }];
      },
    },

    'POST /api/allay/control/release': {
      roles: ['fp', 'mc'],
      async run(ctx, body) {
        onlyKeys(body, ['pet', 'epoch', 'opId'], 'body');
        const doc = loadPet(body.pet);
        access(doc, ctx);
        const key = opKey(ctx, needOpId(body.opId));
        const hash = sha256(canonical({ release: body.pet, epoch: body.epoch }));
        const op = seen(doc, key, hash);
        if (op) return [200, { status: 'DUPLICATE', ...op.result }];
        if (needInt(body.epoch, 'epoch') !== doc.epoch) fail(409, 'STALE_EPOCH', { epoch: doc.epoch });
        if (!isController(doc, ctx)) fail(409, 'NOT_CONTROLLER', { epoch: doc.epoch });
        room(doc, 1);
        doc.epoch++;
        doc.rev++;
        if (doc.controller) doc.lastController = { role: doc.controller.role, at: now() };
        doc.controller = null;
        const result = { epoch: doc.epoch, rev: doc.rev };
        doc.ops[key] = { hash, rev: doc.rev, result, at: now() };
        pets.commit(doc.pet, doc);
        return [200, { status: 'APPLIED', ...result }];
      },
    },

    // Minecraft：這位玩家可以用的悅靈（授權只看悅靈文件本身，不依賴另一份索引）
    'GET /api/allay/whoami': {
      roles: ['mc'],
      async run(ctx) {
        const list = [];
        const own = mcPetId(ctx.actor.key);
        if (pets.has(own)) list.push({ pet: own, kind: 'mc' });
        for (const pet of pets.names()) {
          const d = pets.get(pet);
          if (d.kind === 'pocket' && canAccess(d, ctx)) list.push({ pet, kind: 'pocket' });
        }
        return [200, { actor: ctx.actor.key, pets: list }];
      },
    },

    // Minecraft：取得或建立這位玩家的專用悅靈（同一個身分永遠同一隻）
    'POST /api/allay/mc/pet': {
      roles: ['mc'],
      async run(ctx, body) {
        onlyKeys(body, ['name', 'personality'], 'body');
        const pet = mcPetId(ctx.actor.key);
        if (pets.isBroken(pet)) fail(503, 'STORE_UNAVAILABLE');
        const existing = pets.get(pet);
        if (existing) return [200, view(existing, 'mc')];
        const name = body.name === undefined ? '悅靈' : text(body.name, 12, 'name');
        const personality = body.personality ?? 'guardian';
        if (!PERSONALITIES.includes(personality)) fail(400, 'SCHEMA', { where: 'personality' });
        const init = {
          profile: { name, personality },
          state: { health: LIMITS.health[1], hunger: 16, energy: 90, affection: 10, mood: 70, asleep: false },
          stats: { fed: 0, petted: 0, played: 0 },
          days: { total: 0, streak: 0, lastSeen: '' },
        };
        const doc = newDoc(pet, 'mc', ctx.actor.key, init, { role: 'mc', source: ctx.source, actor: ctx.actor.key, since: now() });
        pets.commit(pet, doc);
        return [201, view(doc, 'mc')];
      },
    },

    // ---------- 綁定 ----------
    // H2.1：授權（links）與綁定流程（pendingLinks）都只存在悅靈文件裡，確認與撤銷都是「單一文件、單一交易」。
    // hub.json 只放綁定碼（雜湊）、linkId → 悅靈的查詢表、鎖定狀態；它寫入成功或失敗都不會讓授權生效。
    'POST /api/allay/link/create': {
      roles: ['fp'],
      async run(ctx, body) {
        onlyKeys(body, ['pet'], 'body');
        const doc = loadPet(body.pet);
        access(doc, ctx);
        const h = hubDoc();
        for (const [k, v] of Object.entries(h.codes)) if (v.pet === doc.pet || v.exp < now()) delete h.codes[k];
        let code;
        do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        while (h.codes[sha256(`code|${code}`)]);
        h.codes[sha256(`code|${code}`)] = { pet: doc.pet, exp: now() + CODE_MS };
        global.commit('hub', h);
        return [200, { code, expiresAt: now() + CODE_MS }];
      },
    },

    'POST /api/allay/link/claim': {
      roles: ['mc'],
      async run(ctx, body) {
        onlyKeys(body, ['code'], 'body');
        const h = hubDoc();
        const lock = (h.locks[ctx.source] ??= { fails: [], lockedUntil: 0 });
        if (lock.lockedUntil > now()) fail(429, 'LOCKED');
        const code = typeof body.code === 'string' ? body.code.trim() : '';
        const hash = sha256(`code|${code}`);
        const hit = /^\d{6}$/.test(code) ? h.codes[hash] : undefined;
        if (!hit) {
          lock.fails = lock.fails.filter((t) => t > now() - LOCK.window);
          lock.fails.push(now());
          if (lock.fails.length >= LOCK.max) {
            lock.lockedUntil = now() + LOCK.lockMs;
            lock.fails = [];
          }
          global.commit('hub', h);
          fail(409, 'CODE_INVALID');
        }
        delete h.codes[hash]; // 單次使用：用過就作廢（即使後面失敗也不能再用）
        if (hit.exp < now()) {
          global.commit('hub', h);
          fail(410, 'CODE_EXPIRED');
        }
        const doc = loadPet(hit.pet);
        const linkId = randomBytes(12).toString('hex');
        for (const [k, v] of Object.entries(h.linkIndex)) if (v.at < now() - 86_400_000) delete h.linkIndex[k];
        h.linkIndex[linkId] = { pet: hit.pet, at: now() };
        // 第 1 份：先作廢綁定碼（fail-closed：之後失敗只會讓這次綁定作廢，不會產生授權）
        global.commit('hub', h);
        // 第 2 份：悅靈文件記下待確認（授權仍未生效，要等手機確認）
        doc.pendingLinks ??= {};
        for (const [k, v] of Object.entries(doc.pendingLinks)) if (v.at < now() - 86_400_000) delete doc.pendingLinks[k];
        doc.pendingLinks[linkId] = { actor: { key: ctx.actor.key, platform: ctx.actor.platform, id: ctx.actor.id, name: ctx.actor.name }, exp: now() + PENDING_MS, source: ctx.source, status: 'pending', at: now() };
        pets.commit(doc.pet, doc);
        return [200, { linkId, status: 'pending' }];
      },
    },

    'GET /api/allay/link/pending': {
      roles: ['fp'],
      async run(ctx, _b, q) {
        const doc = loadPet(q.get('pet'));
        access(doc, ctx);
        const list = Object.entries(doc.pendingLinks ?? {})
          .filter(([, p]) => p.status === 'pending' && p.exp >= now())
          .map(([linkId, p]) => ({ linkId, platform: p.actor.platform, name: p.actor.name, idPrefix: p.actor.id.slice(0, 8), expiresAt: p.exp }));
        return [200, { pending: list }];
      },
    },

    'POST /api/allay/link/confirm': {
      roles: ['fp'],
      async run(ctx, body) {
        onlyKeys(body, ['linkId', 'accept'], 'body');
        if (typeof body.linkId !== 'string' || !/^[a-f0-9]{24}$/.test(body.linkId) || typeof body.accept !== 'boolean') fail(400, 'SCHEMA', { where: 'body' });
        const ref = hubDoc().linkIndex[body.linkId];
        if (!ref) fail(404, 'NOT_FOUND');
        const doc = loadPet(ref.pet);
        access(doc, ctx);
        const p = doc.pendingLinks?.[body.linkId];
        if (!p) fail(404, 'NOT_FOUND');
        if (p.status !== 'pending') fail(409, 'ALREADY_DECIDED');
        if (p.exp < now()) {
          p.status = 'expired';
          pets.commit(doc.pet, doc);
          fail(410, 'CODE_EXPIRED');
        }
        p.status = body.accept ? 'active' : 'rejected';
        p.decidedAt = now();
        if (body.accept) {
          doc.links = doc.links.filter((l) => l.key !== p.actor.key);
          doc.links.push({ key: p.actor.key, platform: p.actor.platform, name: p.actor.name, status: 'active', at: now() });
          doc.authVersion = (doc.authVersion ?? 0) + 1;
        }
        // 單一文件、單一交易：寫入失敗就什麼都沒生效
        pets.commit(doc.pet, doc);
        return [200, { status: p.status }];
      },
    },

    'GET /api/allay/link/status': {
      roles: ['mc'],
      async run(ctx, _b, q) {
        const id = q.get('linkId') ?? '';
        const ref = /^[a-f0-9]{24}$/.test(id) ? hubDoc().linkIndex[id] : undefined;
        if (!ref) fail(404, 'NOT_FOUND');
        const doc = loadPet(ref.pet);
        const p = doc.pendingLinks?.[id];
        // 綁定碼已作廢、但悅靈文件沒寫成功：這次綁定失敗，要重新產生綁定碼
        if (!p) return [200, { status: 'failed' }];
        if (p.actor.key !== ctx.actor.key) fail(403, 'FORBIDDEN');
        if (p.status === 'pending') return [200, { status: p.exp < now() ? 'expired' : 'pending' }];
        const active = p.status === 'active' && canAccess(doc, ctx);
        return [200, active ? { status: 'active', pet: doc.pet } : { status: p.status === 'active' ? 'revoked' : p.status }];
      },
    },

    'POST /api/allay/link/revoke': {
      roles: ['fp'],
      async run(ctx, body) {
        onlyKeys(body, ['pet', 'actor'], 'body');
        const doc = loadPet(body.pet);
        access(doc, ctx);
        if (typeof body.actor !== 'string' || !/^(java|bedrock):[0-9a-f-]{1,40}$/.test(body.actor)) fail(400, 'SCHEMA', { where: 'actor' });
        let changed = false;
        for (const l of doc.links) if (l.key === body.actor && l.status === 'active') ((l.status = 'revoked'), (l.at = now()), (changed = true));
        // 被撤銷的身分如果正拿著控制權：換新世代，舊 epoch 立刻失效
        if (doc.controller?.actor === body.actor) {
          if (doc.controller) doc.lastController = { role: doc.controller.role, at: now() };
          doc.controller = null;
          doc.epoch++;
          doc.rev++;
          changed = true;
        }
        // H2.2：撤銷（包括非控制者）一定讓授權版本 +1，還原舊備份時才擋得住
        if (changed) doc.authVersion = (doc.authVersion ?? 0) + 1;
        // 單一文件、單一交易
        if (changed) pets.commit(doc.pet, doc);
        return [200, { revoked: changed, epoch: doc.epoch, authVersion: doc.authVersion ?? 0 }];
      },
    },

    // ---------- Minecraft 聊天（只用本機 AI） ----------
    'POST /api/allay/talk': {
      roles: ['mc'],
      async run(ctx, body) {
        onlyKeys(body, ['pet', 'opId', 'text', 'lang', 'place', 'speaker'], 'body');
        const said = text(body.text, 300, 'text');
        const lang = body.lang ?? 'zh_tw';
        if (!LANG_RULE[lang]) fail(400, 'SCHEMA', { where: 'lang' });
        const place = optText(body.place, 40, 'place');
        let speaker = ctx.actor;
        if (body.speaker !== undefined) {
          onlyKeys(body.speaker, ['actor', 'floodgateUuid', 'name'], 'speaker');
          speaker = parseActor(body.speaker.actor, body.speaker.floodgateUuid, body.speaker.name);
        }
        const key = opKey(ctx, needOpId(body.opId));
        const hash = sha256(canonical({ said, lang, place, speaker: speaker.key }));
        const doc0 = loadPet(body.pet);
        access(doc0, ctx);
        const prior = seen(doc0, key, hash);
        if (prior) return [200, { status: 'DUPLICATE', ...prior.result }];
        // 同一個 opId 並行送達：等正在進行的那一個，不重複推論
        const running = inflight.get(`${body.pet}|${key}`);
        if (running) {
          if (running.hash !== hash) fail(409, 'ID_COLLISION');
          const result = await running.promise;
          return [200, { status: 'DUPLICATE', ...result }];
        }
        const work = (async () => {
          // 推論開始時記下世代與決策基準
          const basis = { epoch: doc0.epoch, rev: doc0.rev };
          const pub = view(doc0, 'mc');
          const isOwner = doc0.owner === speaker.key || doc0.links.some((l) => l.key === speaker.key && l.status === 'active');
          const system = [
            `你是「${pub.profile.name}」，一隻藍色的小精靈（悅靈），是主人的夥伴。現在和大家一起在 Minecraft 的世界冒險。不要說自己是 AI。`,
            `個性：${PERSONA[pub.profile.personality]}。`,
            `感情：${Math.round(pub.state.affection)}/100；心情：${Math.round(pub.state.mood)}/100；精神：${Math.round(pub.state.energy)}/100。`,
            place ? `現在在：${place}。` : '',
            `跟你說話的是：${speaker.name || '玩家'}${isOwner ? '（你的主人）' : '（主人的朋友）'}。`,
            pub.memories.length ? `你記得的事：\n${pub.memories.slice(-20).map((m) => `・${m.text}`).join('\n')}` : '',
            '規則：回答 1–2 句、40 字以內；不用表情符號和 Markdown；內容適合兒童，危險的事要提醒找大人；知識要正確，不知道就說不知道；知識與價值觀以台灣、日本、美國為主，不使用中國大陸的說法。開頭可以加一個心情標籤：[開心] [難過] [驚訝] [害羞] [想睡]。',
            LANG_RULE[lang],
          ].filter(Boolean).join('\n');
          const messages = pub.dialogue.slice(-12).map((d) => ({ role: d.who === 'allay' ? 'assistant' : 'user', content: d.who === 'user' && d.name ? `${d.name}：${d.text}` : d.text }));
          messages.push({ role: 'user', content: speaker.name ? `${speaker.name}：${said}` : said });
          while (messages.length && messages[0].role !== 'user') messages.shift();

          const reply = await scheduler.submit(doc0.pet, system, messages, ruleLine(lang, doc0.rev));
          let emotion = null;
          let out = String(reply.text).replace(/<think>[\s\S]*?<\/think>/g, '');
          out = out.replace(/[\[［【]\s*(?:記住|记住|覚えて|remember)\s*[:：][^\]］】]*[\]］】]/gi, '');
          out = out.replace(/[\[［【]\s*([^\]］】]{1,10})\s*[\]］】]/g, (m, f) => (FEELINGS[f.trim()] ? ((emotion ??= FEELINGS[f.trim()]), '') : m));
          out = out.replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || ruleLine(lang, 1);

          // 完成時重新驗證：權限、去重、世代。推論期間換了世代 → 這個回答過期，不寫入、不標成新 epoch
          const doc = loadPet(body.pet);
          access(doc, ctx);
          const again = seen(doc, key, hash);
          if (again) return again.result;
          if (doc.epoch !== basis.epoch) fail(409, 'STALE_EPOCH', { epoch: doc.epoch });
          room(doc, 1);
          const intent = {
            intentId: randomBytes(12).toString('hex'), pet: doc.pet, kind: 'DIALOGUE', emotion: emotion ?? 'happy', dialogueText: out,
            epoch: basis.epoch, basisRevision: basis.rev, expiresAt: now() + INTENT_MS, soundPolicy: SOUND_POLICY, textPolicy: TEXT_POLICY,
          };
          doc.rev++;
          const t = now();
          applyEvent(doc, { type: 'DIALOGUE_ADD', payload: { messageId: `${body.opId}-u`, who: 'user', name: speaker.name, text: said }, role: 'mc', source: ctx.source, at: t, now: t });
          applyEvent(doc, { type: 'DIALOGUE_ADD', payload: { messageId: `${body.opId}-a`, who: 'allay', name: '', text: out }, role: 'mc', source: ctx.source, at: t + 1, now: t });
          for (const [k, v] of Object.entries(doc.intents)) if (v.expiresAt < t - 3600_000) delete doc.intents[k];
          doc.intents[intent.intentId] = intent;
          const result = { route: reply.route, intent };
          doc.ops[key] = { hash, rev: doc.rev, result, at: t };
          pets.commit(doc.pet, doc);
          return result;
        })();
        const entry = { hash, promise: work };
        inflight.set(`${body.pet}|${key}`, entry);
        try {
          return [200, { status: 'APPLIED', ...(await work) }];
        } finally {
          inflight.delete(`${body.pet}|${key}`);
        }
      },
    },

    'POST /api/allay/intent/receipt': {
      roles: ['mc'],
      async run(ctx, body) {
        onlyKeys(body, ['pet', 'intentId', 'epoch', 'status', 'reason'], 'body');
        const doc = loadPet(body.pet);
        access(doc, ctx);
        if (body.status !== 'APPLIED' && body.status !== 'REJECTED') fail(400, 'SCHEMA', { where: 'status' });
        const reason = optText(body.reason, 80, 'reason');
        const it = typeof body.intentId === 'string' ? doc.intents[body.intentId] : undefined;
        if (!it) fail(404, 'NOT_FOUND');
        if (it.receipt) {
          if (it.receipt.status !== body.status) fail(409, 'ID_COLLISION');
          return [200, { status: 'DUPLICATE', receipt: it.receipt }];
        }
        if (needInt(body.epoch, 'epoch') !== doc.epoch || it.epoch !== doc.epoch) fail(409, 'STALE_EPOCH', { epoch: doc.epoch });
        if (it.expiresAt < now()) fail(409, 'INTENT_EXPIRED');
        it.receipt = { status: body.status, reason, at: now(), source: ctx.source };
        pets.commit(doc.pet, doc);
        return [200, { status: 'RECORDED', receipt: it.receipt }];
      },
    },
  };

  /** 處理一個 /api/allay/… 請求；role 由轉接服務依憑證判定（'fp' 或 'mc'） */
  async function handle(req, res, role) {
    try {
      const url = new URL(req.url ?? '/', 'http://hub.local');
      const r = routes[`${req.method} ${url.pathname}`];
      if (!r) fail(404, 'NOT_FOUND');
      if (!r.roles.includes(role)) fail(403, 'FORBIDDEN');
      const ctx = { role, source: null, actor: null };
      if (role === 'mc') ctx.actor = actorOf(req);
      if (req.method === 'POST') ctx.source = source(req);
      else if (req.headers['x-fairy-source'] !== undefined) ctx.source = source(req);
      const body = req.method === 'POST' ? await readBody(req) : null;
      const [status, out] = await r.run(ctx, body, url.searchParams);
      send(res, status, out);
    } catch (e) {
      sendError(res, e);
    }
  }

  /** 從執行中的快取建立一致的快照（同步完成，是同一個時間點的資料） */
  const backup = (destRoot, o) => backupFromStores([['', global], ['pets/', pets]], destRoot, now(), o);
  return { handle, backup, routes: Object.keys(routes), pets, global, scheduler, report: { pets: pets.report, global: global.report, hub: hubStatus(), fresh } };
}

export const HUB_PATHS = [
  'POST /api/allay/pet/register', 'GET /api/allay/state', 'GET /api/allay/adventures', 'POST /api/allay/events',
  'POST /api/allay/control/claim', 'POST /api/allay/control/release', 'GET /api/allay/whoami', 'POST /api/allay/mc/pet',
  'POST /api/allay/link/create', 'POST /api/allay/link/claim', 'GET /api/allay/link/pending', 'POST /api/allay/link/confirm',
  'GET /api/allay/link/status', 'POST /api/allay/link/revoke', 'POST /api/allay/talk', 'POST /api/allay/intent/receipt',
];
