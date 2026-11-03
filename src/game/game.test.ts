import { describe, expect, it } from 'vitest';
import { applyElapsed, createPet, feed, play, tickPet, toIcons, MAX_HUNGER } from './state';
import { loadPet, parseSave, serialize, storePet, SAVE_KEY, BACKUP_KEY } from './save';
import { pickLine } from './dialogue';
import { parsePack } from './assets';

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

describe('asset pack', () => {
  const png = 'data:image/png;base64,AAAA';
  it('accepts a pack with the allay texture and drops unknown or non-png entries', () => {
    const p = parsePack(JSON.stringify({ app: 'FairyPocket', kind: 'mc-assets', format: 1, source: '26.3', files: { allay: png, apple: 'http://evil', junk: png } }));
    expect(p.source).toBe('26.3');
    expect(p.files.allay).toBe(png);
    expect(p.files.apple).toBeUndefined();
    expect('junk' in p.files).toBe(false);
  });
  it('rejects packs without the allay or of the wrong kind', () => {
    expect(() => parsePack(JSON.stringify({ app: 'FairyPocket', kind: 'mc-assets', files: { apple: png } }))).toThrow('悅靈');
    expect(() => parsePack(serialize(createPet()))).toThrow('素材包');
  });
});

describe('dialogue', () => {
  it('fills in the name', () => {
    expect(pickLine('greet', 'brave', '小藍', () => 0)).toContain('小藍');
  });
});
