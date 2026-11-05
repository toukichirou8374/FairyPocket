import { describe, expect, it } from 'vitest';
import { applyElapsed, createPet, feed, isNight, moodLevel, play, reunionKind, tickPet, toIcons, MAX_HUNGER } from './state';
import { decodeLink, encodeLink, linkKind, loadPet, parseSave, serialize, storePet, SAVE_KEY, BACKUP_KEY } from './save';
import { pickLine } from './dialogue';
import { loadLang, uiKeys } from '../i18n';
import { buildFont, unifontGlyph } from '../pixelFont';
import fontChars from '../../fonts/fairypocket-pixel.chars.txt?raw';
import { packFile, parseLegacyPack, parseZipBlob, parseZipPack } from './assets';
import { allayRate, distanceGain, loadSoundMode, SOUND_MODES } from '../audio';
import { SFX, sfxPitch } from '../sfx';
import { trimSilence } from '../voice';
import { WaveDetector } from '../ar';
import { trackPitch, transform, VOICE_STYLES } from '../voicefx';
import { clipKey, legacyRenames, matchesItem, recordedItems, stickerBookItems } from './sbItems';
import { detectIntent, TALK_LINES } from './talk';
import { collectLocal, packValue, parseExtras, restoreLocal, unpackValue } from './backup';
import { matchesSticker, normalizeSpeech, STICKERS } from './stickers';
import { gamepadPrompts, isModifier, keyboardPrompts, keyId, KeyRound, loadBest, padFamily, saveBest } from './keyGame';
import { emptyMemory, memoryTopic, mostEaten, rememberFood, takeMilestone, timeGreeting, visitDay } from './memory';

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

describe('daily life', () => {
  it('follows the bedtime schedule', () => {
    const at = (h: number) => new Date(2026, 10, 4, h, 30);
    expect(isNight(at(22), 22)).toBe(true);
    expect(isNight(at(5), 22)).toBe(true);
    expect(isNight(at(6), 22)).toBe(false);
    expect(isNight(at(20), 20)).toBe(true);
    expect(isNight(at(4), 20)).toBe(false);
  });
  it('misses you while away and cheers up with care', () => {
    const s = createPet();
    s.mood = 70;
    applyElapsed(s, 24 * 3600_000);
    expect(s.mood).toBe(25);
    expect(moodLevel(s.mood)).toBe(0);
    play(s);
    feed(s, 'cookie');
    expect(s.mood).toBeGreaterThan(25);
    expect(reunionKind(10 * 60_000)).toBe('greet');
    expect(reunionKind(3 * 3600_000)).toBe('welcomeBack');
    expect(reunionKind(24 * 3600_000)).toBe('missed');
    expect(reunionKind(5 * 86400_000)).toBe('longAway');
  });
});

describe('link', () => {
  it('round-trips a link code and keeps the pet id', async () => {
    const s = createPet(5);
    s.name = '連動測試';
    const code = await encodeLink(s);
    expect(code.startsWith('FP1:')).toBe(true);
    const back = await decodeLink(code);
    expect(back.id).toBe(s.id);
    expect(back.name).toBe('連動測試');
    await expect(decodeLink('hello')).rejects.toThrow();
  });
  it('tells the same pet from another one', () => {
    const a = createPet(1);
    const b = { ...a, lastSeen: a.lastSeen + 10 };
    expect(linkKind(a, b)).toBe('same-newer');
    expect(linkKind(b, a)).toBe('same-older');
    expect(linkKind(a, createPet(1))).toBe('other');
  });
  it('gives old saves an id', () => {
    const old = createPet(1) as Partial<ReturnType<typeof createPet>>;
    delete old.id;
    expect(parseSave(JSON.stringify({ app: 'FairyPocket', format: 1, pet: old })).id).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
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
  it('reads a zip pack straight from the file without copying it (iPad)', async () => {
    const buf = await makeZip({
      'pack.json': JSON.stringify({ app: 'FairyPocket', kind: 'mc-assets', format: 2, source: '26.3', id: 'x2' }),
      'textures/entity/allay/allay.png': 'img',
      'sounds/random/pop.ogg': 'pop',
    });
    const p = await parseZipBlob(new Blob([buf]));
    expect(p.id).toBe('x2');
    expect(await packFile(p, 'sounds/random/pop')?.text()).toBe('pop');
    expect(await p.files.get('textures/entity/allay/allay.png')?.text()).toBe('img');
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

describe('memory', () => {
  const DAY = 86400_000;
  it('counts days in a row and resets after a gap', () => {
    const m = emptyMemory();
    const t0 = new Date(2026, 10, 1, 9).getTime();
    expect(visitDay(m, t0)).toBe(true);
    expect(visitDay(m, t0 + 3600_000)).toBe(false);
    visitDay(m, t0 + DAY);
    visitDay(m, t0 + 2 * DAY);
    expect(m.streak).toBe(3);
    visitDay(m, t0 + 5 * DAY);
    expect(m.streak).toBe(1);
    expect(m.days).toBe(4);
  });
  it('remembers foods and celebrates milestones once', () => {
    const s = createPet(0);
    for (let i = 0; i < 3; i++) rememberFood(s.memory, 'bread', 1000);
    expect(mostEaten(s.memory)).toBe('bread');
    s.stats.petted = 120;
    expect(takeMilestone(s, ['mPetted'])).toEqual({ kind: 'mPetted', n: 100 });
    expect(takeMilestone(s, ['mPetted'])).toBeNull();
    const topic = memoryTopic(s, 1000 + 3600_000, () => 0);
    expect(topic?.kind).toBe('remFood');
  });
  it('survives a save round trip', () => {
    const s = createPet(0);
    rememberFood(s.memory, 'cookie', 5);
    const back = parseSave(serialize(s));
    expect(back.memory.foods.cookie).toBe(1);
    expect(back.memory.lastFood).toBe('cookie');
  });
  it('fills in counts in lines', () => {
    expect(pickLine('streak', 'brave', 'x', () => 0, '', 'zh_tw', 5)).toContain('5');
    expect(['greetMorning', 'greetAfternoon', 'greetEvening']).toContain(timeGreeting(new Date(2026, 0, 1, 8).getTime()));
    expect(timeGreeting(new Date(2026, 0, 1, 8).getTime())).toBe('greetMorning');
    expect(timeGreeting(new Date(2026, 0, 1, 21).getTime())).toBe('greetEvening');
  });
});

describe('voice', () => {
  it('trims silence and ignores near-silent recordings', () => {
    const rate = 1000;
    const d = new Float32Array(2000);
    for (let i = 800; i < 1200; i++) d[i] = 0.5;
    const out = trimSilence(d, rate)!;
    expect(out.length).toBe(400 + 2 * 50);
    expect(trimSilence(new Float32Array(2000), rate)).toBeNull();
  });

});

describe('ar wave', () => {
  it('detects a hand waving left and right, but not one sweep', () => {
    const w = new WaveDetector();
    let hit = false;
    [-0.4, -0.1, 0.3, 0.0, -0.4, 0.0, 0.4].forEach((x, i) => (hit = w.push(1000 + i * 100, x) || hit));
    expect(hit).toBe(true);
    const w2 = new WaveDetector();
    let hit2 = false;
    [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6].forEach((x, i) => (hit2 = w2.push(1000 + i * 100, x) || hit2));
    expect(hit2).toBe(false);
  });
});

describe('context sounds', () => {
  it('maps every situation to an original sound path', () => {
    for (const [k, v] of Object.entries(SFX)) {
      expect(v.path.startsWith('sounds/'), k).toBe(true);
      expect(v.pitch[0]).toBeLessThanOrEqual(v.pitch[1]);
      expect(v.vol).toBeGreaterThan(0);
      const p = sfxPitch(k as keyof typeof SFX, () => 0.5);
      expect(p).toBeGreaterThanOrEqual(v.pitch[0]);
    }
  });
  it('gets quieter with distance', () => {
    expect(distanceGain(1)).toBe(1);
    expect(distanceGain(6)).toBeCloseTo(0.5);
    expect(distanceGain(100)).toBe(0.25);
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

describe('pixel font', () => {
  it('has every character the game shows (run npm run font after changing text)', () => {
    const sources = import.meta.glob(['../**/*.ts', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const have = new Set(fontChars);
    const missing = new Set<string>();
    for (const text of Object.values(sources)) for (const ch of text) if (ch > '\u007f' && !have.has(ch)) missing.add(ch);
    expect([...missing].join('')).toBe('');
  });
  it('builds a valid-looking TrueType file', () => {
    const ttf = buildFont('Test', [unifontGlyph(0x41, '0000000018242442427E424242420000')]);
    expect(new DataView(ttf.buffer).getUint32(0)).toBe(0x10000);
    expect(ttf.length % 4).toBe(0);
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

describe('變聲', () => {
  // 模擬大人男生的聲音：120Hz 的母音（含泛音），1.2 秒
  const rate = 48000;
  const voice = new Float32Array(rate * 1.2);
  for (let i = 0; i < voice.length; i++) {
    const t = i / rate;
    for (let h = 1; h <= 8; h++) voice[i] += (Math.sin(2 * Math.PI * 120 * h * t) / h) * 0.2;
  }
  const mid = (d: Float32Array) => {
    const v = [...trackPitch(d, rate)].filter((x) => x > 0).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  it('聽得出原本的音高', () => {
    expect(mid(voice)).toBeGreaterThan(110);
    expect(mid(voice)).toBeLessThan(130);
  });
  it('少女、小孩、精靈的聲音一個比一個高，長度差不多', () => {
    const girl = transform(voice, rate, 'girl');
    const child = transform(voice, rate, 'child');
    expect(mid(girl)).toBeGreaterThan(220);
    expect(mid(girl)).toBeLessThan(280);
    expect(mid(child)).toBeGreaterThan(mid(girl));
    expect(Math.abs(girl.length - voice.length)).toBeLessThan(rate * 0.1);
    const fairy = transform(voice, rate, 'fairy');
    expect(fairy.length).toBeGreaterThan(voice.length * 0.9);
    expect(Math.max(...fairy.map(Math.abs))).toBeLessThanOrEqual(0.91);
  });
});

describe('按鍵遊戲', () => {
  it('答對才換題、答錯題目不變', () => {
    const r = new KeyRound(keyboardPrompts('zh_tw'));
    const p = r.next();
    expect(r.press('nope')).toBe(false);
    expect(r.current).toBe(p);
    expect(r.misses).toBe(1);
    expect(r.press(p.id)).toBe(true);
    expect(r.score).toBe(1);
    for (let i = 0; i < 50; i++) {
      const prev = r.current!;
      expect(r.next().id).not.toBe(prev.id);
    }
  });
  it('聲音玩法：題目沒有文字也能一直出下一題', () => {
    const r = new KeyRound([{ id: 'a', label: '', speak: 'a' }, { id: 'b', label: '', speak: 'b' }, { id: 'c', label: '', speak: 'c' }]);
    for (let i = 0; i < 20; i++) {
      const prev = r.current;
      const p = r.next();
      expect(p).toBeTruthy();
      expect(p.id).not.toBe(prev?.id);
    }
  });
  it('鍵盤：英文數字；繁中加注音、日文加假名、英文只有英數', () => {
    const labels = (l: 'zh_tw' | 'ja_jp' | 'en_us') => keyboardPrompts(l).map((p) => p.label);
    expect(labels('en_us')).toHaveLength(36);
    expect(labels('zh_tw')).toContain('ㄅ');
    expect(labels('zh_tw')).not.toContain('あ');
    expect(labels('ja_jp')).toContain('あ');
    expect(labels('ja_jp')).not.toContain('ㄅ');
    expect(labels('en_us')).not.toContain('ㄅ');
    expect(keyboardPrompts('zh_tw').find((p) => p.label === 'ㄅ')!.id).toBe('Digit1');
    expect(keyboardPrompts('ja_jp').find((p) => p.label === 'あ')!.id).toBe('Digit3');
    expect(keyboardPrompts('zh_tw')).toHaveLength(36 + 37);
    expect(keyboardPrompts('ja_jp')).toHaveLength(36 + 45);
    expect(keyId('Numpad7')).toBe('Digit7');
    expect(isModifier('ShiftLeft')).toBe(true);
    expect(isModifier('KeyA')).toBe(false);
  });
  it('控制器：依廠牌顯示按鈕名稱', () => {
    expect(padFamily('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)')).toBe('xbox');
    expect(padFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)')).toBe('playstation');
    expect(padFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e)')).toBe('nintendo');
    expect(gamepadPrompts('playstation', 'zh_tw')[0]).toMatchObject({ id: '0', label: '✕', speak: '叉叉' });
    expect(gamepadPrompts('nintendo', 'en_us')[0].label).toBe('B');
    expect(padFamily('Wireless Controller (STANDARD GAMEPAD)')).toBe('playstation');
  });
  it('最高紀錄', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadBest(st, 'tap', 'cat')).toBe(0);
    expect(saveBest(st, 'tap', 'cat', 5)).toBe(true);
    expect(saveBest(st, 'tap', 'cat', 3)).toBe(false);
    expect(loadBest(st, 'tap', 'cat')).toBe(5);
    expect(loadBest(st, 'keyboard', 'cat')).toBe(0);
  });
});

describe('聲音玩法的貼紙', () => {
  it('每類至少 6 個，圖都是 12×12、顏色都有定義', () => {
    for (const c of ['animal', 'food', 'vehicle', 'work', 'sport', 'building', 'feeling']) expect(STICKERS.filter((s) => s.cat === c).length, c).toBeGreaterThanOrEqual(6);
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
    for (const s of STICKERS) {
      expect(s.grid.length, s.id).toBeGreaterThanOrEqual(10);
      expect(s.grid.length, s.id).toBeLessThanOrEqual(12);
      for (const row of s.grid) {
        expect(row.length, s.id).toBe(12);
        for (const ch of row) if (ch !== '.') expect(s.pal[ch], `${s.id} ${ch}`).toBeTruthy();
      }
    }
  });
  it('聽到名字或常見說法就算答對（三種語言）', () => {
    const get = (id: string) => STICKERS.find((s) => s.id === id)!;
    expect(matchesSticker('是狗狗', get('dog'), 'zh_tw')).toBe(true);
    expect(matchesSticker('胡萝卜', get('carrot'), 'zh_tw')).toBe(true);
    expect(matchesSticker('貓', get('dog'), 'zh_tw')).toBe(false);
    expect(matchesSticker('ネコ！', get('cat'), 'ja_jp')).toBe(true);
    expect(matchesSticker('自転車', get('bicycle'), 'ja_jp')).toBe(true);
    expect(matchesSticker('A Fire Engine', get('firetruck'), 'en_us')).toBe(true);
    expect(matchesSticker('', get('dog'), 'en_us')).toBe(false);
    expect(normalizeSpeech('バ ナ ナ。')).toBe('ばなな');
  });
});

describe('各式變音器與貼紙簿', () => {
  it('10 種聲音都能變，聲音不會爆掉', () => {
    const rate = 24000;
    const v = new Float32Array(rate);
    for (let i = 0; i < v.length; i++) for (let h = 1; h <= 6; h++) v[i] += (Math.sin((2 * Math.PI * 130 * h * i) / rate) / h) * 0.2;
    expect(VOICE_STYLES).toHaveLength(10);
    for (const st of VOICE_STYLES) {
      const out = transform(v, rate, st);
      expect(out.length, st).toBeGreaterThan(rate * 0.6);
      expect(out.every((x) => Number.isFinite(x)), st).toBe(true);
      expect(Math.max(...out.map(Math.abs)), st).toBeLessThanOrEqual(0.91);
    }
  });
  it('貼紙簿：字母、數字、注音、假名、動物、交通工具、食物全部都有', () => {
    const items = stickerBookItems();
    const n = (c: string) => items.filter((i) => i.cat === c).length;
    expect([n('letter'), n('digit'), n('zhuyin'), n('kana'), n('animal'), n('vehicle'), n('work'), n('food'), n('time')]).toEqual([26, 10, 37, 45, 16, 11, 7, 16, 19]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});

describe('貼紙簿 v0.26', () => {
  const items = stickerBookItems();
  const get = (id: string) => items.find((i) => i.id === id)!;
  it('字母、注音、假名不分語言，其他依語言分開存', () => {
    expect(clipKey(get('letter:A'), 'ja_jp')).toBe('letter:A');
    expect(clipKey(get('kana:あ'), 'zh_tw')).toBe('kana:あ');
    expect(clipKey(get('pic:dog'), 'ja_jp')).toBe('ja_jp/pic:dog');
    expect(clipKey(get('digit:1'), 'en_us')).toBe('en_us/digit:1');
    expect(legacyRenames(['pic:dog', 'letter:A', 'zh_tw/pic:cat'], 'zh_tw')).toEqual([['pic:dog', 'zh_tw/pic:dog']]);
  });
  it('聲音玩法只出現選到的類別裡、這個語言錄好的貼紙', () => {
    const keys = new Set(['zh_tw/pic:dog', 'ja_jp/pic:cat', 'letter:B', 'zh_tw/month:1']);
    expect(recordedItems(keys, ['animal', 'letter'], 'zh_tw').map((i) => i.id)).toEqual(['letter:B', 'pic:dog']);
    expect(recordedItems(keys, ['animal', 'time'], 'ja_jp').map((i) => i.id)).toEqual(['pic:cat']);
  });
  it('數字、月份、星期依語言比對', () => {
    expect(matchesItem('三', get('digit:3'), 'zh_tw')).toBe(true);
    expect(matchesItem('three', get('digit:3'), 'en_us')).toBe(true);
    expect(matchesItem('いち', get('digit:1'), 'ja_jp')).toBe(true);
    expect(matchesItem('September', get('month:9'), 'en_us')).toBe(true);
    expect(matchesItem('くがつ', get('month:9'), 'ja_jp')).toBe(true);
    expect(matchesItem('禮拜天', get('day:7'), 'zh_tw')).toBe(true);
    expect(matchesItem('月曜日', get('day:1'), 'ja_jp')).toBe(true);
    expect(matchesItem('星期二', get('day:1'), 'zh_tw')).toBe(false);
    expect(matchesItem('ㄅ', get('zhuyin:ㄅ'), 'zh_tw')).toBe(true);
  });
});

describe('跟悅靈說話', () => {
  it('意思相近但不同的話分得出來', () => {
    expect(detectIntent('你太安靜了吧', 'zh_tw')).toBe('tooQuiet');
    expect(detectIntent('安靜一點', 'zh_tw')).toBe('quiet');
    expect(detectIntent('你好可愛', 'zh_tw')).toBe('love');
    expect(detectIntent('你一點都不可愛', 'zh_tw')).toBe('notCute');
    expect(detectIntent('しずかにして', 'ja_jp')).toBe('quiet');
    expect(detectIntent('静かすぎるよ', 'ja_jp')).toBe('tooQuiet');
    expect(detectIntent('Hi there!', 'en_us')).toBe('greet');
    expect(detectIntent('this is it', 'en_us')).toBe(null);
    expect(detectIntent('You are too quiet', 'en_us')).toBe('tooQuiet');
    expect(detectIntent('今天天氣', 'zh_tw')).toBe(null);
  });
  it('每個意思三種語言都有回答', () => {
    for (const [k, v] of Object.entries(TALK_LINES)) for (const l of ['zh_tw', 'ja_jp', 'en_us'] as const) expect(v[l].length, k + l).toBeGreaterThan(0);
  });
});

describe('匯出存檔帶走遊戲資料與錄音', () => {
  it('設定與錄音可以存進文字再還原', () => {
    const mem = new Map<string, string>([['fairypocket.keygame.v1', '{"a":3}'], [SAVE_KEY, 'x'], ['other', 'y'], ['fairypocket.assets.v1', 'z']]);
    const st = { get length() { return mem.size; }, key: (i: number) => [...mem.keys()][i] ?? null, getItem: (k: string) => mem.get(k) ?? null };
    expect(collectLocal(st)).toEqual({ 'fairypocket.keygame.v1': '{"a":3}' });
    const data = new Float32Array(4800).map((_, i) => Math.sin(i / 10) * 0.5);
    const packed = packValue([{ rate: 48000, data }, null]);
    const text = serialize(createPet(), 0, { local: collectLocal(st), voice: { 'replies:zh_tw': packed } });
    const ex = parseExtras(text)!;
    const back = unpackValue(ex.voice['replies:zh_tw']) as ({ rate: number; data: Float32Array } | null)[];
    expect(back[0]!.rate).toBe(24000);
    expect(back[0]!.data.length).toBe(2400);
    expect(Math.abs(back[0]!.data[100] - data[200])).toBeLessThan(0.05);
    expect(back[1]).toBe(null);
    const out = new Map<string, string>();
    restoreLocal({ setItem: (k, v) => out.set(k, v) }, { ...ex.local, [SAVE_KEY]: 'bad' });
    expect([...out.keys()]).toEqual(['fairypocket.keygame.v1']);
    expect(parseSave(text).name).toBeTruthy();
    expect(parseExtras(serialize(createPet()))).toBe(null);
  });
});
