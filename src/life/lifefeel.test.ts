// 生命感改善（2026-11-08 診斷後）：持續的活動、不叫主人、聲音名字、選單順序、括號動作
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AllayModel } from '../three/allayModel';
import { AllayController } from '../three/allayController';
import { createPet } from '../game/state';
import { availableIntents, lifeRules, parseLifeReply, PREFER, type LifeState } from './life';
import { lifeSystem, nameTag, pickHeard } from './persona';
import { personDistance, identify, learn, addPerson, type Person } from '../voiceId';
import { treasureList } from './rhythm';

const setup = () => {
  const camera = new THREE.PerspectiveCamera(42, 0.5, 0.1, 100);
  camera.position.set(0, 1.6, 5.4);
  const o = () => new THREE.Object3D();
  const model = { root: o(), tilt: o(), head: o(), body: o(), armL: o(), armR: o(), wingL: o(), wingR: o(), setEyes: () => {}, setWings: () => {} } as unknown as AllayModel;
  let idles = 0;
  let searched = 0;
  const c = new AllayController(model, { camera, bounds: () => ({ minX: -1.5, maxX: 1.5, minY: 0.45, maxY: 2, minZ: -1.6, maxZ: 1 }), night: () => false }, createPet(Date.now()), {
    say: () => {},
    particle: () => {},
    caught: () => {},
    lifeIdle: () => idles++,
    searched: () => searched++,
  });
  c.setLife(true);
  return { c, idles: () => idles, searched: () => searched };
};
const run = (c: AllayController, sec: number) => {
  for (let i = 0; i < sec * 20; i++) c.update(0.05);
};

describe('持續的活動（以前每個意圖只做幾秒就回去等 AI）', () => {
  it('選了「去左邊看看」：在左邊換好幾個點慢慢逛，40 秒內不會回去問 AI', () => {
    const h = setup();
    h.c.intend('explore_left');
    const xs: number[] = [];
    for (let i = 0; i < 38; i++) {
      run(h.c, 1);
      xs.push(h.c.pos.x);
    }
    expect(h.idles()).toBe(0);
    expect(h.c.activity?.i).toBe('explore_left');
    expect(xs.slice(10).every((x) => x < 0.2)).toBe(true);
  });
  it('做完整段才問 AI 下一步', () => {
    const h = setup();
    h.c.intend('groom');
    run(h.c, 60);
    expect(h.idles()).toBeGreaterThan(0);
    expect(h.c.activity).toBeNull();
  });
  it('找東西會找好幾個地方', () => {
    const h = setup();
    h.c.intend('search');
    run(h.c, 45);
    expect(h.searched()).toBeGreaterThanOrEqual(2);
  });
  it('被打斷（短短的動作）之後回到原本的活動', () => {
    const h = setup();
    h.c.intend('sing');
    run(h.c, 5);
    h.c.gesture(['nod']);
    run(h.c, 5);
    expect(h.c.activity?.i).toBe('sing');
  });
  it('AI 連不上時，手上的活動多做一會兒（不會突然停住）', () => {
    const h = setup();
    h.c.intend('patrol');
    const left = h.c.activity!.leftSec;
    h.c.extendActivity(200);
    expect(h.c.activity!.leftSec).toBeGreaterThan(left);
  });
});

describe('選單：個性喜歡的排前面、「靠近家人」放最後', () => {
  it('不同個性的清單開頭不一樣', () => {
    const play = availableIntents({ cake: false, asleep: false, prefer: PREFER.playful });
    const shy = availableIntents({ cake: false, asleep: false, prefer: PREFER.cautious });
    expect(play.slice(0, 3)).toEqual(['sing', 'dance', 'play']);
    expect(shy[0]).toBe('peek');
    expect(play.at(-1)).toBe('approach');
    expect(play).not.toContain('treasure');
    expect(availableIntents({ cake: false, asleep: false, treasures: 2 })).toContain('treasure');
  });
});

describe('不叫主人、用名字', () => {
  const pet = createPet(Date.now());
  it('生命模式的設定明說不叫主人；認得聲音就說是誰', () => {
    const s = lifeSystem(pet, { speaker: 'いつき', family: ['いつき', '媽媽'], notes: [] }, 'zh_tw');
    expect(s).toContain('絕對不要叫任何人「主人」');
    expect(s).toContain('現在說話的應該是「いつき」');
    expect(s).toContain('家人的名字：いつき、媽媽');
    expect(s).toContain('你不是助理');
    expect(lifeSystem(pet, { speaker: null, family: [], notes: [] }, 'ja_jp')).toContain('「主人」「ご主人さま」とは絶対に呼ばないで');
  });
  it('生命模式的規則與事件不再用「主人」', () => {
    const st: LifeState = { doing: '哼歌', where: '中間', energy: 70, hunger: 60, asleep: false, recent: [], voice: true, cake: false, mic: true, camera: true };
    expect(lifeRules(st, 'zh_tw')).not.toContain('主人');
  });
  it('自我介紹的名字標籤、語音辨識候選裡挑有家人名字的', () => {
    expect(nameTag('好喔！[名字：いつき]')).toBe('いつき');
    expect(nameTag('[名字：主人]')).toBeNull();
    expect(pickHeard(['一機', 'いつき來了'], ['いつき'])).toBe('いつき來了');
    expect(pickHeard(['你好'], ['いつき'])).toBe('你好');
  });
});

describe('聲音辨識：每個人存好幾段話的特徵（只在這台裝置）', () => {
  const v = (base: number, wob: number) => Array.from({ length: 27 }, (_, i) => base + Math.sin(i + wob) * 0.3);
  it('同一個人不同狀態的聲音，用多段樣本比只用平均更容易認出', () => {
    const people: Person[] = [];
    const p = addPerson(people, 'いつき', v(1, 0));
    learn(p, v(1.8, 1));
    learn(p, v(1.9, 2));
    learn(p, v(2, 3));
    expect(p.samples?.length).toBe(4);
    const near = v(2, 3.1);
    expect(personDistance(p, near)).toBeLessThanOrEqual(Math.max(0, personDistance({ ...p, samples: [] }, near)));
    expect(identify(people, near).person?.name).toBe('いつき');
  });
});

describe('說話不外洩', () => {
  it('括號裡的動作變成身體動作、不念出來', () => {
    const r = parseLifeReply('嗯…好啊 (點頭)', 'zh_tw');
    expect(r.text).toBe('嗯…好啊');
    expect(r.actions).toContain('nod');
    expect(parseLifeReply('真的嗎（拍拍手）', 'zh_tw').text).toBe('真的嗎');
  });
  it('收藏清單', () => {
    expect(treasureList({ feather: 2, bead: 1 }, 'zh_tw')).toEqual(['小羽毛×2', '亮晶晶的玻璃珠']);
  });
});

import { isEcho } from './persona';
describe('不把自己的聲音當成有人在說話', () => {
  it('聽到跟她剛說的話很像，就是自己的聲音', () => {
    expect(isEcho('嘿嘿嗨', ['嘿嘿，嗨！'])).toBe(true);
    expect(isEcho('慢走', ['慢走～'])).toBe(true);
    expect(isEcho('這首歌我很喜歡呢', ['嘿嘿，這首歌我很喜歡。'])).toBe(true);
    expect(isEcho('那我去洗澡了', ['慢走～', '嘿嘿，嗨！'])).toBe(false);
    expect(isEcho('嗨', ['嘿嘿，嗨！'])).toBe(false);
    expect(isEcho('你在做什麼', [])).toBe(false);
  });
});
