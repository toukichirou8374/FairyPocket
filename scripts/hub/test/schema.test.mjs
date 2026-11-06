// 資料格式、身分、事件驗證、本機 AI 政策、數值規則（含與 FairyPocket 原碼的對照）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkRoute } from '../localai.mjs';
import { applyEvent, tick } from '../rules.mjs';
import { FAVORITE_FOOD, floodgateUuidFor, FOODS, LIMITS, NAME_MAX, parseActor, SLEEPINESS, validateEvent, validatePocketState } from '../schema.mjs';
import { BEDROCK_C, JAVA_A, pocketState } from './helpers.mjs';

const SRC = fs.readFileSync(path.resolve(import.meta.dirname, '../../../src/game/state.ts'), 'utf8');
const code = (e) => {
  try {
    e();
  } catch (x) {
    return `${x.status} ${x.code}`;
  }
  return 'ok';
};

test('相容性：Hub 的數值常數與 FairyPocket v0.49.2 原碼一致', () => {
  const n = (name) => Number(SRC.match(new RegExp(`export const ${name} = (\\d+)`))[1]);
  assert.equal(LIMITS.health[1], n('MAX_HEALTH'));
  assert.equal(LIMITS.hunger[1], n('MAX_HUNGER'));
  assert.equal(LIMITS.energy[1], n('MAX_ENERGY'));
  assert.equal(LIMITS.affection[1], n('MAX_AFFECTION'));
  assert.equal(LIMITS.mood[1], n('MAX_MOOD'));
  assert.equal(NAME_MAX, n('NAME_MAX'));
  for (const [food, [hunger, health]] of Object.entries(FOODS)) {
    const m = SRC.match(new RegExp(`\\b${food}: \\{ hunger: (\\d+), health: (\\d+)`));
    assert.ok(m, `原碼找不到食物 ${food}`);
    assert.deepEqual([Number(m[1]), Number(m[2])], [hunger, health], food);
  }
  const foodsInSrc = [...SRC.slice(SRC.indexOf('export const FOODS'), SRC.indexOf('} as const', SRC.indexOf('export const FOODS'))).matchAll(/^\s+([a-z_]+): \{ hunger/gm)].map((m) => m[1]);
  assert.deepEqual(foodsInSrc.sort(), Object.keys(FOODS).sort(), '食物清單要一致');
  for (const [p, f] of Object.entries(FAVORITE_FOOD)) assert.match(SRC, new RegExp(`${p}: '${f}'`));
  assert.match(SRC, /cautious' \? 1\.3 : p === 'brave' \? 0\.85 : p === 'playful' \? 1\.1 : 1/);
  assert.deepEqual(SLEEPINESS, { guardian: 1, brave: 0.85, cautious: 1.3, playful: 1.1 });
  assert.match(SRC, /\/\^\[A-Z0-9\]\{4\}-\[A-Z0-9\]\{4\}\$\/|newPetId/);
});

test('PetState：接受 v0.49.2 格式；拒絕版本不符、多的欄位、超出範圍、名字太長、ID 格式錯', () => {
  assert.equal(validatePocketState(pocketState()).profile.name, '測試悅靈');
  assert.equal(code(() => validatePocketState(pocketState({ version: 2 }))), '400 SCHEMA');
  assert.equal(code(() => validatePocketState({ ...pocketState(), extra: 1 })), '400 SCHEMA');
  assert.equal(code(() => validatePocketState(pocketState({ hunger: 21 }))), '400 SCHEMA');
  assert.equal(code(() => validatePocketState(pocketState({ health: 0 }))), '400 SCHEMA');
  assert.equal(code(() => validatePocketState(pocketState({ name: '一二三四五六七八九十一二三' }))), '400 SCHEMA');
  assert.equal(code(() => validatePocketState(pocketState({ id: 'test-1' }))), '400 SCHEMA');
  assert.equal(code(() => validatePocketState(pocketState({ stats: { fed: 1, petted: 1 } }))), '400 SCHEMA');
});

test('身分：Java 只收正版（版本 4）UUID；基岩版要 XUID 與 Floodgate UUID 相符；兩種來源不會撞', () => {
  const a = parseActor(JAVA_A.actor.toUpperCase().replace('JAVA', 'java'), undefined, 'x');
  assert.equal(a.key, JAVA_A.actor);
  assert.equal(code(() => parseActor('java:3f2a1b4c-5d6e-3f70-8a9b-0c1d2e3f4a5b')), '400 SCHEMA', '離線模式（版本 3）');
  assert.equal(code(() => parseActor(`java:${floodgateUuidFor('2535412345678901')}`)), '400 SCHEMA', 'Floodgate 樣式的 UUID 不能冒充 Java');
  assert.equal(code(() => parseActor('java:not-a-uuid')), '400 SCHEMA');
  const b = parseActor(BEDROCK_C.actor, BEDROCK_C.floodgateUuid, BEDROCK_C.name);
  assert.equal(b.key, 'bedrock:2535412345678901');
  assert.equal(code(() => parseActor(BEDROCK_C.actor)), '400 SCHEMA', '少了 Floodgate UUID');
  assert.equal(code(() => parseActor(BEDROCK_C.actor, floodgateUuidFor('2535412345678902'))), '400 SCHEMA', 'Floodgate UUID 不符');
  assert.equal(code(() => parseActor('bedrock:abc', 'x')), '400 SCHEMA');
  assert.equal(code(() => parseActor('steve')), '400 SCHEMA', '只有名字不行');
  assert.notEqual(parseActor('bedrock:1', floodgateUuidFor('1')).key, parseActor('java:00000001-0000-4000-8000-000000000001').key);
  assert.equal(floodgateUuidFor('2535412345678901'), '00000000-0000-0000-0009-01f1b0392c35');
});

test('事件：角色不能送的種類 403；未知欄位、未知種類、超出範圍 400', () => {
  assert.equal(code(() => validateEvent({ opId: 'op-00000001', type: 'VITALS_SYNC', payload: { health: 20, hunger: 20, energy: 100, mood: 100, affection: 100, asleep: false } }, 'mc')), '403 FORBIDDEN');
  assert.equal(code(() => validateEvent({ opId: 'op-00000001', type: 'TIME_PASSED', payload: { seconds: 5 } }, 'fp')), '403 FORBIDDEN');
  assert.equal(code(() => validateEvent({ opId: 'op-00000001', type: 'PETTED', payload: { affection: 99 } }, 'mc')), '400 SCHEMA');
  assert.equal(code(() => validateEvent({ opId: 'op-00000001', type: 'SET_AFFECTION', payload: {} }, 'mc')), '400 SCHEMA');
  assert.equal(code(() => validateEvent({ opId: 'op-00000001', type: 'TIME_PASSED', payload: { seconds: 601 } }, 'mc')), '400 SCHEMA');
  assert.equal(code(() => validateEvent({ opId: 'short', type: 'PETTED' }, 'mc')), '400 SCHEMA');
  assert.equal(code(() => validateEvent({ opId: 'op-00000001', type: 'PETTED', payload: {}, extra: 1 }, 'mc')), '400 SCHEMA');
  assert.equal(validateEvent({ opId: 'op-00000001', type: 'MEMORY_ADD', payload: { memoryId: 'mem-00000001', text: 'x', visibility: 'private' } }, 'mc').payload.visibility, 'shared', 'Minecraft 的記憶固定公開');
});

test('本機 AI 政策：只有 RULES 與 LOCAL_OLLAMA；雲端、供應商名稱、網址、大小寫變形都拒絕', () => {
  assert.equal(checkRoute('RULES'), 'RULES');
  assert.equal(checkRoute('LOCAL_OLLAMA'), 'LOCAL_OLLAMA');
  for (const r of ['CLOUD', 'cloud', 'local_ollama', 'Local_Ollama', 'POCKET_CLOUD', 'claude-haiku-5-5', 'GEMINI', 'AZURE', 'https://api.example.com', 'http://127.0.0.1:11434', '', null, undefined, 42])
    assert.equal(code(() => checkRoute(r)), '403 CLOUD_FORBIDDEN', String(r));
});

test('數值規則：FED／PETTED／PLAYED／tickPet 與 FairyPocket 相同', () => {
  const doc = () => ({ profile: { personality: 'playful' }, state: { health: 10, hunger: 10, energy: 50, affection: 10, mood: 50, asleep: false }, stats: { fed: 0, petted: 0, played: 0 }, memories: [], dialogue: [], adventures: [], rev: 1 });
  const d = doc();
  applyEvent(d, { type: 'FED', payload: { food: 'cookie' }, role: 'fp', now: 0 });
  assert.deepEqual([d.state.hunger, d.state.health, d.state.affection, d.state.mood, d.stats.fed], [12, 11, 16, 62, 1], '愛玩的最愛是餅乾：感情 +6、心情 +12');
  const full = doc();
  full.state.hunger = 19.6;
  assert.equal(applyEvent(full, { type: 'FED', payload: { food: 'bread' }, role: 'fp', now: 0 }).result, 'full');
  const p = doc();
  applyEvent(p, { type: 'PLAYED', payload: {}, role: 'fp', now: 0 });
  assert.deepEqual([p.state.affection, p.state.mood, p.state.energy, p.state.hunger], [14, 58, 47, 9.5]);
  const t1 = doc();
  tick(t1, 1, false);
  assert.ok(Math.abs(t1.state.hunger - (10 - 1 / 120)) < 1e-9);
  assert.ok(Math.abs(t1.state.energy - (50 - 0.1 * 1.1)) < 1e-9);
  assert.ok(Math.abs(t1.state.mood - (50 - 1 / 150)) < 1e-9);
});
