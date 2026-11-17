// AI 3.0 語音修復的測試。實際例子來自 2026-11-15 的生命觀察紀錄（家人的名字已換成〔名前〕）。
import { describe, expect, it } from 'vitest';
import { echoOf, FinalGate, HearTrace, HeldFinal, similarity } from './hearing';
import { isEcho } from './persona';

/** 修正前的比對方式（只看字的重複比例）：用來證明舊方法會誤判 */
function oldIsEcho(heard: string, said: readonly string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const h = norm(heard);
  if (h.length < 2) return false;
  return said.some((x) => {
    const s = norm(x);
    if (s.length < 2) return false;
    if (s.includes(h) || h.includes(s)) return true;
    const pool = [...s];
    let same = 0;
    for (const c of h) {
      const i = pool.indexOf(c);
      if (i >= 0) {
        same++;
        pool.splice(i, 1);
      }
    }
    return same / Math.max(h.length, 1) >= 0.6 && h.length >= 3;
  });
}

// 11-15 00:47:40 前 30 秒內她說過的話
const SAID_0747 = ['はー！こんにちは！ぼく、うれしいな。', 'えっ、いくの？って、いろんなものがならんでるところだよね。ぼくはさっき、たからものコーナーのアメジストを見てたんだ。'];
// 11-15 00:49:18 前她說過的話
const SAID_0749 = ['えっ、なまえのこと？ぼく、さっき〔名前〕に名前をおしえてもらって、うれしかったんだ。だから、ぼくのなまえもおぼえてね！'];

describe('回音判斷（家人的話不再被當成她自己的聲音）', () => {
  it('11-15 實際例子：舊方法誤判成回音，新方法不會', () => {
    expect(oldIsEcho('いつも行きたいって言ってるよー', SAID_0747)).toBe(true);
    expect(echoOf('いつも行きたいって言ってるよー', SAID_0747)).toBe(false);
    expect(echoOf('名前は名前はあなたの名前は', SAID_0749)).toBe(false);
  });
  it('真的回音（喇叭又被收進來）照樣濾掉', () => {
    expect(echoOf('でパトロールしに行く', ['ちょっとパトロールしに行くね！'])).toBe(true);
    expect(echoOf('うれしいな', SAID_0747)).toBe(true);
    expect(echoOf('這首歌我很喜歡呢', ['嘿嘿，這首歌我很喜歡。'])).toBe(true);
    expect(echoOf('i love this song', ['Hehe, I love this song!'])).toBe(true);
  });
  it('原本的測試照樣通過（persona.isEcho 改用新方法）', () => {
    expect(isEcho('嘿嘿嗨', ['嘿嘿，嗨！'])).toBe(true);
    expect(isEcho('慢走', ['慢走～'])).toBe(true);
    expect(isEcho('那我去洗澡了', ['慢走～', '嘿嘿，嗨！'])).toBe(false);
    expect(isEcho('嗨', ['嘿嘿，嗨！'])).toBe(false);
    expect(isEcho('你在做什麼', [])).toBe(false);
  });
  it('中文、英文：家人的話不會因為有幾個一樣的字就被丟掉', () => {
    expect(echoOf('我今天去公司了好累', ['今天天氣很好，我們去公園吧！'])).toBe(false);
    expect(echoOf('what are you doing now', ['I am looking at the flowers now.'])).toBe(false);
  });
  it('相似度：同一句高、不同句低', () => {
    expect(similarity('こんばんは', 'こんばんは')).toBe(1);
    expect(similarity('今日は寒いね', 'テレビかぁ')).toBe(0);
  });
});

describe('同一句話不送兩次', () => {
  it('11-15 實際例子：「1時」→ 370 毫秒後「1時マイク」＝同一句的修正（不是新的一句）', () => {
    const g = new FinalGate();
    expect(g.offer('1時', 1000)).toBe('new');
    expect(g.offer('1時マイク', 1370)).toBe('extend');
  });
  it('11-11 實際例子：「こんばんは」→「〇〇こんばんは」＝修正', () => {
    const g = new FinalGate();
    expect(g.offer('こんばんは', 0)).toBe('new');
    expect(g.offer('ネロこんばんは', 146)).toBe('extend');
  });
  it('一模一樣、或是上一句的一部分＝重複', () => {
    const g = new FinalGate();
    expect(g.offer('你好嗎', 0)).toBe('new');
    expect(g.offer('你好嗎？', 500)).toBe('dup');
    expect(g.offer('好嗎', 800)).toBe('dup');
  });
  it('隔 3 秒以上、或完全不同的話＝新的一句', () => {
    const g = new FinalGate();
    expect(g.offer('おはよう', 0)).toBe('new');
    expect(g.offer('おはよう', 3500)).toBe('new');
    expect(g.offer('今からでかけるね', 3600)).toBe('new');
  });
});

describe('她說話時聽到的話先留著', () => {
  it('只留最新的一句；10 秒以上就不要了', () => {
    const h = new HeldFinal();
    h.hold('a', ['a'], 0);
    h.hold('b', ['b'], 100);
    expect(h.take(5000)).toEqual({ text: 'b', alts: ['b'] });
    expect(h.take(5000)).toBeNull();
    h.hold('c', ['c'], 0);
    expect(h.take(10_001)).toBeNull();
  });
});

describe('可觀察的階段', () => {
  it('記錄走到第幾步、各種結果的次數，不放內容', () => {
    const tr = new HearTrace();
    expect(tr.reached()).toBe(0);
    for (const s of ['permission', 'listening', 'speech', 'recognizing', 'final', 'routed'] as const) tr.mark(s, 1);
    expect(tr.reached()).toBe(6);
    tr.mark('echo', 2, '5ch');
    tr.mark('error', 3, 'no-speech');
    tr.mark('accepted', 4, 'local:900ms');
    tr.mark('shown', 5, 'voice');
    expect(tr.reached()).toBe(8);
    expect(tr.summary()).toContain('echo 1');
    expect(tr.summary()).toContain('no-speech');
    for (let i = 0; i < 60; i++) tr.mark('end', i);
    expect(tr.marks.length).toBe(40);
  });
});
