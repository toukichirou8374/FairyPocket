// Fairy Hub：資料格式與驗證（FairyPocket v0.49.2 的真實 PetState 尺度、玩家身分、事件）
// 規則與數字對照 src/game/state.ts；改 FairyPocket 的數值規則時要一起改這裡（test/schema.test.mjs 會檢查對照）。

import { createHash } from 'node:crypto';

export const HUB_SCHEMA = 1;
export const POCKET_STATE_VERSION = 1;

// ---------- FairyPocket v0.49.2 的常數（src/game/state.ts） ----------
export const LIMITS = { health: [1, 20], hunger: [0, 20], energy: [0, 100], affection: [0, 100], mood: [0, 100] };
export const NAME_MAX = 12;
export const PERSONALITIES = ['guardian', 'brave', 'cautious', 'playful'];
export const POCKET_ID_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
export const MC_PET_RE = /^mc_[a-f0-9]{20}$/;
export const FOODS = {
  apple: [4, 2], bread: [5, 1], cookie: [2, 1], carrot: [3, 1], baked_potato: [5, 1], sweet_berries: [2, 1],
  glow_berries: [2, 1], melon_slice: [2, 1], cooked_chicken: [6, 2], pumpkin_pie: [8, 2], honey_bottle: [6, 2],
  golden_carrot: [6, 4], golden_apple: [4, 10], cooked_beef: [8, 3], cooked_porkchop: [8, 3], cooked_mutton: [6, 2],
  cooked_cod: [5, 2], cooked_salmon: [6, 2], cooked_rabbit: [5, 2], mushroom_stew: [6, 2], rabbit_stew: [10, 3],
  beetroot_soup: [6, 2], dried_kelp: [1, 1], cake: [2, 1],
};
export const FAVORITE_FOOD = { guardian: 'bread', brave: 'cooked_chicken', cautious: 'honey_bottle', playful: 'cookie' };
export const SLEEPINESS = { guardian: 1, brave: 0.85, cautious: 1.3, playful: 1.1 };

// ---------- 小工具 ----------
export class HubError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const fail = (status, code, extra) => {
  throw new HubError(status, code, extra);
};
export const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 只允許指定的欄位；多的欄位一律拒絕 */
export function onlyKeys(obj, allowed, where) {
  if (!isObj(obj)) fail(400, 'SCHEMA', { where });
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(400, 'SCHEMA', { where, field: k });
}
export function text(v, max, where) {
  if (typeof v !== 'string') fail(400, 'SCHEMA', { where });
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s || [...s].length > max) fail(400, 'SCHEMA', { where });
  return s;
}
export function optText(v, max, where) {
  if (v === undefined || v === '') return '';
  return text(v, max, where);
}
export function range(v, lim, where) {
  if (!isNum(v) || v < lim[0] || v > lim[1]) fail(400, 'SCHEMA', { where });
  return v;
}

/** 物件轉成固定順序的字串（算雜湊用：同內容一定同結果） */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

// ---------- FairyPocket 的 PetState（註冊時用） ----------
const POCKET_KEYS = ['version', 'id', 'name', 'personality', 'health', 'hunger', 'energy', 'affection', 'mood', 'asleep', 'onboarded', 'createdAt', 'lastSeen', 'stats', 'memory'];
const MEMORY_KEYS = ['foods', 'lastFood', 'lastFoodAt', 'lastPlayAt', 'lastDanceAt', 'lastDay', 'streak', 'days', 'told'];

/** 嚴格驗證 FairyPocket v0.49.2 的 PetState（版本、欄位、範圍）；不合格丟出 400 SCHEMA */
export function validatePocketState(p) {
  onlyKeys(p, POCKET_KEYS, 'petState');
  if (p.version !== POCKET_STATE_VERSION) fail(400, 'SCHEMA', { where: 'petState.version' });
  if (typeof p.id !== 'string' || !POCKET_ID_RE.test(p.id)) fail(400, 'SCHEMA', { where: 'petState.id' });
  const name = text(p.name, NAME_MAX, 'petState.name');
  if (!PERSONALITIES.includes(p.personality)) fail(400, 'SCHEMA', { where: 'petState.personality' });
  for (const k of Object.keys(LIMITS)) range(p[k], LIMITS[k], `petState.${k}`);
  for (const k of ['asleep', 'onboarded']) if (typeof p[k] !== 'boolean') fail(400, 'SCHEMA', { where: `petState.${k}` });
  for (const k of ['createdAt', 'lastSeen']) range(p[k], [0, Number.MAX_SAFE_INTEGER], `petState.${k}`);
  onlyKeys(p.stats, ['fed', 'petted', 'played'], 'petState.stats');
  for (const k of ['fed', 'petted', 'played']) range(p.stats[k], [0, 1e9], `petState.stats.${k}`);
  onlyKeys(p.memory, MEMORY_KEYS, 'petState.memory');
  const m = p.memory;
  range(m.streak, [0, 1e6], 'petState.memory.streak');
  range(m.days, [0, 1e6], 'petState.memory.days');
  if (typeof m.lastDay !== 'string' || (m.lastDay && !/^\d{4}-\d{2}-\d{2}$/.test(m.lastDay))) fail(400, 'SCHEMA', { where: 'petState.memory.lastDay' });
  return {
    profile: { name, personality: p.personality },
    state: { health: p.health, hunger: p.hunger, energy: p.energy, affection: p.affection, mood: p.mood, asleep: p.asleep },
    stats: { fed: p.stats.fed, petted: p.stats.petted, played: p.stats.played },
    days: { total: m.days, streak: m.streak, lastSeen: m.lastDay },
  };
}

// ---------- 玩家身分（Java／Floodgate） ----------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Floodgate 的對應規則：UUID 前 64 位元是 0，後 64 位元是 XUID */
export function floodgateUuidFor(xuid) {
  const hex = BigInt(xuid).toString(16).padStart(16, '0');
  return `00000000-0000-0000-${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/**
 * 驗證 Paper 送來的行動者身分，回傳 { key, platform, id, name }。
 * Java：標準 UUID、版本 4（正版驗證）；離線模式的版本 3 拒絕。
 * 基岩版：XUID（1–20 位數字）＋與之相符的 Floodgate UUID。
 */
export function parseActor(actor, floodgateUuid, name) {
  if (typeof actor !== 'string') fail(400, 'SCHEMA', { where: 'actor' });
  const m = /^(java|bedrock):(.+)$/.exec(actor.trim());
  if (!m) fail(400, 'SCHEMA', { where: 'actor' });
  const [, platform, raw] = m;
  const display = typeof name === 'string' ? name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 32) : '';
  if (platform === 'java') {
    const id = raw.toLowerCase();
    if (!UUID_RE.test(id) || id[14] !== '4') fail(400, 'SCHEMA', { where: 'actor.java' });
    if (id.startsWith('00000000-0000-0000-')) fail(400, 'SCHEMA', { where: 'actor.java' });
    return { key: `java:${id}`, platform, id, name: display };
  }
  if (!/^[0-9]{1,20}$/.test(raw) || BigInt(raw) === 0n || BigInt(raw) > 0xffffffffffffffffn) fail(400, 'SCHEMA', { where: 'actor.bedrock' });
  const xuid = BigInt(raw).toString();
  if (typeof floodgateUuid !== 'string' || floodgateUuid.toLowerCase() !== floodgateUuidFor(xuid)) fail(400, 'SCHEMA', { where: 'actor.floodgate' });
  return { key: `bedrock:${xuid}`, platform, id: xuid, name: display };
}

export const mcPetId = (actorKey) => `mc_${sha256(`fairy-hub-mc-pet|${actorKey}`).slice(0, 20)}`;

// ---------- 事件 ----------
export const OP_ID_RE = /^[A-Za-z0-9_.-]{8,80}$/;
export const SOURCE_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const NUMERIC_TYPES = ['FED', 'PETTED', 'PLAYED', 'TIME_PASSED', 'GIFT', 'FOUND', 'DEFEATED', 'HURT', 'DIED', 'VITALS_SYNC'];
export const PLAIN_TYPES = ['MEMORY_ADD', 'MEMORY_REMOVE', 'DIALOGUE_ADD', 'ADVENTURE'];
const ROLE_TYPES = {
  fp: ['FED', 'PETTED', 'PLAYED', 'VITALS_SYNC', 'MEMORY_ADD', 'MEMORY_REMOVE', 'DIALOGUE_ADD'],
  mc: ['FED', 'PETTED', 'PLAYED', 'TIME_PASSED', 'GIFT', 'FOUND', 'DEFEATED', 'HURT', 'DIED', 'MEMORY_ADD', 'MEMORY_REMOVE', 'DIALOGUE_ADD', 'ADVENTURE'],
};
const ADVENTURE_KINDS = ['dimension', 'biome', 'structure', 'achievement', 'sleep', 'wake'];
const ITEM_RE = /^[a-z0-9_:.-]{1,64}$/;

/** 驗證一筆事件，回傳整理過的 {opId, type, at, payload}；角色不能送的種類回 403 */
export function validateEvent(e, role) {
  onlyKeys(e, ['opId', 'type', 'at', 'payload'], 'event');
  if (typeof e.opId !== 'string' || !OP_ID_RE.test(e.opId)) fail(400, 'SCHEMA', { where: 'event.opId' });
  if (!NUMERIC_TYPES.includes(e.type) && !PLAIN_TYPES.includes(e.type)) fail(400, 'SCHEMA', { where: 'event.type' });
  if (!ROLE_TYPES[role].includes(e.type)) fail(403, 'FORBIDDEN', { where: 'event.type', type: e.type });
  const at = e.at === undefined ? 0 : range(e.at, [0, Number.MAX_SAFE_INTEGER], 'event.at');
  const p = e.payload ?? {};
  const item = (v, w) => {
    if (typeof v !== 'string' || !ITEM_RE.test(v)) fail(400, 'SCHEMA', { where: w });
    return v.replace(/^minecraft:/, '');
  };
  let payload;
  switch (e.type) {
    case 'FED':
      onlyKeys(p, ['food'], 'payload');
      payload = { food: item(p.food, 'payload.food') };
      break;
    case 'PETTED':
    case 'PLAYED':
    case 'HURT':
    case 'DIED':
      onlyKeys(p, [], 'payload');
      payload = {};
      break;
    case 'TIME_PASSED':
      onlyKeys(p, ['seconds', 'night'], 'payload');
      payload = { seconds: range(p.seconds, [0, 600], 'payload.seconds'), night: p.night === true };
      break;
    case 'GIFT':
    case 'FOUND':
      onlyKeys(p, ['item'], 'payload');
      payload = { item: item(p.item, 'payload.item') };
      break;
    case 'DEFEATED':
      onlyKeys(p, ['mob'], 'payload');
      payload = { mob: item(p.mob, 'payload.mob') };
      break;
    case 'VITALS_SYNC':
      onlyKeys(p, ['health', 'hunger', 'energy', 'mood', 'affection', 'asleep'], 'payload');
      payload = {};
      for (const k of ['health', 'hunger', 'energy', 'mood', 'affection']) payload[k] = range(p[k], LIMITS[k], `payload.${k}`);
      if (typeof p.asleep !== 'boolean') fail(400, 'SCHEMA', { where: 'payload.asleep' });
      payload.asleep = p.asleep;
      break;
    case 'MEMORY_ADD':
      onlyKeys(p, ['memoryId', 'text', 'visibility'], 'payload');
      if (typeof p.memoryId !== 'string' || !OP_ID_RE.test(p.memoryId)) fail(400, 'SCHEMA', { where: 'payload.memoryId' });
      if (p.visibility !== undefined && p.visibility !== 'private' && p.visibility !== 'shared') fail(400, 'SCHEMA', { where: 'payload.visibility' });
      payload = { memoryId: p.memoryId, text: text(p.text, 60, 'payload.text'), visibility: role === 'mc' ? 'shared' : (p.visibility ?? 'private') };
      break;
    case 'MEMORY_REMOVE':
      onlyKeys(p, ['memoryId'], 'payload');
      if (typeof p.memoryId !== 'string' || !OP_ID_RE.test(p.memoryId)) fail(400, 'SCHEMA', { where: 'payload.memoryId' });
      payload = { memoryId: p.memoryId };
      break;
    case 'DIALOGUE_ADD':
      onlyKeys(p, ['messageId', 'who', 'name', 'text'], 'payload');
      if (typeof p.messageId !== 'string' || !OP_ID_RE.test(p.messageId)) fail(400, 'SCHEMA', { where: 'payload.messageId' });
      if (p.who !== 'user' && p.who !== 'allay') fail(400, 'SCHEMA', { where: 'payload.who' });
      payload = { messageId: p.messageId, who: p.who, name: optText(p.name, 32, 'payload.name'), text: text(p.text, 200, 'payload.text') };
      break;
    case 'ADVENTURE':
      onlyKeys(p, ['kind', 'detail', 'place', 'with'], 'payload');
      if (!ADVENTURE_KINDS.includes(p.kind)) fail(400, 'SCHEMA', { where: 'payload.kind' });
      payload = { kind: p.kind, detail: optText(p.detail, 60, 'payload.detail'), place: optText(p.place, 40, 'payload.place'), with: optText(p.with, 32, 'payload.with') };
      break;
  }
  return { opId: e.opId, type: e.type, at, payload };
}
