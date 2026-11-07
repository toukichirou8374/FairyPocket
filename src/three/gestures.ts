// AI 可以選的「動作」：直接控制悅靈的手、翅膀、頭、身體（不靠一般系統的固定反應）。
// 例如：學主人舉右手、害羞遮臉、點頭、搖頭、拍手、鞠躬。
// AI 在回答裡加「[動作：舉右手]」這樣的標籤（最多 2 個），App 依序做出來；名稱以外的字一律忽略（白名單）。

import * as THREE from 'three';
import type { AllayModel } from './allayModel';

/** 只動手、頭、翅膀的動作（悅靈停在原地、面向主人） */
export const LIMB_GESTURES = [
  'wave_right', 'wave_left', 'raise_right', 'raise_left', 'hands_up', 'cover_face', 'nod', 'shake_head', 'tilt_head',
  'clap', 'bow', 'think', 'point', 'hug', 'flap',
] as const;
/** 用原本的行為模式完成的動作（會移動、轉圈、跳舞） */
export const MOVE_GESTURES = ['spin', 'flip', 'dance', 'come', 'back', 'rest', 'happy', 'sad', 'look_around'] as const;
export type LimbGesture = (typeof LIMB_GESTURES)[number];
export type MoveGesture = (typeof MOVE_GESTURES)[number];
export type Gesture = LimbGesture | MoveGesture;

/** 每個動作的秒數 */
export const GESTURE_SEC: Record<Gesture, number> = {
  wave_right: 2.4, wave_left: 2.4, raise_right: 2.2, raise_left: 2.2, hands_up: 2.2, cover_face: 2.8, nod: 1.6, shake_head: 1.6,
  tilt_head: 2, clap: 2.2, bow: 2, think: 2.6, point: 2, hug: 2.4, flap: 2,
  spin: 1.6, flip: 1.6, dance: 5, come: 3, back: 1.5, rest: 5, happy: 2, sad: 2.5, look_around: 3,
};

/** AI 可能寫的名稱（三種語言＋英文代號）→ 動作 */
const NAMES: Record<string, Gesture> = {
  揮右手: 'wave_right', 揮左手: 'wave_left', 揮手: 'wave_right', 舉右手: 'raise_right', 舉左手: 'raise_left', 雙手舉高: 'hands_up', 舉雙手: 'hands_up', 萬歲: 'hands_up',
  遮臉: 'cover_face', 害羞遮臉: 'cover_face', 點頭: 'nod', 搖頭: 'shake_head', 歪頭: 'tilt_head', 拍手: 'clap', 鞠躬: 'bow', 想一想: 'think', 思考: 'think',
  指: 'point', 指前面: 'point', 抱抱: 'hug', 擁抱: 'hug', 拍翅膀: 'flap', 轉圈: 'spin', 翻跟斗: 'flip', 跳舞: 'dance', 靠近: 'come', 飛過來: 'come',
  退後: 'back', 休息: 'rest', 開心: 'happy', 難過: 'sad', 垂頭喪氣: 'sad', 張望: 'look_around', 東張西望: 'look_around',
  右手を振る: 'wave_right', 左手を振る: 'wave_left', 手を振る: 'wave_right', 右手を上げる: 'raise_right', 左手を上げる: 'raise_left', ばんざい: 'hands_up', 両手を上げる: 'hands_up',
  顔をかくす: 'cover_face', 顔を隠す: 'cover_face', うなずく: 'nod', 首をふる: 'shake_head', 首を振る: 'shake_head', 首をかしげる: 'tilt_head', 拍手する: 'clap', おじぎ: 'bow',
  かんがえる: 'think', 考える: 'think', 指さす: 'point', ぎゅっ: 'hug', はばたく: 'flap', くるくる: 'spin', 宙返り: 'flip', おどる: 'dance', 踊る: 'dance', ちかづく: 'come',
  さがる: 'back', やすむ: 'rest', よろこぶ: 'happy', しょんぼり: 'sad', きょろきょろ: 'look_around',
  'wave right': 'wave_right', 'wave left': 'wave_left', wave: 'wave_right', 'raise right hand': 'raise_right', 'raise left hand': 'raise_left', 'hands up': 'hands_up',
  'cover face': 'cover_face', nod: 'nod', 'shake head': 'shake_head', 'tilt head': 'tilt_head', clap: 'clap', bow: 'bow', think: 'think', point: 'point', hug: 'hug',
  flap: 'flap', spin: 'spin', flip: 'flip', dance: 'dance', come: 'come', back: 'back', rest: 'rest', happy: 'happy', sad: 'sad', 'look around': 'look_around',
};
for (const g of [...LIMB_GESTURES, ...MOVE_GESTURES]) NAMES[g] = g;

/** 標籤裡的名稱 → 動作（不認得就 null） */
export function gestureFrom(name: string): Gesture | null {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, (s) => (s.includes('_') ? '_' : ' '));
  return NAMES[n] ?? NAMES[n.replace(/ /g, '_')] ?? NAMES[name.trim()] ?? null;
}

export const isLimb = (g: Gesture): g is LimbGesture => (LIMB_GESTURES as readonly string[]).includes(g);

/** 給 AI 看的動作清單（用設定語言的名稱） */
export const GESTURE_MENU = {
  zh_tw: '揮右手、揮左手、舉右手、舉左手、雙手舉高、遮臉、點頭、搖頭、歪頭、拍手、鞠躬、想一想、指前面、抱抱、拍翅膀、轉圈、翻跟斗、跳舞、靠近、退後、休息、開心、難過、張望',
  ja_jp: '右手を振る、左手を振る、右手を上げる、左手を上げる、ばんざい、顔をかくす、うなずく、首をふる、首をかしげる、拍手する、おじぎ、かんがえる、指さす、ぎゅっ、はばたく、くるくる、宙返り、おどる、ちかづく、さがる、やすむ、よろこぶ、しょんぼり、きょろきょろ',
  en_us: 'wave right, wave left, raise right hand, raise left hand, hands up, cover face, nod, shake head, tilt head, clap, bow, think, point, hug, flap, spin, flip, dance, come, back, rest, happy, sad, look around',
} as const;

/** 對話紀錄裡標示「做過的動作」用的字 */
export const GESTURE_LABEL = { zh_tw: '動作', ja_jp: '動作', en_us: 'action' } as const;

/** 動作在各語言的名稱（與 GESTURE_MENU 同順序） */
export function gestureName(g: Gesture, lang: keyof typeof GESTURE_MENU): string {
  const all = [...LIMB_GESTURES, ...MOVE_GESTURES] as readonly Gesture[];
  const names = GESTURE_MENU[lang].split(lang === 'en_us' ? ', ' : '、');
  return names[all.indexOf(g)] ?? g;
}

/** 進場與退場的平滑程度（0～1） */
export function envelope(t: number, dur: number, edge = 0.35): number {
  const ease = (x: number) => x * x * (3 - 2 * x);
  return ease(Math.min(1, t / edge)) * ease(Math.min(1, Math.max(0, (dur - t) / edge)));
}

/**
 * 在原本的動畫之上套用手、頭、翅膀的動作（w＝0～1 的進退場比例）。
 * 悅靈的右手是 armR（模型的 -x 側）、左手是 armL。手臂 rotation.x 越負越往上舉；rotation.z 往外張。
 */
export function applyLimbGesture(m: AllayModel, g: LimbGesture, t: number, w: number): { eyes?: 'closed' | 'happy' } {
  const L = THREE.MathUtils.lerp;
  const set = (o: THREE.Object3D, x: number | null, y: number | null, z: number | null) => {
    if (x !== null) o.rotation.x = L(o.rotation.x, x, w);
    if (y !== null) o.rotation.y = L(o.rotation.y, y, w);
    if (z !== null) o.rotation.z = L(o.rotation.z, z, w);
  };
  const s = Math.sin(t * 9);
  switch (g) {
    case 'wave_right':
      set(m.armR, -2.6, null, -0.25 + s * 0.5);
      m.tilt.rotation.z += s * 0.06 * w;
      return { eyes: 'happy' };
    case 'wave_left':
      set(m.armL, -2.6, null, 0.25 - s * 0.5);
      m.tilt.rotation.z -= s * 0.06 * w;
      return { eyes: 'happy' };
    case 'raise_right':
      set(m.armR, -2.9, 0, -0.15);
      return {};
    case 'raise_left':
      set(m.armL, -2.9, 0, 0.15);
      return {};
    case 'hands_up':
      set(m.armR, -2.9, 0, -0.45);
      set(m.armL, -2.9, 0, 0.45);
      m.root.position.y += Math.abs(Math.sin(t * 5)) * 0.08 * w;
      return { eyes: 'happy' };
    case 'cover_face':
      // 雙手舉到臉前、往內收，低頭、身體輕輕扭
      set(m.armR, -2.25, 0.35, 0.35);
      set(m.armL, -2.25, -0.35, -0.35);
      set(m.head, 0.35, Math.sin(t * 2.5) * 0.15, null);
      m.tilt.rotation.z += Math.sin(t * 2.5) * 0.06 * w;
      return { eyes: 'closed' };
    case 'nod':
      set(m.head, 0.35 * Math.abs(Math.sin(t * 7)), 0, 0);
      return {};
    case 'shake_head':
      set(m.head, 0.05, Math.sin(t * 11) * 0.55, 0);
      return {};
    case 'tilt_head':
      set(m.head, null, null, 0.45);
      return {};
    case 'clap': {
      const c = 0.12 + (0.5 + 0.5 * Math.sin(t * 16)) * 0.45;
      set(m.armR, -1.45, 0, -c + 0.1);
      set(m.armL, -1.45, 0, c - 0.1);
      return { eyes: 'happy' };
    }
    case 'bow':
      m.tilt.rotation.x = L(m.tilt.rotation.x, 0.55 * Math.sin(Math.min(1, t / 1.2) * Math.PI), w);
      set(m.head, 0.3, 0, 0);
      return { eyes: 'closed' };
    case 'think':
      set(m.armR, -2.1, 0.5, 0.45);
      set(m.head, 0.1, 0.25, 0.3);
      return {};
    case 'point':
      set(m.armR, -1.6, 0, 0);
      return {};
    case 'hug': {
      const close = Math.min(1, t / 1.2);
      set(m.armR, -1.35, 0, L(-0.9, -0.15, close));
      set(m.armL, -1.35, 0, L(0.9, 0.15, close));
      return { eyes: 'happy' };
    }
    case 'flap': {
      const spread = Math.PI / 4 - Math.cos(t * 22) * 0.9;
      m.setWings(L(m.wingL.rotation.y * -1, spread, w), m.wingL.rotation.x);
      m.root.position.y += Math.abs(Math.sin(t * 11)) * 0.06 * w;
      return {};
    }
  }
}
