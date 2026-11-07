import { describe, expect, it } from 'vitest';
import { addressedTo, lifeEventText, lifeRules, overheardText, parseLifeReply, REPLY_WINDOW, type LifeState } from './life';
import { monitorLog, monitorOn, setMonitor } from './monitor';

const state: LifeState = { doing: '輕輕飄著', where: '中間', energy: 95, hunger: 20, asleep: false, recent: [], voice: true, cake: false, mic: true, camera: false };

describe('狀態數字不念出來', () => {
  it('回答裡的「元気95/100」之類拿掉', () => {
    expect(parseLifeReply('[開心] 元気95/100！今日もがんばるよ', 'ja_jp').text).toBe('！今日もがんばるよ'.replace(/^！/, '！'));
    expect(parseLifeReply('我好有精神（精神：95/100）', 'zh_tw').text).toBe('我好有精神');
    expect(parseLifeReply("I'm full of energy (energy 95/100)", 'en_us').text).toBe("I'm full of energy");
  });
  it('給 AI 的狀態用文字、不用數字', () => {
    const s = lifeRules(state, 'zh_tw');
    expect(s).toContain('精神很好、肚子很餓');
    expect(s).not.toMatch(/\d+\/100/);
    expect(lifeRules(state, 'ja_jp')).toContain('元気はげんき');
  });
});

describe('鏡頭前有動靜不等於主人回來', () => {
  it('出現、離開的說法不說「回來」', () => {
    expect(lifeEventText('appear', 'zh_tw')).toContain('不一定是剛回來');
    expect(lifeEventText('left', 'zh_tw')).toContain('也可能只是靜靜坐著');
  });
});

describe('第四階段：是不是在跟她說話', () => {
  it('叫名字、叫悅靈、她剛說完話才算', () => {
    expect(addressedTo('小藍你在幹嘛', '小藍', 999)).toBe(true);
    expect(addressedTo('悅靈過來', '小藍', 999)).toBe(true);
    expect(addressedTo('媽媽晚餐吃什麼', '小藍', 999)).toBe(false);
    expect(addressedTo('好啊', '小藍', REPLY_WINDOW - 1)).toBe(true);
  });
  it('聽到的話交給 AI 判斷，不是對她說的就安靜', () => {
    expect(overheardText('晚餐吃什麼', 'zh_tw')).toContain('[不說話]');
    expect(overheardText('dinner?', 'en_us')).toContain('[quiet]');
    expect(parseLifeReply('[不說話]', 'zh_tw')).toMatchObject({ text: '', quiet: true });
  });
});

describe('觀察紀錄開關', () => {
  it('預設關，關著時不記', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(monitorOn(st)).toBe(false);
    setMonitor(true, st);
    expect(monitorOn(st)).toBe(true);
    expect(() => monitorLog('x', {})).not.toThrow();
  });
});
