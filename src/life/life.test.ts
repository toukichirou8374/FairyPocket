import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INTENT_MENU, INTENTS, intentFrom, intentName, isLifeSlot, lifeEventText, lifeRules, parseLifeReply, retryDelay, type LifeState } from './life';
import type { AllayModel } from '../three/allayModel';
import { AllayController } from '../three/allayController';
import { createPet } from '../game/state';

const state: LifeState = { doing: '輕輕飄著', where: '中間', energy: 80, hunger: 70, asleep: false, recent: [], voice: false, cake: false, mic: false, camera: false };

describe('AI 生命模式：意圖與回答', () => {
  it('三種語言的意圖名稱都認得，而且跟代號一一對應', () => {
    for (const lang of ['zh_tw', 'ja_jp', 'en_us'] as const) {
      expect(INTENT_MENU[lang]).toHaveLength(INTENTS.length);
      for (const i of INTENTS) expect(intentFrom(intentName(i, lang))).toBe(i);
    }
    expect(intentFrom('explore_left')).toBe('explore_left');
    expect(intentFrom('飛去月球')).toBeNull();
  });

  it('解析意圖、動作、不說話標籤；不在白名單的忽略', () => {
    const r = parseLifeReply('[開心] 我去那邊看看！[意圖：去左邊看看][動作：揮右手]', 'zh_tw');
    expect(r).toMatchObject({ text: '我去那邊看看！', intent: 'explore_left', actions: ['wave_right'], feeling: 'happy', quiet: false });
    const q = parseLifeReply('[不說話][意圖：休息]', 'zh_tw');
    expect(q).toMatchObject({ text: '', intent: 'rest', quiet: true });
    expect(parseLifeReply('[意圖：飛去月球] 嗯', 'zh_tw').intent).toBeNull();
    // 只做動作、不說話也可以
    expect(parseLifeReply('[intent: observe]', 'en_us')).toMatchObject({ text: '', intent: 'observe' });
    // 對話紀錄的寫法被學去也拿掉
    expect(parseLifeReply('好呀（意圖：跳舞）', 'zh_tw').text).toBe('好呀');
  });

  it('生命模式規則：有意圖清單、可以安靜、不編造回憶、文字模式沒聲音時會說明', () => {
    const s = lifeRules(state, 'zh_tw');
    expect(s).toContain('四處探索');
    expect(s).toContain('[不說話]');
    expect(s).toContain('不要編造');
    expect(s).toContain('只會顯示成文字');
    expect(lifeRules({ ...state, voice: true }, 'zh_tw')).not.toContain('只會顯示成文字');
    expect(lifeRules({ ...state, cake: true }, 'ja_jp')).toContain('ケーキをたべにいく');
  });

  it('發生的事的文字（三種語言）與重試間隔', () => {
    expect(lifeEventText('fed', 'zh_tw', '蘋果')).toBe('（主人餵你吃了蘋果）');
    expect(lifeEventText('petted', 'en_us')).toContain('petted');
    expect([1, 2, 3, 4, 5, 10].map(retryDelay)).toEqual([30, 60, 120, 240, 300, 300]);
    expect(isLifeSlot('lifetext')).toBe(true);
    expect(isLifeSlot('aitext')).toBe(false);
    expect(isLifeSlot(null)).toBe(false);
  });
});

describe('AI 生命模式：精靈控制器', () => {
  /** 測試用的悅靈模型（只有控制器會動到的部分，不需要畫面） */
  const fakeModel = (): AllayModel => {
    const o = () => new THREE.Object3D();
    const m = { root: o(), tilt: o(), head: o(), body: o(), armL: o(), armR: o(), wingL: o(), wingR: o(), setEyes: () => {}, setWings: () => {} };
    return m as unknown as AllayModel;
  };
  const make = () => {
    const camera = new THREE.PerspectiveCamera(42, 0.5, 0.1, 100);
    camera.position.set(0, 1.6, 5.4);
    const pet = createPet(Date.now());
    let idle = 0;
    const said: string[] = [];
    const c = new AllayController(
      fakeModel(),
      { camera, bounds: () => ({ minX: -1.5, maxX: 1.5, minY: 0.45, maxY: 2, minZ: -1.6, maxZ: 1 }), night: () => false },
      pet,
      { say: (k) => said.push(k), particle: () => {}, caught: () => {}, lifeIdle: () => idle++ },
    );
    return { c, pet, said, idle: () => idle };
  };

  it('生命模式閒下來時不自己亂決定，而是請 AI 決定', () => {
    const { c, idle } = make();
    c.setLife(true);
    for (let i = 0; i < 200; i++) c.update(0.05);
    expect(idle()).toBeGreaterThan(0);
    expect(c.mode).toBe('idle');
  });

  it('照意圖行動；睡著時只聽「起床」；生命模式不會自己醒來或自己去睡', () => {
    const { c, pet, said } = make();
    c.setLife(true);
    c.intend('explore_left');
    expect(c.mode).toBe('wander');
    expect(c.target.x).toBeLessThan(0);
    c.intend('sleep');
    expect(c.mode).toBe('sleep');
    expect(pet.asleep).toBe(true);
    c.intend('explore');
    expect(c.mode).toBe('sleep');
    pet.energy = 100;
    for (let i = 0; i < 800; i++) c.update(0.05);
    expect(c.mode).toBe('sleep');
    c.intend('wake');
    expect(c.mode).toBe('waking');
    pet.energy = 5;
    c.intend('rest');
    for (let i = 0; i < 100; i++) c.update(0.05);
    expect(c.mode).toBe('rest');
    expect(said).toEqual([]);
  });

  it('一般模式照舊：閒下來自己決定、不會呼叫 AI', () => {
    const { c, idle } = make();
    for (let i = 0; i < 400; i++) c.update(0.05);
    expect(idle()).toBe(0);
  });
});

describe('AI 生命模式：實機回報的問題', () => {
  it('各種寫法的心情、意圖標籤都不會念出來', () => {
    const cases = [
      '[心情：開心] 今天好舒服。[意圖：去右邊看看]',
      '【心情 開心】今天好舒服。【意圖 去右邊看看】',
      '[意図：みぎへいく] 今天好舒服。',
      '今天好舒服。(intent: go right)',
      '［意圖：去右邊看看］今天好舒服。［思考中］',
    ];
    for (const c of cases) {
      const r = parseLifeReply(c, 'zh_tw');
      expect(r.text).toBe('今天好舒服。');
      expect(r.intent).toBe('explore_right');
    }
    expect(parseLifeReply('[心情：開心] 好耶', 'zh_tw').feeling).toBe('happy');
  });

  it('中文設定卻回日文會被發現；別的語言的舊對話不給 AI 看', async () => {
    const { mixedLanguage, recentTurns } = await import('../brain/brain');
    expect(mixedLanguage('きょうはいい天気だね', 'zh_tw')).toBe(true);
    expect(mixedLanguage('今天天氣真好', 'zh_tw')).toBe(false);
    const now = Date.now();
    const mem = { notes: [], turns: [{ who: 'allay' as const, text: 'こんにちは', at: now }, { who: 'user' as const, text: '你好', at: now }] };
    expect(recentTurns(mem, now, 'zh_tw').map((t) => t.text)).toEqual(['你好']);
    expect(lifeRules(state, 'zh_tw')).toContain('絕對不要用日文');
  });

  it('發呆、自己過生活時不會一直盯著畫面；主人互動時才看主人', () => {
    const camera = new THREE.PerspectiveCamera(42, 0.5, 0.1, 100);
    camera.position.set(0, 1.6, 5.4);
    const o = () => new THREE.Object3D();
    const model = { root: o(), tilt: o(), head: o(), body: o(), armL: o(), armR: o(), wingL: o(), wingR: o(), setEyes: () => {}, setWings: () => {} } as unknown as AllayModel;
    const c = new AllayController(model, { camera, bounds: () => ({ minX: -1.5, maxX: 1.5, minY: 0.45, maxY: 2, minZ: -1.6, maxZ: 1 }), night: () => false }, createPet(Date.now()), { say: () => {}, particle: () => {}, caught: () => {} });
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    c.setLife(true);
    c.intend('daydream');
    let away = 0;
    for (let i = 0; i < 600; i++) {
      c.update(0.05);
      // 模型的 y 旋轉：0 附近＝面向畫面
      if (Math.abs(wrap(model.root.rotation.y)) > 0.6) away++;
    }
    expect(away).toBeGreaterThan(200);
    c.attend(10);
    for (let i = 0; i < 60; i++) c.update(0.05);
    expect(Math.abs(wrap(model.root.rotation.y))).toBeLessThan(0.4);
  });
});
