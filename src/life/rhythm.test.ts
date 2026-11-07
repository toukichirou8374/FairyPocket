import { describe, expect, it } from 'vitest';
import { HABITS, addLog, awayText, bumpLike, dayPhase, rhythmText, sleepTime, sleptWhileAway, todayLog, topLikes, type LogEntry, type Likes } from './rhythm';
import { DIRECT_EVENTS, lifeEventText, lifeRules, type LifeState } from './life';

const at = (h: number, m = 0, day = 8) => new Date(2026, 10, day, h, m).getTime();
const state: LifeState = { doing: '輕輕飄著', where: '中間', energy: 70, hunger: 50, asleep: false, recent: [], voice: true, cake: false, mic: false, camera: false };

describe('生活節奏（第二階段）', () => {
  it('依個性的作息：睡覺時間、一天的時段', () => {
    const g = HABITS.guardian;
    expect(sleepTime(22, g)).toBe(true);
    expect(sleepTime(3, g)).toBe(true);
    expect(sleepTime(6, g)).toBe(false);
    expect(dayPhase(7, g)).toBe('morning');
    expect(dayPhase(13, g)).toBe('day');
    expect(dayPhase(18, g)).toBe('evening');
    expect(dayPhase(20, g)).toBe('bedtime');
    expect(dayPhase(23, g)).toBe('night');
    expect(HABITS.playful.bed).toBeGreaterThan(HABITS.cautious.bed);
    expect(rhythmText(23, g, 'zh_tw')).toContain('平常睡覺的時間');
    expect(rhythmText(7, HABITS.brave, 'en_us')).toContain('wake around 6:00');
  });

  it('離開後回來：說過了多久、跨過晚上就應該在睡覺、不編造', () => {
    const g = HABITS.guardian;
    expect(sleptWhileAway(at(13), at(15), g)).toBe(false);
    expect(sleptWhileAway(at(20), at(7, 0, 9), g)).toBe(true);
    const zh = awayText(at(20), at(7, 0, 9), g, 'zh_tw');
    expect(zh).toContain('大約 11 個小時');
    expect(zh).toContain('應該在睡覺');
    expect(zh).toContain('不要編造');
    expect(awayText(at(13), at(13, 40), g, 'zh_tw')).toContain('40 分鐘');
    expect(awayText(at(13), at(15), g, 'en_us')).not.toContain('asleep');
    expect(DIRECT_EVENTS.has('back')).toBe(true);
    expect(lifeEventText('back', 'zh_tw', zh)).toBe(zh);
  });

  it('今天真的發生過的事：只有今天、同語言，前面有時間；不重複記', () => {
    const log: LogEntry[] = [];
    addLog(log, '（主人餵你吃了蘋果）', 'zh_tw', at(8, 5));
    addLog(log, '（主人餵你吃了蘋果）', 'zh_tw', at(8, 6));
    addLog(log, '(Your friend petted your head)', 'en_us', at(9));
    addLog(log, '（主人摸了摸你的頭）', 'zh_tw', at(7, 0, 7));
    addLog(log, '（主人摸了摸你的頭）', 'zh_tw', at(10, 30));
    expect(todayLog(log, 'zh_tw', at(12))).toEqual(['8:05 主人餵你吃了蘋果', '10:30 主人摸了摸你的頭']);
  });

  it('喜好：常做的事會變成喜好，作息類不算，舊的慢慢變淡', () => {
    const l: Likes = {};
    for (let i = 0; i < 4; i++) bumpLike(l, 'sing');
    for (let i = 0; i < 5; i++) bumpLike(l, 'sleep');
    bumpLike(l, 'explore');
    expect(topLikes(l)).toEqual(['sing']);
    expect(l.sing).toBeLessThan(4);
  });

  it('規則裡有作息、今天的事、喜好、記得的事', () => {
    const s = lifeRules({ ...state, rhythm: '作息：測試', today: ['8:05 主人餵你吃了蘋果'], likes: ['哼歌'], hasNotes: true }, 'zh_tw');
    expect(s).toContain('作息：測試');
    expect(s).toContain('今天真的發生過的事（可以提起，但不要編造其他的）：8:05 主人餵你吃了蘋果');
    expect(s).toContain('應該是你喜歡的事：哼歌');
    expect(s).toContain('主人喜歡恐龍');
    expect(lifeRules(state, 'zh_tw')).not.toContain('今天真的發生過的事');
  });
});
