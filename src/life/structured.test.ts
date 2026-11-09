import { describe, expect, it } from 'vitest';
import { FORMAT_HINT, jsonToTags, replySchema } from './structured';
import { parseLifeReply } from './life';

describe('大腦→身體的固定格式', () => {
  it('JSON 回答轉成標籤後，照原本的解析得到話、意圖、動作、心情、記住的事、名字', () => {
    const raw = JSON.stringify({ say: '嘿嘿，嗨！', intent: '跳舞', mood: '開心', actions: ['拍手', '揮右手'], remember: 'いつき喜歡恐龍', name: 'いつき' });
    const tags = jsonToTags(raw, 'zh_tw');
    expect(tags).toContain('[名字：いつき]');
    const r = parseLifeReply(tags, 'zh_tw');
    expect(r).toMatchObject({ text: '嘿嘿，嗨！', intent: 'dance', feeling: 'happy', actions: ['clap', 'wave_right'], notes: ['いつき喜歡恐龍'] });
  });
  it('空的欄位＝沒有；不是 JSON 就原樣交給原本的解析', () => {
    const r = parseLifeReply(jsonToTags('{"say":"","intent":"","mood":"","actions":[]}', 'zh_tw'), 'zh_tw');
    expect(r).toMatchObject({ text: '', intent: null, actions: [] });
    expect(jsonToTags('[開心] 好啊', 'zh_tw')).toBe('[開心] 好啊');
    expect(parseLifeReply(jsonToTags('```json\n{"say":"好","intent":"休息","mood":"","actions":[]}\n```', 'zh_tw'), 'zh_tw').intent).toBe('rest');
  });
  it('格式只允許清單裡的意圖、動作、心情', () => {
    const s = replySchema('ja_jp', ['おどる', 'やすむ']) as { properties: Record<string, { enum?: string[]; items?: { enum: string[] } }> };
    expect(s.properties.intent.enum).toEqual(['', 'おどる', 'やすむ']);
    expect(s.properties.actions.items?.enum).toContain('うなずく');
    expect(s.properties.mood.enum).toContain('ねむい');
    expect(FORMAT_HINT.en_us).toContain('JSON');
  });
});

describe('2026-11-09 修正：壞掉的格式不念出來', () => {
  it('欄位裡又寫一次標籤，不會多出「]」', () => {
    const t = jsonToTags(JSON.stringify({ say: '', intent: 'ぐるっとパトロール', mood: '', actions: [], remember: '[覚えて：頭をなでられた]' }), 'ja_jp');
    expect(parseLifeReply(t, 'ja_jp').text).toBe('');
  });
  it('前面正常、後面多了亂碼：只取第一個物件', () => {
    const t = jsonToTags('{"say":"おはよう！","intent":"","mood":"","actions":[]} 楽しそう！” 楽しそう！”', 'ja_jp');
    expect(parseLifeReply(t, 'ja_jp').text).toBe('おはよう！');
  });
  it('完全讀不出來的 JSON：不說話', () => {
    expect(jsonToTags('{ "": "！いいな！”, 楽しそう！” 楽しそう！”', 'ja_jp')).toBe('');
  });
});
