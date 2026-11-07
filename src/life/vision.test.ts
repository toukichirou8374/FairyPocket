import { describe, expect, it } from 'vitest';
import { lifeVisionOn, newThings, parseVision, setLifeVision, VISION_PROMPT } from './vision';
import { DIRECT_EVENTS, lifeEventText, lifeRules, type LifeState } from './life';

const state: LifeState = { doing: '輕輕飄著', where: '中間', energy: 70, hunger: 50, asleep: false, recent: [], voice: true, cake: false, mic: true, camera: true, seen: '有人在畫面正前方' };

describe('AI 看畫面（動態生命模式）', () => {
  it('讀 gemma3 的兩行回答：描述＋東西清單', () => {
    const s = parseVision('有人拿著手機拍攝畫面，手上拿著一個紅色的圓形物體。\n東西：紅色的圓形物體、麵包、藍色背景。');
    expect(s).toEqual({ desc: '有人拿著手機拍攝畫面，手上拿著一個紅色的圓形物體。', things: ['紅色的圓形物體', '麵包', '藍色背景'] });
    expect(parseVision('第一行：主人在喝咖啡\n第二行：東西：無')).toEqual({ desc: '主人在喝咖啡', things: [] });
    expect(parseVision('Someone is eating bread.\nThings: Bread, Cup')).toEqual({ desc: 'Someone is eating bread.', things: ['bread', 'cup'] });
    expect(parseVision('パンを食べている人がいる。\nもの：パン、コップ')?.things).toEqual(['パン', 'コップ']);
    expect(parseVision('   ')).toBeNull();
    expect(parseVision('x'.repeat(200))?.desc.length).toBe(81);
  });

  it('只有新出現的東西才算新的', () => {
    expect(newThings(['麵包', '杯子'], ['麵包', '手機'])).toEqual(['手機']);
    expect(newThings(['麵包'], ['一塊麵包'])).toEqual([]);
    expect(newThings([], ['bread'])).toEqual(['bread']);
  });

  it('設定預設關，可以打開', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(lifeVisionOn(st)).toBe(false);
    setLifeVision(true, st);
    expect(lifeVisionOn(st)).toBe(true);
    expect(lifeVisionOn({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
  });

  it('看圖的請求不問身分長相', () => {
    expect(VISION_PROMPT.zh_tw).toContain('不要猜人的身分');
    expect(VISION_PROMPT.en_us).toContain("don't guess who the person is");
  });

  it('規則：沒同意時照舊不能假裝看到；同意後把看到的告訴 AI，並提醒可能看錯', () => {
    expect(lifeRules(state, 'zh_tw')).toContain('不要假裝看到具體的東西');
    const on = lifeRules({ ...state, vision: true, sight: '主人手上拿著麵包' }, 'zh_tw');
    expect(on).toContain('剛才看到：主人手上拿著麵包');
    expect(on).toContain('可能看錯');
    expect(lifeRules({ ...state, vision: true, sight: '' }, 'ja_jp')).toContain('見えたふりをしないで');
    expect(lifeRules({ ...state, vision: true, sight: 'bread' }, 'en_us')).toContain('You just saw: bread');
    expect(lifeRules({ ...state, camera: false, vision: true, sight: '麵包' }, 'zh_tw')).not.toContain('麵包');
  });

  it('看到新東西是 AI 可以選擇不說話的事', () => {
    expect(lifeEventText('saw', 'zh_tw', '主人在吃麵包')).toContain('看到：主人在吃麵包');
    expect(DIRECT_EVENTS.has('saw')).toBe(false);
  });
});
