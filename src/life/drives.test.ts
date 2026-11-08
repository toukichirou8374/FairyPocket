import { describe, expect, it } from 'vitest';
import { Habituation, drivesPrefer, drivesText, interacted, newActivity, newDrives, repeatText, tickDrives } from './drives';
import { availableIntents, lifeRules, type LifeState } from './life';

describe('內在需求（來自真的發生的事，不是隨機）', () => {
  it('一直做差不多的事會無聊；換一件不一樣的就好了', () => {
    const d = newDrives();
    tickDrives(d, 6 * 60, false);
    expect(d.boredom).toBe(1);
    expect(drivesText(d, 'zh_tw')).toContain('有點無聊');
    newActivity(d, 'sing', ['sing']);
    expect(d.boredom).toBeGreaterThan(0.9);
    // 兩件事輪流做也不算新鮮
    newActivity(d, 'groom', ['groom', 'sing']);
    expect(d.boredom).toBeGreaterThan(0.8);
    newActivity(d, 'explore', ['groom', 'sing']);
    expect(d.boredom).toBeLessThan(0.5);
  });
  it('很久沒人互動會想家人；互動之後就滿足', () => {
    const d = newDrives();
    tickDrives(d, 15 * 60, false);
    expect(drivesText(d, 'zh_tw')).toContain('想念');
    expect(drivesPrefer(d, [])).toContain('approach');
    interacted(d);
    interacted(d);
    expect(drivesText(d, 'zh_tw')).toContain('心滿意足');
  });
  it('睡覺時不會變', () => {
    const d = newDrives();
    tickDrives(d, 600, true);
    expect(d).toEqual(newDrives());
  });
  it('無聊時，最近沒做過的活動排前面', () => {
    const d = { boredom: 0.9, lonely: 0.3 };
    expect(drivesPrefer(d, ['explore', 'search'])).toEqual(['patrol', 'dance', 'sing', 'inspect']);
  });
  it('重複的刺激：幾分鐘內第 3 次起告訴 AI', () => {
    const h = new Habituation();
    const t = 1_000_000;
    expect(h.count('petted', t)).toBe(1);
    h.count('petted', t + 1000);
    const n = h.count('petted', t + 2000);
    expect(repeatText(n, 'zh_tw')).toBe('（這幾分鐘內第 3 次了）');
    expect(h.count('petted', t + 10 * 60_000)).toBe(1);
  });
  it('規則裡有現在的感覺；有東西才能「去看看附近的東西」', () => {
    const st: LifeState = { doing: '輕輕飄著', where: '中間', energy: 70, hunger: 60, asleep: false, recent: [], voice: true, cake: false, mic: false, camera: false, drives: '有點無聊了' };
    expect(lifeRules(st, 'zh_tw')).toContain('現在的感覺：有點無聊了');
    expect(availableIntents({ cake: false, asleep: false })).not.toContain('inspect');
    expect(availableIntents({ cake: false, asleep: false, things: 2 })).toContain('inspect');
  });
});

import { lifeMenuNames } from './life';
describe('無聊時最近做過的暫時不想做', () => {
  it('清單裡拿掉最近做過的（休息、睡覺除外）', () => {
    const st: LifeState = { doing: '', where: '', energy: 70, hunger: 60, asleep: false, recent: [], voice: true, cake: false, mic: false, camera: false, avoid: ['groom', 'patrol', 'rest'] };
    const m = lifeMenuNames(st, 'zh_tw');
    expect(m).not.toContain('整理翅膀');
    expect(m).not.toContain('繞一圈巡邏');
    expect(m).toContain('休息');
  });
});
