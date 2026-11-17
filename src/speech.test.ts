// AI 3.0 語音修復：用假的瀏覽器語音辨識測 Recognizer（不需要真的麥克風）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Recognizer, SETTLE_MS, type RecStage } from './speech';

type Alt = { transcript: string };
class FakeRec {
  static last: FakeRec | null = null;
  static all: FakeRec[] = [];
  static failStart = 0;
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onnomatch: (() => void) | null = null;
  starts = 0;
  aborted = false;
  private results: (Alt[] & { isFinal: boolean })[] = [];
  constructor() {
    FakeRec.last = this;
    FakeRec.all.push(this);
  }
  start(): void {
    if (FakeRec.failStart > 0) {
      FakeRec.failStart--;
      throw new Error('InvalidStateError');
    }
    this.starts++;
    this.onstart?.();
  }
  stop(): void {}
  abort(): void {
    this.aborted = true;
    this.onend?.();
  }
  /** 送一個結果（同一句的中途結果會更新同一格） */
  say(text: string, final: boolean, alts: string[] = [], newUtterance = false): void {
    const r = Object.assign([{ transcript: text }, ...alts.map((a) => ({ transcript: a }))], { isFinal: final });
    if (newUtterance || !this.results.length || this.results[this.results.length - 1].isFinal) this.results.push(r);
    else this.results[this.results.length - 1] = r;
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results });
  }
}

let stages: string[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  FakeRec.last = null;
  FakeRec.all = [];
  FakeRec.failStart = 0;
  stages = [];
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRec;
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

function make() {
  const r = new Recognizer();
  r.onStage = (s: RecStage, d?: string) => stages.push(d ? `${s}:${d}` : s);
  const got: { text: string; final: boolean; alts: string[] }[] = [];
  const fails: string[] = [];
  return { r, got, fails, on: (text: string, final: boolean, alts: string[]) => got.push({ text, final, alts }), fail: (e: string) => fails.push(e) };
}

describe('Recognizer：三種語言都走同一條路', () => {
  for (const [lang, words] of [
    ['zh-TW', '今天好冷喔'],
    ['ja-JP', 'お仕事行ってくるね'],
    ['en-US', 'good morning'],
  ] as const) {
    it(`${lang}：設定語言、收到完成結果、多個候選`, () => {
      const t = make();
      expect(t.r.start(lang, t.on, t.fail)).toBe(true);
      const rec = FakeRec.last!;
      expect(rec.lang).toBe(lang);
      expect(rec.continuous).toBe(true);
      expect(rec.maxAlternatives).toBe(5);
      rec.onspeechstart?.();
      rec.say(words.slice(0, 3), false);
      rec.say(words, true, ['alt']);
      expect(t.got.at(-1)).toEqual({ text: words, final: true, alts: [words, 'alt'] });
      expect(stages).toEqual(['listening', 'speech', 'recognizing', 'final']);
    });
  }
});

describe('Recognizer：錯誤與邊界', () => {
  it('只有中途結果（iPhone 常常不給完成）：停住 1.3 秒當作說完，之後同一句的完成結果不重複', () => {
    const t = make();
    t.r.start('ja-JP', t.on);
    const rec = FakeRec.last!;
    rec.say('おはよう', false);
    vi.advanceTimersByTime(SETTLE_MS + 10);
    expect(t.got.filter((g) => g.final).map((g) => g.text)).toEqual(['おはよう']);
    rec.say('おはよう', true);
    expect(t.got.filter((g) => g.final)).toHaveLength(1);
  });
  it('空的完成結果＝NoMatch：不當成說了話', () => {
    const t = make();
    t.r.start('zh-TW', t.on);
    FakeRec.last!.say('', true);
    FakeRec.last!.onnomatch?.();
    expect(t.got).toHaveLength(0);
    expect(stages.filter((s) => s.startsWith('nomatch'))).toHaveLength(2);
  });
  it('沒有權限：一定停下並通知（不會一直重試）', () => {
    const t = make();
    t.r.start('zh-TW', t.on, t.fail);
    const rec = FakeRec.last!;
    rec.onerror?.({ error: 'not-allowed' });
    rec.onend?.();
    vi.advanceTimersByTime(10_000);
    expect(t.fails).toEqual(['not-allowed']);
    expect(rec.starts).toBe(1);
    expect(t.r.failed).toBe('not-allowed');
  });
  it('麥克風暫時被占用（播放語音時）：不馬上放棄，自動重新開始；連續 3 次才放棄', () => {
    const t = make();
    t.r.start('ja-JP', t.on, t.fail);
    const rec = FakeRec.last!;
    rec.onerror?.({ error: 'audio-capture' });
    rec.onend?.();
    expect(t.fails).toEqual([]);
    expect(rec.starts).toBe(2);
    rec.onerror?.({ error: 'audio-capture' });
    rec.onend?.();
    rec.onerror?.({ error: 'audio-capture' });
    expect(t.fails).toEqual(['audio-capture']);
  });
  it('有結果就重置「暫時被占用」的次數', () => {
    const t = make();
    t.r.start('ja-JP', t.on, t.fail);
    const rec = FakeRec.last!;
    rec.onerror?.({ error: 'audio-capture' });
    rec.onerror?.({ error: 'audio-capture' });
    rec.say('はい', true);
    rec.onerror?.({ error: 'audio-capture' });
    expect(t.fails).toEqual([]);
  });
  it('瀏覽器自己停掉（安靜太久、網路、no-speech）：自動重新開始；重新開始失敗會隔久一點再試', () => {
    const t = make();
    t.r.start('en-US', t.on, t.fail);
    const rec = FakeRec.last!;
    rec.onerror?.({ error: 'no-speech' });
    FakeRec.failStart = 2;
    rec.onend?.();
    expect(rec.starts).toBe(1);
    vi.advanceTimersByTime(300);
    expect(rec.starts).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(rec.starts).toBe(2);
    expect(t.fails).toEqual([]);
    expect(stages).toContain('restart:2');
  });
  it('一直重新開始失敗：不會默默停住，會通知（stalled）', () => {
    const t = make();
    t.r.start('en-US', t.on, t.fail);
    FakeRec.failStart = 99;
    FakeRec.last!.onend?.();
    vi.advanceTimersByTime(20_000);
    expect(t.fails).toEqual(['stalled']);
  });
  it('停掉時還沒送出的中途結果：當作說完（以前重新開始時會遺失）', () => {
    const t = make();
    t.r.start('zh-TW', t.on);
    const rec = FakeRec.last!;
    rec.say('我回來了', false);
    rec.onend?.();
    expect(t.got.filter((g) => g.final).map((g) => g.text)).toEqual(['我回來了']);
  });
  it('快速開關：舊的辨識不會再送結果、不會重新開始', () => {
    const t = make();
    t.r.start('zh-TW', t.on);
    const first = FakeRec.last!;
    t.r.stop();
    t.r.start('zh-TW', t.on);
    t.r.stop();
    t.r.start('zh-TW', t.on);
    const now = FakeRec.last!;
    expect(first.aborted).toBe(true);
    const before = t.got.length;
    first.say('舊的', true);
    first.onend?.();
    vi.advanceTimersByTime(5000);
    expect(t.got.length).toBe(before);
    expect(first.starts).toBe(1);
    now.say('新的', true);
    expect(t.got.at(-1)?.text).toBe('新的');
  });
  it('停掉之後中途結果的計時也取消（不會晚一點又冒出來）', () => {
    const t = make();
    t.r.start('ja-JP', t.on);
    FakeRec.last!.say('もしもし', false);
    t.r.stop();
    vi.advanceTimersByTime(SETTLE_MS * 3);
    expect(t.got.filter((g) => g.final)).toHaveLength(0);
  });
});
