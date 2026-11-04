import { describe, expect, it } from 'vitest';
import { applyElapsed, createPet, feed, play, tickPet, toIcons, MAX_HUNGER } from './state';
import { loadPet, parseSave, serialize, storePet, SAVE_KEY, BACKUP_KEY } from './save';
import { pickLine } from './dialogue';
import { loadLang, uiKeys } from '../i18n';
import { packFile, parseLegacyPack, parseZipPack } from './assets';
import { allayRate, loadSoundMode, SOUND_MODES } from '../audio';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('pet state', () => {
  it('feeds and refuses when full', () => {
    const s = createPet();
    s.hunger = 10;
    expect(feed(s, 'apple')).toBe('ok');
    expect(s.hunger).toBe(14);
    s.hunger = MAX_HUNGER;
    expect(feed(s, 'bread')).toBe('full');
  });

  it('hunger drains while awake and energy recovers while asleep', () => {
    const s = createPet();
    const h = s.hunger;
    tickPet(s, 120, false);
    expect(s.hunger).toBeCloseTo(h - 1, 5);
    s.asleep = true;
    s.energy = 10;
    tickPet(s, 10, false);
    expect(s.energy).toBeCloseTo(18, 5);
  });

  it('never drops health below 1 when starving', () => {
    const s = createPet();
    s.hunger = 0;
    for (let i = 0; i < 2000; i++) tickPet(s, 1, false);
    expect(s.health).toBe(1);
  });

  it('offline time is gentle', () => {
    const s = createPet();
    s.hunger = 18;
    applyElapsed(s, 7 * 24 * 3600_000);
    expect(s.hunger).toBe(6);
    expect(s.energy).toBe(100);
  });

  it('play raises affection and stats', () => {
    const s = createPet();
    play(s);
    expect(s.affection).toBe(14);
    expect(s.stats.played).toBe(1);
  });

  it('converts values to 10 icons', () => {
    expect(toIcons(20)).toEqual(Array(10).fill(2));
    expect(toIcons(7)).toEqual([2, 2, 2, 1, 0, 0, 0, 0, 0, 0]);
    expect(toIcons(0)).toEqual(Array(10).fill(0));
  });
});

describe('save', () => {
  it('round-trips through serialize/parse', () => {
    const s = createPet(123);
    s.name = '藍藍';
    s.personality = 'guardian';
    s.onboarded = true;
    const back = parseSave(serialize(s));
    expect(back.name).toBe('藍藍');
    expect(back.personality).toBe('guardian');
    expect(back.createdAt).toBe(123);
  });

  it('rejects invalid files with a Chinese message', () => {
    expect(() => parseSave('not json')).toThrow('有效');
    expect(() => parseSave('{"app":"Other"}')).toThrow('FairyPocket');
  });

  it('sanitizes out-of-range values', () => {
    const text = JSON.stringify({ app: 'FairyPocket', format: 1, pet: { name: 'x'.repeat(50), personality: 'evil', health: 999, hunger: -5 } });
    const s = parseSave(text);
    expect(s.name.length).toBe(12);
    expect(s.personality).toBe('playful');
    expect(s.health).toBe(20);
    expect(s.hunger).toBe(0);
  });

  it('falls back to backup when main save is corrupted', () => {
    const st = memStorage();
    const s = createPet();
    s.name = 'A';
    storePet(st, s);
    s.name = 'B';
    storePet(st, s);
    expect(st.m.has(BACKUP_KEY)).toBe(true);
    st.m.set(SAVE_KEY, '{broken');
    expect(loadPet(st)?.name).toBe('A');
  });
});

/** 測試用的 stored zip（CRC 不檢查，填 0） */
function makeZip(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const entries = Object.entries(files);
  for (const [name, text] of entries) {
    const n = enc.encode(name);
    const d = enc.encode(text);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint32(18, d.length, true);
    h.setUint32(22, d.length, true);
    h.setUint16(26, n.length, true);
    parts.push(new Uint8Array(h.buffer), n, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint32(20, d.length, true);
    c.setUint32(24, d.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + d.length;
  }
  const cdLen = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, cdLen, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)] as BlobPart[]).arrayBuffer() as unknown as ArrayBuffer;
}

describe('asset pack', () => {
  const png = 'data:image/png;base64,AAAA';
  it('reads a zip pack by original paths', async () => {
    const buf = await makeZip({
      'pack.json': JSON.stringify({ app: 'FairyPocket', kind: 'mc-assets', format: 2, source: '26.3', id: 'x1' }),
      'textures/entity/allay/allay.png': 'img',
      'sounds/mob/allay/idle_with_item1.ogg': 'ogg',
    });
    const p = await parseZipPack(buf);
    expect(p.source).toBe('26.3');
    expect(p.id).toBe('x1');
    expect(await packFile(p, 'sounds/mob/allay/idle_with_item1')?.text()).toBe('ogg');
    await expect(parseZipPack(await makeZip({ 'textures/entity/allay/allay.png': 'img' }))).rejects.toThrow('素材包');
  });
  it('converts a legacy json pack and drops unknown or non-png entries', () => {
    const p = parseLegacyPack(JSON.stringify({ app: 'FairyPocket', kind: 'mc-assets', format: 1, source: '26.3', files: { allay: png, apple: 'http://evil', junk: png, amethyst_chime: 'data:audio/wav;base64,AA' } }));
    expect(p.source).toBe('26.3');
    expect(p.files.has('textures/entity/allay/allay.png')).toBe(true);
    expect(p.files.has('textures/item/apple.png')).toBe(false);
    expect(p.files.size).toBe(2);
    expect(packFile(p, 'sounds/block/amethyst/shimmer')).toBeDefined();
  });
  it('rejects packs without the allay or of the wrong kind', () => {
    expect(() => parseLegacyPack(JSON.stringify({ app: 'FairyPocket', kind: 'mc-assets', files: { apple: png } }))).toThrow('悅靈');
    expect(() => parseLegacyPack(serialize(createPet()))).toThrow('素材包');
  });
});

describe('sound spec', () => {
  it('uses the standard personality pitch and sound modes', () => {
    expect(allayRate('guardian')).toBeCloseTo(1.525, 5);
    expect(allayRate('brave')).toBeCloseTo(1.375, 5);
    expect(allayRate('cautious')).toBeCloseTo(1.65, 5);
    expect(allayRate('playful')).toBeCloseTo(1.7875, 5);
    expect(SOUND_MODES.bright).toMatchObject({ allay: 1, chime: 0.58, chimePitch: 1.5 });
    expect(SOUND_MODES.soft).toMatchObject({ allay: 0.52, chime: 0.21, chimePitch: 1.35 });
    expect(SOUND_MODES.off).toMatchObject({ allay: 0, chime: 0 });
    expect(loadSoundMode({ getItem: () => null })).toBe('bright');
  });
});

describe('dialogue', () => {
  it('fills in the name', () => {
    expect(pickLine('greet', 'brave', '小藍', () => 0)).toContain('小藍');
  });
  it('speaks every language', () => {
    expect(pickLine('greet', 'brave', 'Ally', () => 0, '', 'en_us')).toContain('Ally');
    expect(pickLine('fedFood', 'cautious', 'x', () => 0, 'パン', 'ja_jp')).toContain('パン');
  });
});

describe('i18n', () => {
  it('has the same UI keys in every language', () => {
    expect(uiKeys('ja_jp')).toEqual(uiKeys('zh_tw'));
    expect(uiKeys('en_us')).toEqual(uiKeys('zh_tw'));
  });
  it('picks a default language', () => {
    const empty = { getItem: () => null };
    expect(loadLang(empty, 'ja-JP')).toBe('ja_jp');
    expect(loadLang(empty, 'en-US')).toBe('en_us');
    expect(loadLang(empty, 'ja-JP', true)).toBe('zh_tw');
    expect(loadLang({ getItem: () => 'en_us' }, 'zh-TW')).toBe('en_us');
  });
});
