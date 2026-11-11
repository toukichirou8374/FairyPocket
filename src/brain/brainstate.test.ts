// 2026-11-11：AI 設定看起來被初始化的修正——暫時讀不到時不當成空白、不准覆蓋、會自動重試
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = { result: { state: 'locked' } as { state: string; value?: unknown }, writes: [] as unknown[] };
vi.mock('../secureStore', () => ({
  readSecret: async () => store.result,
  putSecret: async (_k: string, v: unknown) => {
    store.writes.push(v);
    return true;
  },
}));

describe('AI 設定的讀取狀態', () => {
  beforeEach(() => {
    vi.resetModules();
    store.writes = [];
    vi.useFakeTimers();
    (globalThis as { window?: unknown }).window = globalThis;
  });

  it('暫時讀不到：狀態是 locked、不准存（空白設定不會蓋掉原本的）、之後讀到就恢復', async () => {
    store.result = { state: 'locked' };
    const b = await import('./brain');
    await b.initBrain();
    expect(b.brainState()).toBe('locked');
    expect(b.saveBrain({ ...b.loadBrain(), on: true })).toBe(false);
    expect(store.writes).toHaveLength(0);
    // 手機的 IndexedDB 恢復了：自動重試（2 秒後）就讀到原本的設定
    store.result = { state: 'ok', value: { on: true, url: 'https://desktop-x.tail.ts.net', token: 'abcd-efgh', model: 'gemma3:4b' } };
    await vi.advanceTimersByTimeAsync(2100);
    expect(b.brainState()).toBe('ready');
    expect(b.loadBrain()).toMatchObject({ url: 'https://desktop-x.tail.ts.net', token: 'abcd-efgh' });
  });

  it('鑰匙真的不見了：狀態是 lost，可以重新輸入、存起來', async () => {
    store.result = { state: 'lost' };
    const b = await import('./brain');
    await b.initBrain();
    expect(b.brainState()).toBe('lost');
    expect(b.saveBrain({ ...b.loadBrain(), url: 'https://desktop-x.tail.ts.net' })).toBe(true);
    expect(b.brainState()).toBe('ready');
    expect(store.writes).toHaveLength(1);
  });

  it('還在讀（App 剛打開）時也不准存', async () => {
    const b = await import('./brain');
    expect(b.brainState()).toBe('loading');
    expect(b.saveBrain(b.loadBrain())).toBe(false);
  });
});
