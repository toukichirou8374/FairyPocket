// AI 3.0：三個來源的路由測試（規則；不呼叫任何 AI）
import { describe, expect, it } from 'vitest';
import { claimsDone, complexity, DEFAULT_ROUTE, dropClaims, explicitIntent, limitCandidate, redactNames, route, type RouteInput } from './router';

const base = (x: Partial<RouteInput> = {}): RouteInput => ({
  settings: { mode: 'auto', depth: 'sonnet' },
  how: 'chat',
  text: '你好',
  lang: 'zh_tw',
  online: true,
  avail: { local: true, cloud: true, claude: true },
  ...x,
});

describe('路由：每次只選一個主要來源，失敗才依序換', () => {
  it('自動：簡單的話 → 既有雲端 → 本機（跟以前一樣，不用 Claude）', () => {
    expect(route(base()).order).toEqual(['cloud', 'local']);
  });
  it('自動：需要想的話 → Claude → 既有雲端 → 本機', () => {
    const p = route(base({ text: '為什麼天空是藍色的，可以解釋給我聽嗎' }));
    expect(p.order).toEqual(['claude', 'cloud', 'local']);
    expect(p.depth).toBe('sonnet');
  });
  it('Claude 沒打開（家裡電腦說還沒準備好）＝跟以前完全一樣', () => {
    expect(route(base({ text: '為什麼天空是藍色的，可以解釋給我聽嗎', avail: { local: true, cloud: true, claude: false } })).order).toEqual(['cloud', 'local']);
  });
  it('手動：優先本機／既有雲端／Claude、僅本機', () => {
    expect(route(base({ settings: { mode: 'local-first', depth: 'sonnet' } })).order).toEqual(['local', 'cloud', 'claude']);
    expect(route(base({ settings: { mode: 'cloud-first', depth: 'sonnet' } })).order).toEqual(['cloud', 'local']);
    expect(route(base({ settings: { mode: 'claude-first', depth: 'sonnet' } })).order).toEqual(['claude', 'cloud', 'local']);
    expect(route(base({ settings: { mode: 'local-only', depth: 'fable' } })).order).toEqual(['local']);
  });
  it('自己決定、看到聽到、家人做了什麼：一律本機（不花錢；不重複產生生命經驗）', () => {
    for (const how of ['decide', 'notice', 'event'] as const) {
      expect(route(base({ how, settings: { mode: 'claude-first', depth: 'fable' } })).order).toEqual(['local']);
    }
  });
  it('預算用完／冷卻中的來源不用（回到原本的 AI）', () => {
    expect(route(base({ settings: { mode: 'claude-first', depth: 'sonnet' }, avail: { local: true, cloud: false, claude: false } })).order).toEqual(['local']);
  });
  it('沒有網路：不問任何 AI（安全待機）', () => {
    expect(route(base({ online: false })).order).toEqual([]);
  });
  it('Claude 深度：Opus 只用在需要想的話；Fable 只在明確選擇時', () => {
    expect(route(base({ settings: { mode: 'claude-first', depth: 'opus' } })).depth).toBe('sonnet');
    expect(route(base({ settings: { mode: 'claude-first', depth: 'opus' }, text: 'どうしてアレイは歌が好きなの？おしえて' , lang: 'ja_jp' })).depth).toBe('opus');
    expect(route(base({ settings: { mode: 'claude-first', depth: 'fable' } })).depth).toBe('fable');
    // 沒選 Fable 就永遠不會是 Fable
    for (const text of ['你好', '為什麼天空是藍色的，可以解釋給我聽嗎', 'x'.repeat(300)]) {
      for (const depth of ['sonnet', 'opus'] as const) expect(route(base({ text, settings: { mode: 'auto', depth } })).depth).not.toBe('fable');
    }
  });
});

describe('複雜度（只看文字）', () => {
  it('三種語言', () => {
    expect(complexity('早安', 'zh_tw')).toBe('simple');
    expect(complexity('你覺得我明天要穿什麼', 'zh_tw')).toBe('complex');
    expect(complexity('おはよう', 'ja_jp')).toBe('simple');
    expect(complexity('なんで空は青いの？', 'ja_jp')).toBe('complex');
    expect(complexity('hi there', 'en_us')).toBe('simple');
    expect(complexity('why do cats purr?', 'en_us')).toBe('complex');
  });
});

describe('Claude 只拿到最少的內容；回答只是候選', () => {
  it('家人的名字換成「家人」', () => {
    expect(redactNames('〔甲〕說〔甲乙〕今天很累', ['〔甲〕', '〔甲乙〕'], 'zh_tw')).toBe('家人說家人今天很累');
    expect(redactNames('A said hi', ['A'], 'en_us')).toBe('family said hi');
  });
  it('Claude 不能寫記憶；身體被別的地方控制時沒有動作', () => {
    const c = { text: '好呀', intent: 'dance', actions: ['wave'], notes: ['喜歡貓'] };
    expect(limitCandidate(c, 'claude', false)).toEqual({ text: '好呀', intent: 'dance', actions: ['wave'], notes: [] });
    expect(limitCandidate(c, 'claude', true)).toEqual({ text: '好呀', intent: null, actions: [], notes: [] });
    expect(limitCandidate(c, 'local', false)).toBe(c);
  });
  it('不能說「已經做好了」（計時、音樂只由小助手真的做）', () => {
    expect(claimsDone('我已經幫你設好計時了！', 'zh_tw')).toBe(true);
    expect(dropClaims('好呀！我已經幫你設好計時了。等一下見！', 'zh_tw')).toBe('好呀！等一下見！');
    expect(claimsDone('タイマー、セットしたよ！', 'ja_jp')).toBe(true);
    expect(claimsDone("I've set a timer for you.", 'en_us')).toBe(true);
    expect(claimsDone('我想去看看花', 'zh_tw')).toBe(false);
  });
});

describe('Claude 的意圖只看標籤（2026-11-17 實測）', () => {
  it('有標籤才算；只是句子裡提到「睡」「跳舞」不算', () => {
    expect(explicitIntent('好啊！我剛好也想動一動。 [意圖：跳舞]')).toBe(true);
    expect(explicitIntent('いいよ！ [意図：おどる]')).toBe(true);
    expect(explicitIntent('Sure! [intent: dance]')).toBe(true);
    expect(explicitIntent('Good morning! Did you sleep okay? [action: wave right]')).toBe(false);
    expect(explicitIntent('我最喜歡看星星一閃一閃的樣子，好像在跳舞耶。')).toBe(false);
  });
});

describe('預設：Claude 優先（製作人 2026-11-17 決定）', () => {
  const avail = { local: true, cloud: true, claude: true };
  it('Claude 能用時先用 Claude；Claude 沒開時跟以前一樣（雲端→本機）', () => {
    expect(DEFAULT_ROUTE.mode).toBe('claude-first');
    expect(route(base({ text: '今天好冷喔', settings: DEFAULT_ROUTE, avail })).order).toEqual(['claude', 'cloud', 'local']);
    expect(route(base({ text: '今天好冷喔', settings: DEFAULT_ROUTE, avail: { ...avail, claude: false } })).order).toEqual(['cloud', 'local']);
  });
  it('發生的事、自己決定活動：還是只用本機（不花錢）', () => {
    expect(route(base({ how: 'event', settings: DEFAULT_ROUTE, avail })).order).toEqual(['local']);
  });
});
