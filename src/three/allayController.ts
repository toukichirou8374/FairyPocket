// 悅靈的行為大腦、飛行運動與動作動畫。

import * as THREE from 'three';
import type { AllayModel } from './allayModel';
import type { LineKind } from '../game/dialogue';
import { moodLevel, PERSONALITY_COLOR, type Personality, type PetState } from '../game/state';
import { applyLimbGesture, envelope, GESTURE_SEC, isLimb, type Gesture, type LimbGesture } from './gestures';

/** 性格粒子：每 2 秒在身邊冒出代表色粉塵；每 6 秒檢查一次，偶爾灑出一圈稀疏的粉塵 */
const AURA_EVERY = 2;
const SPARSE_EVERY = 6;
const SPARSE_CHANCE = 0.4;

export type Mode =
  | 'idle' | 'wander' | 'approach' | 'called' | 'rest' | 'sleep'
  | 'play' | 'eat' | 'happy' | 'tickled' | 'startled' | 'curious' | 'waking' | 'dance'
  | 'observe' | 'flourish' | 'cake' | 'listen' | 'wave' | 'toBed' | 'bath' | 'watch'
  /** 小遊戲：答錯時懊惱（抱頭搖頭）、答對時翻跟斗 */
  | 'oops' | 'flip';

/** 聽到音符後跳舞的秒數（每次彈奏都會重新計時） */
const DANCE_TIME = 10;
/** 晚上被叫醒後再醒著多久（秒） */
const BEDTIME_GRACE = 120;

interface Traits {
  speed: number; // 最高飛行速度
  range: number; // 遊蕩範圍倍率
  nearDist: number; // 靠近玩家時的距離
  wander: number; // 以下為 decide() 的權重
  approach: number;
  spin: number;
  observe: number; // 停下來東張西望
  flourish: number; // 即興繞圈飛舞
  stay: number; // 靠近玩家後停留秒數
  startle: number; // 被突然叫醒時受驚的機率
  tempo: number; // 動作節奏（翅膀、上下浮動、手臂擺動的快慢）
  look: [min: number, max: number]; // 每次觀察的秒數
  sweep: number; // 觀察時轉頭的速度
}

// 守護：溫柔沉穩、常待在主人身邊，預設節奏
// 勇敢：積極探索、平時飛得較遠，動作節奏較快
// 謹慎：傾向靠近主人、飛得較慢，觀察時間長而細心
// 愛玩：活潑調皮好奇，觀察動作頻繁、偶爾即興飛舞
export const TRAITS: Record<Personality, Traits> = {
  guardian: { speed: 1.6, range: 0.65, nearDist: 3.3, wander: 1, approach: 2.6, spin: 0.4, observe: 0.6, flourish: 0, stay: 10, startle: 0.1, tempo: 1, look: [2.5, 3.5], sweep: 1.8 },
  brave: { speed: 2.4, range: 1.0, nearDist: 3.6, wander: 3.2, approach: 0.8, spin: 0.6, observe: 0.5, flourish: 0, stay: 4, startle: 0, tempo: 1.25, look: [1.5, 2.5], sweep: 2.4 },
  cautious: { speed: 1.05, range: 0.5, nearDist: 3.0, wander: 0.8, approach: 2.6, spin: 0.2, observe: 1.4, flourish: 0, stay: 9, startle: 0.7, tempo: 0.8, look: [4, 6], sweep: 1.1 },
  playful: { speed: 1.9, range: 0.85, nearDist: 3.4, wander: 1.8, approach: 1.3, spin: 1.4, observe: 1.8, flourish: 1, stay: 5, startle: 0.15, tempo: 1.1, look: [1.2, 2.2], sweep: 3.6 },
};

/** AR 攝影棚：玩家決定的姿勢（悅靈停止自己的行動） */
export type Pose = 'fly' | 'wave' | 'dance' | 'happy' | 'hold' | 'sleep';
const POSE_MODE: Record<Pose, Mode> = { fly: 'idle', wave: 'wave', dance: 'dance', happy: 'happy', hold: 'idle', sleep: 'sleep' };

export interface World {
  camera: THREE.PerspectiveCamera;
  bounds(): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  night(): boolean;
  /** 地上有床時，悅靈躺下的位置 */
  bed?(): THREE.Vector3 | null;
  /** 床的方向 */
  bedYaw?(): number;
  /** 生命模式：畫面裡可以去看的東西（床、蛋糕、音符盒、唱片機）的位置 */
  things?(): THREE.Vector3[];
}

export interface Hooks {
  say(kind: LineKind): void;
  particle(kind: 'heart' | 'zzz' | 'crumb' | 'note' | 'sparkle' | 'dust', at: THREE.Vector3, count?: number, color?: string, spread?: number): void;
  caught(): void;
  /** 飛到蛋糕旁邊了（可以吃一片） */
  atCake?(): void;
  /** 情境音效（拍翅、衝刺、打呼、吃東西、醒來…） */
  sfx?(e: 'flap' | 'dash' | 'snore' | 'bite' | 'burp' | 'wake' | 'startle', at: THREE.Vector3): void;
  /** AI 生命模式：剛才的意圖做完了（請 AI 決定下一步） */
  lifeIdle?(): void;
  /** 哼歌時輕輕叫一聲（悅靈原本的叫聲） */
  hum?(): void;
  /** 生命模式：在地上找完一個地方（找不找得到東西由外面決定） */
  searched?(at: THREE.Vector3): void;
  /** 生命模式：在收藏角落看收藏 */
  treasure?(at: THREE.Vector3): void;
}

/** AI 生命模式的意圖（見 life/life.ts） */
export type LifeIntent =
  | 'explore' | 'explore_left' | 'explore_right' | 'explore_high' | 'explore_low'
  | 'approach' | 'observe' | 'stay' | 'daydream' | 'play' | 'dance' | 'rest' | 'sleep' | 'wake'
  | 'sing' | 'stretch' | 'search' | 'peek' | 'groom' | 'patrol' | 'treasure' | 'inspect';

/**
 * 生命模式的一段活動要做多久（秒）。診斷：以前每個意圖只做 2.6–9 秒就回去等 AI，看起來只是一直換地方飛；
 * 現在 AI 選的是「一段活動」，控制器在這段時間裡分幾個步驟做（同一區域換幾個點、找好幾個地方…），被打斷後也會接著做。
 */
export const SESSION_SEC: Partial<Record<LifeIntent, [number, number]>> = {
  explore: [45, 90], explore_left: [40, 80], explore_right: [40, 80], explore_high: [40, 70], explore_low: [40, 70],
  approach: [12, 20], observe: [20, 40], stay: [20, 40], daydream: [30, 60], play: [20, 35], dance: [20, 35], rest: [60, 120],
  sing: [35, 70], search: [45, 90], peek: [25, 45], groom: [25, 45], patrol: [30, 50], treasure: [25, 45], inspect: [20, 40],
};

/** 她的收藏角落（左後方的地上） */
export const TREASURE_SPOT = { x: -0.8, z: -0.6 };

/** AI 說的心情：讓動作與外觀跟著變（開心蹦蹦跳、難過垂頭、想睡慢慢拍翅膀…） */
export type Feeling = 'happy' | 'sad' | 'surprised' | 'shy' | 'sleepy';

const tmp = new THREE.Vector3();

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class AllayController {
  readonly pos = new THREE.Vector3(0, 1.2, 0);
  readonly vel = new THREE.Vector3();
  readonly target = new THREE.Vector3(0, 1.2, 0);
  readonly anchor = new THREE.Vector3(0, 1.2, 0);
  mode: Mode = 'idle';
  ballPos: THREE.Vector3 | null = null;
  private modeTime = 0;
  private modeDur = 3;
  private t = 0;
  private yaw = 0;
  private yawRate = 0;
  private spin = 0;
  private flapPhase = 0;
  private wingSpread = 0.8;
  private wingTilt = 0.43;
  private moveAmt = 0;
  private holdAmt = 0;
  private blinkIn = 3;
  private pitch = 0;
  private roll = 0;
  private zzzIn = 0;
  /** 依個性節奏流動的時間（勇敢較快、謹慎較慢） */
  private tt = 0;

  constructor(
    readonly model: AllayModel,
    private world: World,
    private pet: PetState,
    private hooks: Hooks,
  ) {
    if (pet.asleep) this.setMode('sleep');
  }

  private get tr(): Traits {
    return TRAITS[this.pet.personality];
  }

  // ---------- AI 生命模式：AI 決定意圖，控制器只負責飛過去、做出來、保持安全 ----------
  /** true＝AI 生命模式：不用原本的隨機決定、作息腳本，閒下來就通知 AI（hooks.lifeIdle） */
  life = false;

  /** 生命模式正在做的一段活動（AI 選的）；做完才再問 AI */
  private session: { i: LifeIntent; started: number; until: number; steps: number } | null = null;
  /** 給 AI 看的「正在做哪段活動、做了多久」 */
  get activity(): { i: LifeIntent; sec: number; leftSec: number } | null {
    const s = this.session;
    return s && this.t < s.until ? { i: s.i, sec: Math.round(this.t - s.started), leftSec: Math.round(s.until - this.t) } : null;
  }
  /** AI 暫時連不上：手上的活動多做一會兒（延續 AI 決定的事，不是新的腳本） */
  extendActivity(sec: number): void {
    if (this.session) this.session.until = Math.max(this.session.until, this.t + sec);
  }
  /** 不做了（例如換模式） */
  endActivity(): void {
    this.session = null;
  }

  setLife(on: boolean): void {
    if (this.life === on) return;
    this.life = on;
    this.gazeIn = 0;
    this.session = null;
    if (on && !this.posed && this.mode !== 'sleep') this.toIdle();
  }

  /** 生命模式：自己看的方向（不會一直盯著畫面）；attendUntil 之前看著主人（主人跟她互動、她在跟主人說話） */
  private gazeYaw = 0;
  private gazeIn = 0;
  private gazeUp = 0;
  private attendUntil = -Infinity;
  /** 生命模式：接下來幾秒把注意力放在主人身上（面向畫面） */
  attend(sec: number): void {
    this.attendUntil = this.t + sec;
  }
  private updateGaze(dt: number): void {
    // 正在看某個東西：眼睛和頭一直對著它
    if (this.inspectAt && this.t < this.inspectUntil) {
      this.gazeYaw = Math.atan2(this.inspectAt.x - this.pos.x, this.inspectAt.z - this.pos.z);
      this.gazeUp = THREE.MathUtils.clamp((this.inspectAt.y - this.pos.y) * 0.5, -0.4, 0.3);
      this.gazeIn = 0;
      return;
    }
    this.gazeIn -= dt;
    if (this.gazeIn > 0) return;
    const dreamy = this.mode === 'idle' && this.dreaming;
    this.gazeIn = dreamy ? rand(6, 11) : rand(3.5, 8);
    const cam = this.world.camera.position;
    const toCam = Math.atan2(cam.x - this.pos.x, cam.z - this.pos.z);
    // 偶爾瞄一下主人，大多時候看自己有興趣的方向（側面、遠處、上面）
    if (!dreamy && Math.random() < 0.2) {
      this.gazeYaw = toCam;
      this.gazeUp = 0;
    } else {
      this.gazeYaw = toCam + (Math.random() < 0.5 ? -1 : 1) * rand(0.8, 2.6);
      this.gazeUp = dreamy ? rand(0.25, 0.45) : Math.random() < 0.3 ? rand(0.15, 0.35) : 0;
    }
  }
  /** 生命模式現在要不要看著主人 */
  private get attending(): boolean {
    return this.t < this.attendUntil || this.mode === 'approach' || this.mode === 'called' || this.mode === 'listen' || this.mode === 'wave';
  }
  /** 發呆中（生命模式的 daydream） */
  private dreaming = false;
  /** 這一幀是不是在看自己的方向（頭的角度也跟著） */
  private selfGaze = false;

  /** 照 AI 的意圖行動（固定姿勢時不做） */
  intend(i: LifeIntent): void {
    if (this.posed) return;
    const b = this.world.bounds();
    const tr = this.tr;
    const asleep = this.mode === 'sleep';
    if (i === 'wake') {
      if (asleep) {
        this.wokeAt = this.t;
        this.setMode('waking', 1.2);
        this.hooks.sfx?.('wake', this.pos);
      }
      return;
    }
    if (i === 'sleep') {
      if (asleep) return;
      if (this.world.bed?.()) return this.goBed();
      this.anchor.set(this.pos.x, 0, this.pos.z);
      this.clampVec(this.anchor);
      this.setMode('sleep');
      return;
    }
    // 睡著時只聽「起床」；其他意圖先不做（不會被 AI 搞到半夢半醒亂飛）
    if (asleep) return;
    const len = SESSION_SEC[i];
    this.session = len ? { i, started: this.t, until: this.t + rand(len[0], len[1]), steps: 0 } : null;
    this.lifeStep(i, b, tr);
  }

  /** 一段活動裡的一個步驟（第一次、或上一步做完還在活動時間內） */
  private lifeStep(i: LifeIntent, b: ReturnType<World['bounds']>, tr: Traits): void {
    if (this.session) this.session.steps++;
    const midY = (b.minY + 0.3 + b.maxY) / 2;
    switch (i) {
      case 'explore':
        this.target.set(rand(b.minX, b.maxX) * tr.range, rand(b.minY + 0.3, b.maxY), rand(b.minZ * tr.range, b.maxZ));
        return this.setMode('wander', 7);
      case 'explore_left':
        this.target.set(rand(b.minX, b.minX * 0.4), rand(b.minY + 0.3, b.maxY), rand(b.minZ * 0.6, b.maxZ * 0.6));
        return this.setMode('wander', 7);
      case 'explore_right':
        this.target.set(rand(b.maxX * 0.4, b.maxX), rand(b.minY + 0.3, b.maxY), rand(b.minZ * 0.6, b.maxZ * 0.6));
        return this.setMode('wander', 7);
      case 'explore_high':
        this.target.set(rand(b.minX, b.maxX) * 0.6, rand(midY, b.maxY), rand(b.minZ * 0.5, b.maxZ * 0.5));
        return this.setMode('wander', 7);
      case 'explore_low':
        this.target.set(rand(b.minX, b.maxX) * 0.6, rand(b.minY + 0.3, midY), rand(b.minZ * 0.5, b.maxZ * 0.5));
        return this.setMode('wander', 7);
      case 'approach':
        return this.setMode('approach', tr.stay);
      case 'observe':
        return this.observe();
      case 'stay':
        this.anchor.copy(this.pos);
        this.clampVec(this.anchor);
        return this.setMode('idle', rand(6, 10));
      case 'daydream':
        // 發呆：停在原地，慢慢望向遠方或天空
        this.anchor.copy(this.pos);
        this.clampVec(this.anchor);
        this.setMode('idle', rand(12, 20));
        this.dreaming = true;
        this.gazeIn = 0;
        return;
      case 'play':
        this.anchor.copy(this.pos);
        this.clampVec(this.anchor);
        return this.setMode('flourish', 2.6 / tr.tempo);
      case 'dance':
        this.danceAt.copy(this.pos);
        this.clampVec(this.danceAt);
        return this.setMode('dance', 5);
      case 'rest':
        this.anchor.set(this.pos.x, 0, this.pos.z);
        this.clampVec(this.anchor);
        return this.setMode('rest', rand(12, 20));
      case 'sing':
        // 哼歌：停在原地輕輕搖頭晃腦、冒音符、偶爾叫一聲
        this.anchor.copy(this.pos);
        this.clampVec(this.anchor);
        this.setMode('idle', rand(6, 9));
        this.act = 'sing';
        return;
      case 'stretch':
        // 伸懶腰：雙手舉高、張開翅膀拍一拍
        return this.gesture(['hands_up', 'flap']);
      case 'groom':
        // 整理翅膀：轉頭看左右翅膀、慢慢拍
        this.anchor.copy(this.pos);
        this.clampVec(this.anchor);
        this.setMode('idle', rand(5, 7));
        this.act = 'groom';
        return;
      case 'search':
        // 在地上找東西（原版悅靈會撿東西）：先飛到低處，再低頭東看西看
        this.target.set(rand(b.minX, b.maxX) * 0.8, b.minY + 0.15, rand(b.minZ * 0.6, b.maxZ * 0.6));
        this.setMode('wander', 7);
        this.after = 'search';
        return;
      case 'peek':
        // 躲起來偷看：飛到畫面邊邊的低處，歪頭偷看主人
        this.target.set((Math.random() < 0.5 ? -1 : 1) * b.maxX * 0.92, b.minY + 0.35, b.minZ * 0.8);
        this.setMode('wander', 7);
        this.after = 'peek';
        return;
      case 'patrol':
        // 繞一大圈巡邏（慢慢飛，不是亂衝）
        this.anchor.set(this.pos.x * 0.5, midY, (b.minZ + b.maxZ) * 0.25);
        this.clampVec(this.anchor);
        this.setMode('flourish', 9);
        this.act = 'patrol';
        return;
      case 'inspect': {
        // 去看看畫面裡真的有的東西（床、蛋糕、音符盒、唱片機）：飛到旁邊，盯著它看
        const things = this.world.things?.() ?? [];
        if (!things.length) return this.observe();
        const s = this.session;
        const thing = things[(s ? s.steps - 1 : 0) % things.length];
        this.inspectAt = thing.clone();
        this.target.set(thing.x + rand(-0.35, 0.35), Math.max(b.minY + 0.25, thing.y + 0.45), thing.z + 0.45);
        this.clampVec(this.target);
        this.setMode('wander', 7);
        this.after = 'inspect';
        return;
      }
      case 'treasure':
        // 去收藏角落看看收藏
        this.target.set(TREASURE_SPOT.x * b.maxX, b.minY + 0.2, TREASURE_SPOT.z * Math.abs(b.minZ));
        this.clampVec(this.target);
        this.setMode('wander', 7);
        this.after = 'treasure';
        return;
    }
  }

  /** 生命模式的小活動（哼歌、整理翅膀、找東西、偷看、巡邏）；換動作時清掉 */
  private act: 'sing' | 'groom' | 'search' | 'peek' | 'patrol' | null = null;
  /** 飛到目的地之後要做的事 */
  private after: 'search' | 'peek' | 'treasure' | 'inspect' | null = null;
  /** 正在看的東西、看到什麼時候 */
  private inspectAt: THREE.Vector3 | null = null;
  private inspectUntil = 0;
  private actFx = 0;
  /** 生命模式閒著時慢慢飄移的目標（不會一直停在同一點，也不會過動） */
  private readonly driftTo = new THREE.Vector3();
  private driftIn = 0;

  // ---------- 心情：AI 說的心情讓動作和外觀跟著變 ----------
  private feeling: Feeling | null = null;
  private feelLeft = 0;
  private feelW = 0;
  private shownFeeling: Feeling | null = null;
  /** AI 回答的心情（null＝慢慢回到平常）；持續幾秒 */
  setFeeling(f: Feeling | null, sec = 14): void {
    this.feeling = f;
    this.feelLeft = f ? sec : 0;
    if (f === 'surprised') {
      this.hooks.particle('sparkle', this.headTop(tmp), 6);
      this.vel.y += 1.2;
    }
  }
  /** 現在表現的心情與強度（AI 的心情優先；生命模式沒有時，照肚子、精神、心情數值淡淡地表現） */
  private feelNow(): { f: Feeling | null; w: number } {
    if (this.feeling && this.feelLeft > 0) return { f: this.feeling, w: 1 };
    if (this.life && this.mode !== 'sleep') {
      if (this.pet.energy < 25) return { f: 'sleepy', w: 0.6 };
      if (this.pet.mood < 30) return { f: 'sad', w: 0.5 };
      if (this.pet.mood > 80) return { f: 'happy', w: 0.35 };
    }
    return { f: null, w: 0 };
  }
  private feelOf(f: Feeling): number {
    return this.shownFeeling === f ? this.feelW : 0;
  }

  /** 給 AI 看的「現在在做什麼」 */
  get doing(): Mode {
    return this.mode;
  }

  setMode(m: Mode, dur = 3): void {
    // 固定姿勢（AR 攝影棚）時不換動作
    if (this.posed) return;
    // 開始飛行時拍翅膀、被呼喚或追球時衝刺
    if (m !== this.mode) {
      if (m === 'wander' || m === 'approach' || m === 'flourish' || m === 'curious') this.hooks.sfx?.('flap', this.pos);
      else if (m === 'called' || m === 'play') this.hooks.sfx?.('dash', this.pos);
    }
    this.mode = m;
    this.modeTime = 0;
    this.modeDur = dur;
    this.pet.asleep = m === 'sleep';
    this.dreaming = false;
    this.act = null;
    if (m !== 'wander') this.after = null;
    if (m === 'idle') this.driftIn = 0;
  }

  get awake(): boolean {
    return this.mode !== 'sleep';
  }

  /** 頭頂（名字顯示位置） */
  headTop(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.model.root.position).add(tmp.set(0, 0.72, 0));
  }

  // ---------- 玩家互動 ----------

  /** 叫醒；回傳是否原本在睡覺 */
  wake(): boolean {
    if (this.mode !== 'sleep') return false;
    this.wokeAt = this.t;
    const startled = Math.random() < this.tr.startle;
    this.setMode(startled ? 'startled' : 'waking', startled ? 1 : 1.2);
    this.hooks.sfx?.(startled ? 'startle' : 'wake', this.pos);
    this.pet.energy = Math.max(this.pet.energy, 35);
    this.hooks.say('wake');
    return true;
  }

  /** 回傳 false 代表這次觸摸是把牠叫醒 */
  petted(): boolean {
    if (this.wake()) return false;
    this.hooks.particle('heart', this.headTop(tmp), 2);
    if (this.mode !== 'eat' && this.mode !== 'play') this.setMode('happy', 0.9);
    return true;
  }

  tickled(): void {
    if (this.wake()) return;
    this.hooks.particle('heart', this.headTop(tmp), 1);
    this.hooks.particle('sparkle', this.model.root.position, 6);
    this.setMode('tickled', 1.6);
  }

  eat(): void {
    this.wake();
    this.setMode('eat', 1.4);
  }

  call(): void {
    this.wake();
    this.setMode('called', this.tr.stay + 2);
    this.hooks.say('call');
  }

  /** 玩家點了空白處：好奇飛過去看 */
  /** 動態模式：鏡頭前的人在哪裡（世界座標）；null = 沒看到人，照常看向畫面 */
  private person: THREE.Vector3 | null = null;
  setPerson(p: THREE.Vector3 | null): void {
    if (!p) this.person = null;
    else (this.person ??= new THREE.Vector3()).copy(p);
  }

  lookAt(p: THREE.Vector3): void {
    if (!this.awake || this.mode === 'play' || this.mode === 'eat') return;
    this.target.copy(p);
    this.clampTarget();
    this.setMode('curious', 4);
    if (Math.random() < 0.3) this.hooks.say('curious');
  }

  chaseBall(): void {
    if (!this.awake) return;
    this.setMode('play', 9);
  }

  /** 聽到音符盒：飛到音符盒上方跳舞（原版悅靈喜歡音符盒） */
  dance(at: THREE.Vector3): void {
    this.wake();
    if (this.mode === 'play' || this.mode === 'eat') return;
    this.danceAt.copy(at);
    // 已經在跳舞就延長時間，不重設動作節奏
    if (this.mode === 'dance') this.modeDur = this.modeTime + DANCE_TIME;
    else this.setMode('dance', DANCE_TIME);
  }

  private readonly danceAt = new THREE.Vector3();
  private readonly cakeAt = new THREE.Vector3();

  /** 肚子餓時飛到地上的蛋糕旁邊吃一片 */
  seekCake(at: THREE.Vector3): void {
    if (!this.awake) return;
    this.cakeAt.copy(at).add(tmp.set(0.05, 0.55, 0.2));
    this.setMode('cake', 8);
  }

  /** 玩家對著麥克風說話：飛到面前歪著頭專心聽 */
  listen(on: boolean): void {
    if (on) {
      this.wake();
      this.setMode('listen', 30);
    } else if (this.mode === 'listen') this.setMode('happy', 0.9);
  }
  /** 目前的固定姿勢；null 代表悅靈自己行動 */
  posed: Pose | null = null;
  /** 固定姿勢時的位置（可以用手指拖） */
  readonly posePos = new THREE.Vector3();
  /** 固定姿勢時額外轉的角度（0 = 面向鏡頭） */
  poseYaw = 0;

  /** 小遊戲：在原地做一個短暫的反應動作，做完回到原本的樣子 */
  private performing = false;
  perform(m: 'happy' | 'dance' | 'wave' | 'tickled' | 'oops' | 'flip', dur: number): void {
    if (!this.posed) {
      this.posePos.copy(this.pos);
      this.posed = 'fly';
    }
    this.mode = m;
    this.modeTime = 0;
    this.modeDur = dur;
    this.performing = true;
    if (m === 'wave') this.waveAt.copy(this.posePos);
    if (m === 'dance') this.danceAt.copy(this.posePos);
  }

  setPose(p: Pose | null): void {
    this.performing = false;
    if (!p) {
      if (this.posed) {
        this.posed = null;
        this.poseYaw = 0;
        this.toIdle();
      }
      return;
    }
    if (!this.posed) this.posePos.copy(this.pos);
    this.posed = p;
    // 直接換動作，不經過 setMode（不會改到睡覺狀態等存檔數值）
    this.mode = POSE_MODE[p];
    this.modeTime = 0;
    this.modeDur = Infinity;
  }

  /** 正躺在床上睡覺（頭靠枕頭、蓋著被子） */
  get lying(): boolean {
    const spot = this.mode === 'sleep' && !this.posed ? this.world.bed?.() : null;
    return !!spot && this.pos.distanceTo(spot) < 0.35;
  }

  /** 去床上睡覺（放好床後點床、或到了就寢時間） */
  goBed(): void {
    const spot = this.world.bed?.();
    if (!spot) return;
    if (this.mode === 'sleep') return;
    this.wake();
    this.wokeAt = -Infinity;
    this.setMode('toBed', 8);
  }

  /** 洗澡：被水潑到時抖一抖身體甩水 */
  bathe(): void {
    if (this.mode === 'sleep') this.wake();
    this.setMode('bath', 1.8);
  }

  /** 看煙火：停下來抬頭看 */
  watch(at: THREE.Vector3): void {
    if (!this.awake || this.mode === 'eat' || this.mode === 'play') return;
    this.watchAt.copy(at);
    this.anchor.copy(this.pos);
    this.setMode('watch', 4);
  }
  private readonly watchAt = new THREE.Vector3();

  // ---------- AI 選的動作（手、頭、翅膀、身體）----------
  private gest: { g: LimbGesture; t: number; dur: number } | null = null;
  private armXs = 0;
  private armZs = 0.4363;
  private headXs = 0;
  private headYs = 0;
  private gestQueue: Gesture[] = [];
  /** 最近做過的動作（給 AI 記憶用） */
  readonly gestureLog: { g: Gesture; at: number }[] = [];

  /** 依序做 AI 選的動作；固定姿勢（AR 攝影棚）時不做 */
  gesture(list: Gesture[]): void {
    if (this.posed || !list.length) return;
    this.gestQueue = list.slice(0, 3);
    this.gest = null;
    this.nextGesture();
  }

  get gesturing(): boolean {
    return !!this.gest;
  }

  private nextGesture(): void {
    const g = this.gestQueue.shift();
    if (!g) return;
    this.wake();
    this.gestureLog.push({ g, at: Date.now() });
    if (this.gestureLog.length > 12) this.gestureLog.shift();
    const dur = GESTURE_SEC[g];
    if (isLimb(g)) {
      // 停在原地、面向主人做動作
      this.anchor.copy(this.pos);
      this.setMode('idle', dur);
      this.gest = { g, t: 0, dur };
      return;
    }
    const next = () => window.setTimeout(() => this.nextGesture(), dur * 1000);
    switch (g) {
      case 'spin':
        this.setMode('happy', dur);
        break;
      case 'flip':
        this.setMode('flip', dur);
        break;
      case 'dance':
        this.setMode('dance', dur);
        break;
      case 'come':
        this.setMode('approach', dur);
        break;
      case 'back':
        this.setMode('startled', dur);
        break;
      case 'rest':
        this.setMode('rest', dur);
        break;
      case 'happy':
        this.setMode('happy', dur);
        this.hooks.particle('note', this.headTop(tmp), 2);
        break;
      case 'sad':
        this.setMode('oops', dur);
        break;
      case 'look_around':
        this.anchor.copy(this.pos);
        this.setMode('observe', dur);
        break;
    }
    if (this.gestQueue.length) next();
  }

  /** 有人對著前鏡頭揮手：飛到面前揮手回應 */
  waveBack(): void {
    if (this.mode === 'eat' || this.mode === 'wave') return;
    this.wake();
    // 離鏡頭太遠才飛近一點，否則就在原地轉過來面向你揮手
    const cam = this.world.camera.position;
    if (this.pos.distanceTo(cam) > 4.2) this.waveAt.set(this.pos.x * 0.5, cam.y - 0.45, cam.z - this.tr.nearDist);
    else this.waveAt.copy(this.pos);
    this.setMode('wave', 2.6);
  }
  private readonly waveAt = new THREE.Vector3();

  /** 揮手的程度：開始 0.35 秒舉手、結束前 0.35 秒放下 */
  private waveAmount(): number {
    const ease = (x: number) => x * x * (3 - 2 * x);
    return ease(Math.min(1, this.modeTime / 0.35)) * ease(Math.min(1, Math.max(0, (this.modeDur - this.modeTime) / 0.35)));
  }

  /** 聽到的音量 0–1（說話時頭會跟著點） */
  hearing = 0;

  get dancing(): boolean {
    return this.mode === 'dance';
  }

  // ---------- 每幀更新 ----------

  update(dt: number): void {
    this.t += dt;
    this.modeTime += dt;
    if (this.gest) {
      this.gest.t += dt;
      // 被別的事打斷（睡覺、吃東西、玩、固定姿勢）或做完了
      if (this.gest.t >= this.gest.dur || this.posed || this.mode === 'sleep' || this.mode === 'eat' || this.mode === 'play') {
        this.gest = null;
        if (!this.posed) this.nextGesture();
      }
    }
    const tr = this.tr;
    this.tt += dt * tr.tempo;
    if (this.posed) {
      // 固定姿勢：停在玩家放的位置，只播動作
      this.target.copy(this.posePos);
      if (this.performing && this.modeTime > this.modeDur) {
        this.performing = false;
        this.mode = POSE_MODE[this.posed];
        this.modeTime = 0;
        this.modeDur = Infinity;
      }
      if (this.performing && this.mode === 'dance' && Math.floor(this.modeTime / 0.7) !== Math.floor((this.modeTime - dt) / 0.7)) this.hooks.particle('note', this.headTop(tmp), 1);
      this.move(dt, tr.speed * 1.5);
      this.animate(dt);
      if (this.posed === 'sleep' && Math.floor(this.modeTime / 1.6) !== Math.floor((this.modeTime - dt) / 1.6)) this.hooks.particle('zzz', this.headTop(tmp));
      if (this.posed === 'dance' && Math.floor(this.modeTime / 0.7) !== Math.floor((this.modeTime - dt) / 0.7)) this.hooks.particle('note', this.headTop(tmp), 1);
      this.aura(dt);
      return;
    }
    const b = this.world.bounds();
    let speed = tr.speed;
    this.updateFeeling(dt);
    this.updateAct(dt);

    switch (this.mode) {
      case 'idle': {
        // 生命模式自己閒著：慢慢飄來飄去（每 6～12 秒換個方向，範圍不大、速度很慢）
        if (this.life && !this.act && !this.dreaming && !this.gest && !this.attending && this.t >= this.inspectUntil) {
          this.driftIn -= dt;
          if (this.driftIn <= 0) {
            this.driftIn = rand(6, 12);
            this.driftTo.set(this.anchor.x + rand(-0.9, 0.9), this.anchor.y + rand(-0.3, 0.3), this.anchor.z + rand(-0.5, 0.5));
            this.clampVec(this.driftTo);
          }
          this.anchor.lerp(this.driftTo, 1 - Math.exp(-0.25 * dt));
        }
        this.target.set(
          this.anchor.x + Math.sin(this.t * 0.7) * 0.15,
          this.anchor.y + Math.sin(this.t * 1.1) * 0.1,
          this.anchor.z + Math.cos(this.t * 0.5) * 0.12,
        );
        speed *= 0.5;
        if (this.modeTime > this.modeDur) this.decide();
        break;
      }
      case 'wander':
        if (this.pos.distanceTo(this.target) < 0.2 || this.modeTime > 7) this.toIdle();
        break;
      case 'curious':
        // 謹慎、愛玩的悅靈飛到後會停下來東張西望
        if (this.pos.distanceTo(this.target) < 0.2 || this.modeTime > 7) {
          if (tr.observe >= 1.4) this.observe();
          else this.toIdle();
        }
        break;
      case 'observe':
        this.target.set(this.anchor.x, this.anchor.y + Math.sin(this.t * 1.1) * 0.06, this.anchor.z);
        speed *= 0.4;
        if (this.modeTime > this.modeDur) {
          if (this.act === 'search') this.hooks.searched?.(this.pos);
          this.toIdle();
        }
        break;
      case 'flourish': {
        // 繞一圈小小的 8 字飛舞
        const a = (this.modeTime / this.modeDur) * Math.PI * 2;
        // 巡邏：繞大一點的圈、飛慢一點
        const r = this.act === 'patrol' ? 2.2 : 1;
        this.target.set(this.anchor.x + Math.sin(a) * 0.55 * r, this.anchor.y + Math.sin(a * 2) * 0.18, this.anchor.z + (1 - Math.cos(a)) * 0.3 * r);
        speed *= this.act === 'patrol' ? 1.1 : 1.6;
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
      }
      case 'approach':
      case 'called': {
        const cam = this.world.camera.position;
        this.target.set(Math.sin(this.t * 0.6) * 0.1, cam.y - 0.45 + Math.sin(this.t * 1.3) * 0.05, cam.z - tr.nearDist);
        if (this.mode === 'called') speed *= 1.6;
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
      }
      case 'rest': {
        this.target.set(this.anchor.x, b.minY + 0.15 + Math.sin(this.t * 0.8) * 0.04, this.anchor.z);
        speed *= 0.4;
        // 生命模式：休息多久、要不要睡由 AI 決定
        if (this.life) {
          if (this.modeTime > this.modeDur) this.toIdle();
        } else if (this.pet.energy < 12) {
          this.setMode('sleep');
          this.hooks.say('sleepy');
        } else if (this.modeTime > this.modeDur && this.pet.energy > 40) this.toIdle();
        break;
      }
      case 'toBed': {
        const spot = this.world.bed?.();
        if (!spot) {
          this.toIdle();
          break;
        }
        this.target.copy(spot).add(tmp.set(0, 0.3, 0));
        if (this.pos.distanceTo(this.target) < 0.25) {
          this.setMode('sleep');
          this.hooks.say('bedtime');
        } else if (this.modeTime > this.modeDur) this.toIdle();
        break;
      }
      case 'bath':
        this.target.copy(this.pos);
        if (this.modeTime > this.modeDur) this.setMode('happy', 0.9);
        break;
      case 'watch':
        this.target.copy(this.anchor);
        speed *= 0.5;
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
      case 'sleep': {
        const bed = this.world.bed?.();
        if (bed) this.target.copy(bed);
        else this.target.set(this.anchor.x, b.minY + 0.1, this.anchor.z);
        speed *= 0.3;
        this.zzzIn -= dt;
        if (this.zzzIn <= 0) {
          this.zzzIn = 1.6;
          this.hooks.particle('zzz', this.headTop(tmp));
          // 每三個 Z 輕輕打呼一次
          if (++this.snore % 3 === 0) this.hooks.sfx?.('snore', this.pos);
        }
        // 到了起床時間（而且睡飽了）就自己醒來說早安
        // 白天小睡至少睡 20 秒（生命模式：什麼時候起床由 AI 決定，可以賴床）
        if (!this.life && this.pet.energy >= 100 && !this.world.night() && this.modeTime > 20) {
          this.wokeAt = this.t;
          this.setMode('waking', 1.2);
          this.hooks.sfx?.('wake', this.pos);
          this.hooks.say('morning');
        }
        break;
      }
      case 'play': {
        if (!this.ballPos) {
          this.toIdle();
          break;
        }
        this.target.copy(this.ballPos).add(tmp.set(0, 0.2, 0));
        speed *= 1.5;
        if (this.pos.distanceTo(this.target) < 0.4) {
          this.hooks.caught();
          this.hooks.particle('sparkle', this.pos, 8);
          // 接到食物時 caught() 會切換成吃東西
          if (this.mode === 'play') this.setMode('happy', 1);
        } else if (this.modeTime > this.modeDur) this.toIdle();
        break;
      }
      case 'eat':
        this.target.copy(this.pos);
        if (this.modeTime > 0.35 && Math.floor(this.modeTime * 4) !== Math.floor((this.modeTime - dt) * 4)) {
          this.hooks.particle('crumb', tmp.copy(this.pos).add(new THREE.Vector3(0, 0.3, 0.3)), 3);
          this.hooks.sfx?.('bite', this.pos);
        }
        if (this.modeTime > this.modeDur) {
          if (Math.random() < 0.5) this.hooks.sfx?.('burp', this.pos);
          this.setMode('happy', 0.9);
        }
        break;
      case 'happy':
      case 'tickled':
        this.target.copy(this.anchor);
        speed *= 0.6;
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
      case 'startled': {
        // 往後退一點
        this.target.set(this.pos.x, this.pos.y + 0.4, this.pos.z - 0.6);
        speed *= 1.8;
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
      }
      case 'cake':
        this.target.copy(this.cakeAt);
        if (this.pos.distanceTo(this.target) < 0.25) this.hooks.atCake?.();
        else if (this.modeTime > this.modeDur) this.toIdle();
        break;
      case 'wave':
        this.target.copy(this.waveAt);
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
      case 'listen': {
        const cam = this.world.camera.position;
        this.target.set(0, cam.y - 0.5, cam.z - 2.6);
        speed *= 1.2;
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
      }
      case 'dance':
        this.target.copy(this.danceAt);
        speed *= 1.3;
        if (Math.floor(this.modeTime / 0.7) !== Math.floor((this.modeTime - dt) / 0.7)) this.hooks.particle('note', this.headTop(tmp), 1);
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
      case 'waking':
        this.target.set(this.pos.x, b.minY + 0.6, this.pos.z);
        speed *= 0.6;
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
    }

    if (this.mode !== 'play') this.clampTarget();
    // 心情：開心飛快一點，難過、想睡慢吞吞
    speed *= 1 + 0.15 * this.feelOf('happy') - 0.3 * this.feelOf('sad') - 0.4 * this.feelOf('sleepy') - 0.1 * this.feelOf('shy');
    this.move(dt, speed);
    this.animate(dt);
    this.aura(dt);
  }

  /** 心情的強度慢慢變化，並冒出代表心情的粒子 */
  private updateFeeling(dt: number): void {
    if (this.feelLeft > 0) this.feelLeft -= dt;
    const { f, w } = this.feelNow();
    if (f !== this.shownFeeling) {
      // 先淡出原本的心情，再換成新的
      this.feelW = Math.max(0, this.feelW - dt * 1.5);
      if (this.feelW <= 0.02) this.shownFeeling = f;
    } else this.feelW += (w - this.feelW) * (1 - Math.exp(-2 * dt));
    if (!this.shownFeeling || this.feelW < 0.3 || this.mode === 'sleep') return;
    this.actFx -= dt;
    if (this.actFx > 0) return;
    const head = this.headTop(tmp);
    switch (this.shownFeeling) {
      case 'happy':
        this.actFx = rand(2, 3.5);
        this.hooks.particle(Math.random() < 0.5 ? 'note' : 'heart', head, 1);
        break;
      case 'shy':
        this.actFx = rand(3.5, 5);
        this.hooks.particle('heart', head, 1);
        break;
      case 'sleepy':
        this.actFx = rand(2.5, 4);
        this.hooks.particle('zzz', head, 1);
        break;
      default:
        this.actFx = 3;
    }
  }

  /** 生命模式的小活動：哼歌冒音符、找東西時偶爾閃一下 */
  private actIn = 0;
  private updateAct(dt: number): void {
    if (!this.act) return;
    this.actIn -= dt;
    if (this.actIn > 0) return;
    if (this.act === 'sing') {
      this.actIn = 0.8;
      this.hooks.particle('note', this.headTop(tmp), 1);
      if (Math.random() < 0.4) this.hooks.hum?.();
    } else if (this.act === 'search') {
      this.actIn = rand(1.2, 2.2);
      this.hooks.particle('sparkle', tmp.copy(this.pos).add(new THREE.Vector3(rand(-0.3, 0.3), -0.35, rand(-0.2, 0.3))), 3);
    } else this.actIn = 1;
  }

  private auraIn = Math.random() * AURA_EVERY;
  private sparseIn = Math.random() * SPARSE_EVERY;

  private aura(dt: number): void {
    const color = PERSONALITY_COLOR[this.pet.personality];
    const body = tmp.copy(this.model.root.position).add(new THREE.Vector3(0, -0.15, 0));
    this.auraIn -= dt;
    if (this.auraIn <= 0) {
      this.auraIn = AURA_EVERY;
      // 睡覺時不冒性格粒子，只留下 Zzz
      if (this.awake) this.hooks.particle('dust', body, 1 + Math.floor(Math.random() * 2), color, 0.32);
    }
    this.sparseIn -= dt;
    if (this.sparseIn <= 0) {
      this.sparseIn = SPARSE_EVERY;
      if (Math.random() < SPARSE_CHANCE) this.hooks.particle('dust', body, 3, color, 0.6);
    }
  }

  private toIdle(): void {
    const after = this.after;
    this.anchor.copy(this.pos);
    this.clampVec(this.anchor);
    if (after === 'search') {
      // 到了：低頭東看西看找東西
      this.lookDir = Math.random() < 0.5 ? 1 : -1;
      this.setMode('observe', rand(4, 6));
      this.act = 'search';
      return;
    }
    if (after === 'inspect' && this.inspectAt) {
      // 到了：停下來盯著那個東西看一陣子
      this.setMode('idle', rand(5, 8));
      this.inspectUntil = this.t + this.modeDur;
      return;
    }
    if (after === 'treasure') {
      // 到了收藏角落：低頭看看收藏
      this.setMode('observe', rand(5, 8));
      this.hooks.treasure?.(this.pos);
      return;
    }
    if (after === 'peek') {
      // 到了：躲在邊邊歪頭偷看主人
      this.setMode('idle', rand(5, 7));
      this.act = 'peek';
      this.attend(this.modeDur);
      return;
    }
    this.setMode('idle', rand(2.5, 6));
  }

  private decide(): void {
    // 生命模式：不用隨機決定，原地輕輕飄著，請 AI 決定下一步（AI 沒回應就一直安全地待著）
    if (this.life) {
      // 一段活動還沒做完：接著做下一步（被摸、被叫、聊天打斷之後也會回到這裡）
      const s = this.session;
      if (s && this.t < s.until && s.i !== 'approach' && s.i !== 'stretch') return this.lifeStep(s.i, this.world.bounds(), this.tr);
      this.session = null;
      this.anchor.copy(this.pos);
      this.clampVec(this.anchor);
      this.setMode('idle', rand(8, 12));
      this.hooks.lifeIdle?.();
      return;
    }
    const tr = this.tr;
    // 作息：到了就寢時間就自己去睡（被叫醒後會再陪你 2 分鐘）
    if (this.world.night() && this.t - this.wokeAt > BEDTIME_GRACE) {
      if (this.world.bed?.()) return this.goBed();
      this.anchor.set(rand(-0.3, 0.3), 0, rand(-0.4, 0.6));
      this.setMode('sleep');
      this.hooks.say('bedtime');
      return;
    }
    if (this.pet.energy < 25) {
      this.anchor.set(rand(-0.3, 0.3), 0, rand(-0.4, 0.6));
      this.setMode('rest', rand(10, 20));
      if (Math.random() < 0.5) this.hooks.say('sleepy');
      return;
    }
    const mood = moodLevel(this.pet.mood);
    const opts: [number, () => void][] = [
      [tr.wander, () => {
        const b = this.world.bounds();
        const r = tr.range;
        this.target.set(rand(b.minX, b.maxX) * r, rand(b.minY + 0.3, b.maxY), rand(b.minZ * r, b.maxZ));
        this.setMode('wander', 7);
      }],
      // 心情低落時比較黏人，開心時比較常轉圈
      [tr.approach * (mood === 0 ? 2 : 1), () => this.setMode('approach', tr.stay)],
      [tr.spin * (mood === 2 ? 1.6 : 1), () => {
        this.setMode('happy', 0.9);
        this.hooks.particle('note', this.headTop(tmp), 1);
      }],
      [tr.observe, () => this.observe()],
      [tr.flourish, () => {
        this.anchor.copy(this.pos);
        this.clampVec(this.anchor);
        this.setMode('flourish', 2.6 / tr.tempo);
      }],
      [1.2, () => this.setMode('idle', rand(2, 5))],
    ];
    let r = Math.random() * opts.reduce((s, o) => s + o[0], 0);
    for (const [w, f] of opts) {
      r -= w;
      if (r <= 0) return f();
    }
  }

  /** 停在原地左右轉頭觀察四周 */
  private observe(): void {
    this.anchor.copy(this.pos);
    this.clampVec(this.anchor);
    this.lookDir = Math.random() < 0.5 ? 1 : -1;
    this.setMode('observe', rand(...this.tr.look));
  }

  private lookDir = 1;
  /** 上次醒來的時間（晚上被叫醒後，會再陪玩一陣子才去睡） */
  private wokeAt = 0;
  private snore = 0;

  private clampVec(v: THREE.Vector3): void {
    const b = this.world.bounds();
    v.x = THREE.MathUtils.clamp(v.x, b.minX, b.maxX);
    v.y = THREE.MathUtils.clamp(v.y, b.minY - 0.1, b.maxY);
    v.z = THREE.MathUtils.clamp(v.z, b.minZ, b.maxZ + 1.6);
  }

  /** 畫面尺寸改變（手機轉向）後，把跑到畫面外的悅靈直接拉回可見範圍 */
  fitView(): void {
    if (this.posed || this.mode === 'sleep' || this.mode === 'rest') return;
    this.clampVec(this.pos);
    this.clampVec(this.anchor);
    this.clampVec(this.target);
  }

  private clampTarget(): void {
    if (this.mode === 'sleep' || this.mode === 'rest') return;
    // approach/called 可以飛得比遊蕩範圍更靠近鏡頭
    this.clampVec(this.target);
  }

  private move(dt: number, maxSpeed: number): void {
    tmp.copy(this.target).sub(this.pos);
    const dist = tmp.length();
    const want = Math.min(maxSpeed, dist * 1.6);
    if (dist > 1e-4) tmp.multiplyScalar(want / dist);
    else tmp.set(0, 0, 0);
    this.vel.lerp(tmp, 1 - Math.exp(-3 * dt));
    this.pos.addScaledVector(this.vel, dt);
  }

  private animate(dt: number): void {
    const m = this.model;
    const sleeping = this.mode === 'sleep';
    const hspeed = Math.hypot(this.vel.x, this.vel.z);

    // 轉向：移動時面向前進方向，否則面向玩家
    let wantYaw: number;
    const facePlayer = this.mode === 'startled' || this.mode === 'sleep' || this.mode === 'rest' || this.mode === 'eat' || this.mode === 'wave' || !!this.gest;
    const lying = this.lying;
    this.selfGaze = false;
    if (lying) wantYaw = this.world.bedYaw?.() ?? 0;
    else if (this.posed) {
      const cam = this.world.camera.position;
      wantYaw = Math.atan2(cam.x - this.pos.x, cam.z - this.pos.z) + this.poseYaw;
    } else if (hspeed > 0.25 && !facePlayer) wantYaw = Math.atan2(this.vel.x, this.vel.z);
    else if ((this.selfGaze = this.life && !facePlayer && !this.attending && !this.person && (this.mode === 'idle' || this.mode === 'observe' || this.mode === 'flourish'))) {
      // 生命模式自己過生活：看自己有興趣的方向，不會一直盯著畫面
      this.updateGaze(dt);
      wantYaw = this.gazeYaw;
    } else {
      // 平常面向畫面；動態模式看到人時，身體轉向那個人
      const cam = this.person ?? this.world.camera.position;
      wantYaw = Math.atan2(cam.x - this.pos.x, cam.z - this.pos.z);
    }
    const prevYaw = this.yaw;
    const d = angleDiff(this.yaw, wantYaw);
    this.yaw += THREE.MathUtils.clamp(d * 4 * dt, -3.5 * dt, 3.5 * dt);
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, (this.yaw - prevYaw) / Math.max(dt, 1e-4), 1 - Math.exp(-6 * dt));

    // 轉圈動作
    // 跳舞：原版每 2.75 秒在 0.75 秒內轉兩圈，其餘時間左右搖擺
    let danceSpin = 0;
    if (this.mode === 'happy' || this.mode === 'tickled') {
      const k = Math.min(1, this.modeTime / this.modeDur);
      this.spin = (this.mode === 'tickled' ? 4 : 2) * Math.PI * (1 - Math.pow(1 - k, 3));
    } else if (this.mode === 'dance') {
      const cyc = this.modeTime % 2.75;
      danceSpin = cyc < 0.75 ? cyc / 0.75 : 0;
      this.spin = danceSpin * 4 * Math.PI;
    } else if (this.spin) {
      const whole = Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2;
      this.spin = THREE.MathUtils.lerp(this.spin, whole, 1 - Math.exp(-8 * dt));
      if (Math.abs(this.spin - whole) < 0.01) this.spin = 0;
    }
    const dancing = this.mode === 'dance';
    const sway = dancing ? Math.cos(this.t * 2.79) * (1 - danceSpin) : 0;

    // 以下動作數值參照原版悅靈的動畫（翅膀 45°±27°、手臂外張 25° 慢擺、飛行時身體前傾 45°）
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    const fwd = Math.cos(this.yaw) * this.vel.z + Math.sin(this.yaw) * this.vel.x;
    this.moveAmt = THREE.MathUtils.lerp(this.moveAmt, sleeping ? 0 : THREE.MathUtils.clamp(fwd / 1.2, 0, 1), k(5));
    const mv = this.moveAmt;
    const still = 1 - mv;

    m.root.position.copy(this.pos);
    const bob = sleeping ? Math.sin(this.t * 1.2) * 0.02 : Math.sin(this.tt * 2.2) * 0.03 + Math.cos(this.tt * Math.PI) * 0.025 * still;
    m.root.position.y += bob + (this.mode === 'happy' ? Math.sin(Math.min(1, this.modeTime / this.modeDur) * Math.PI) * 0.18 : 0);
    m.root.rotation.y = this.yaw + this.spin;

    // 轉彎側傾；睡覺時整體微微前傾
    const wantRoll = THREE.MathUtils.clamp(-this.yawRate * 0.12, -0.5, 0.5) + (this.mode === 'tickled' ? Math.sin(this.t * 30) * 0.15 : 0);
    this.roll = THREE.MathUtils.lerp(this.roll, wantRoll, k(4));
    // 躺在床上：整個身體往後倒，臉朝上、頭靠枕頭
    this.pitch = THREE.MathUtils.lerp(this.pitch, lying ? -Math.PI / 2 : sleeping ? 0.2 : 0, k(lying ? 4 : 3));
    const shake = this.mode === 'bath' && this.modeTime > 0.4 ? Math.sin(this.modeTime * 42) * 0.35 * Math.max(0, 1 - (this.modeTime - 0.4) / 1.4) : 0;
    m.tilt.rotation.set(this.pitch, 0, this.roll + sway * 0.279 + shake); // 跳舞時全身左右搖 16°；洗澡時甩水
    const pk = Math.min(1, this.modeTime / this.modeDur);
    if (this.mode === 'flip') {
      // 往後翻一圈，同時往上跳
      const e = pk < 0.5 ? 2 * pk * pk : 1 - Math.pow(-2 * pk + 2, 2) / 2;
      m.tilt.rotation.x = -e * Math.PI * 2;
      m.root.position.y += Math.sin(pk * Math.PI) * 0.35;
    }
    const oops = this.mode === 'oops' ? Math.sin(Math.min(1, pk * 4) * Math.PI / 2) * (pk > 0.8 ? (1 - pk) / 0.2 : 1) : 0;
    if (oops) {
      // 垂頭喪氣、往下沉一點
      m.root.position.y -= 0.12 * oops;
      m.tilt.rotation.z += Math.sin(this.modeTime * 3) * 0.08 * oops;
    }
    // 飛行時只有身體前傾，頭保持
    m.body.rotation.x = mv * (Math.PI / 4);

    // 翅膀
    let flapRate = 7 + mv * 3;
    if (this.mode === 'rest') flapRate = 4;
    if (sleeping) flapRate = 1.2;
    if (this.mode === 'happy' || this.mode === 'tickled' || this.mode === 'called' || this.mode === 'flourish' || this.mode === 'flip') flapRate += 4;
    if (this.mode === 'oops') flapRate *= 0.5;
    if (!sleeping) flapRate *= this.tr.tempo * (moodLevel(this.pet.mood) === 0 ? 0.85 : 1);
    // 心情：開心拍得快、難過和想睡拍得慢；整理翅膀時慢慢拍
    flapRate *= 1 + 0.45 * this.feelOf('happy') - 0.35 * this.feelOf('sad') - 0.5 * this.feelOf('sleepy');
    if (this.act === 'groom') flapRate *= 0.45;
    this.flapPhase += flapRate * dt;
    const amp = sleeping ? 0.03 : this.mode === 'rest' ? 0.25 : Math.PI * 0.15;
    // 難過、想睡時翅膀垂下來、收小一點
    const open = sleeping ? 0.12 : (Math.PI / 4 - mv * 0.3) * (1 - 0.35 * this.feelOf('sad') - 0.3 * this.feelOf('sleepy'));
    this.wingSpread = THREE.MathUtils.lerp(this.wingSpread, open - Math.cos(this.flapPhase) * amp, k(20));
    this.wingTilt = THREE.MathUtils.lerp(this.wingTilt, sleeping ? 0.1 : 0.4363 * still, k(6));
    m.setWings(this.wingSpread, this.wingTilt);
    // 躺在床上時翅膀收在背後（不然會穿過床墊）
    m.wingL.visible = m.wingR.visible = !lying;

    // 手臂：平常外張慢擺；拿東西（吃）時往前舉
    const hold = this.mode === 'eat' || this.posed === 'hold' ? 1 : 0;
    this.holdAmt = THREE.MathUtils.lerp(this.holdAmt, hold, k(8));
    const h = this.holdAmt;
    let armX = h * THREE.MathUtils.lerp(-Math.PI / 3, -1.134, mv) + (this.mode === 'eat' ? Math.sin(this.modeTime * 14) * 0.1 : 0);
    let armZ = 0.4363 - Math.cos(this.tt * Math.PI + Math.PI * 1.5) * Math.PI * 0.075 * still * (1 - h);
    if (this.mode === 'happy' || this.mode === 'tickled') { armX = -0.6 + Math.sin(this.t * 18) * 0.4; armZ = 0.7; }
    if (sleeping) { armX = 0; armZ = 0.15; }
    // 懊惱：雙手抱頭
    if (oops) { armX = THREE.MathUtils.lerp(armX, -2.5, oops); armZ = THREE.MathUtils.lerp(armZ, 0.35, oops); }
    if (this.mode === 'flip') { armX = -2.8; armZ = 0.9; }
    // 原本動畫的手臂角度存在自己的變數（不讀模型上被 AI 動作蓋過的值，不然另一隻手會被帶著舉起來）
    this.armXs = THREE.MathUtils.lerp(this.armXs, armX, k(10));
    this.armZs = THREE.MathUtils.lerp(this.armZs, armZ, k(10));
    m.armL.rotation.x = m.armR.rotation.x = this.armXs;
    m.armL.rotation.z = this.armZs;
    m.armR.rotation.z = -this.armZs;
    m.armL.rotation.y = 0.2793 * h;
    m.armR.rotation.y = -0.2793 * h;
    // 揮手：舉起一隻手左右搖
    if (this.mode === 'wave') {
      // 揮手：先舉手，從肩膀左右揮動，最後把手放下（頭與身體跟著輕輕擺）
      const w = this.waveAmount();
      const swing = Math.sin(this.modeTime * 9);
      m.armR.rotation.x = THREE.MathUtils.lerp(m.armR.rotation.x, -2.6, w);
      m.armR.rotation.z = THREE.MathUtils.lerp(m.armR.rotation.z, -0.25 + swing * 0.5, w);
      m.armL.rotation.z = THREE.MathUtils.lerp(m.armL.rotation.z, 0.6, w * 0.5);
      m.tilt.rotation.z += swing * 0.07 * w;
      m.root.position.y += Math.abs(swing) * 0.03 * w;
    }

    // 頭：自動看向玩家（動態模式看到人時，眼睛跟著那個人）
    const cam = this.person ?? this.world.camera.position;
    let headY = this.spin ? 0 : THREE.MathUtils.clamp(angleDiff(this.yaw, Math.atan2(cam.x - this.pos.x, cam.z - this.pos.z)), -1, 1);
    let headX = -THREE.MathUtils.clamp(Math.atan2(cam.y - this.pos.y - 0.25, Math.hypot(cam.x - this.pos.x, cam.z - this.pos.z)), -0.6, 0.6);
    if (this.mode === 'eat') headX = 0.25 + Math.sin(this.modeTime * 14) * 0.12;
    if (lying) { headX = Math.sin(this.t * 1.2) * 0.03; headY = 0.25; }
    else if (sleeping) { headX = 0.35 + Math.sin(this.t * 1.2) * 0.03; headY = 0; }
    // 心情低落：垂著頭
    else if (moodLevel(this.pet.mood) === 0 && (this.mode === 'idle' || this.mode === 'approach' || this.mode === 'wander')) headX += 0.2;
    if (dancing) { headY = sway * 0.244; headX = 0; } // 頭左右轉 14°
    if (this.mode === 'listen') { headX = -0.1 + this.hearing * 0.35; headY = 0; }
    if (this.mode === 'watch') {
      headX = -THREE.MathUtils.clamp(Math.atan2(this.watchAt.y - this.pos.y, Math.hypot(this.watchAt.x - this.pos.x, this.watchAt.z - this.pos.z)), 0, 0.9);
      headY = THREE.MathUtils.clamp(angleDiff(this.yaw, Math.atan2(this.watchAt.x - this.pos.x, this.watchAt.z - this.pos.z)), -1, 1);
    }
    // 觀察：左右慢慢（或快速）張望，微微低頭
    if (this.mode === 'observe') { headY = this.lookDir * Math.sin(this.modeTime * this.tr.sweep) * 0.9; headX = 0.12; }
    // 生命模式自己看東西時：不看主人的高度，照自己的視線（偶爾抬頭看天空、發呆時慢慢晃）
    if (this.life && this.selfGaze && this.mode !== 'observe') {
      headX = -this.gazeUp + 0.05;
      if (this.dreaming) headY = Math.sin(this.t * 0.4) * 0.25;
    }
    // 懊惱：低頭、左右搖頭
    if (oops) { headX += 0.4 * oops; headY = Math.sin(this.modeTime * 13) * 0.45 * oops; }
    this.headXs = THREE.MathUtils.lerp(this.headXs, headX, k(6));
    this.headYs = dancing || oops ? headY : THREE.MathUtils.lerp(this.headYs, headY, k(6));
    m.head.rotation.x = this.headXs;
    m.head.rotation.y = this.headYs;
    m.head.rotation.z = dancing ? sway * 0.524 : this.mode === 'curious' || this.mode === 'observe' ? Math.sin(this.t * 2) * 0.2 : this.mode === 'listen' ? 0.35 : this.mode === 'wave' ? Math.sin(this.modeTime * 9 + 0.8) * 0.18 * this.waveAmount() : 0; // 頭歪 30°

    // 心情與小活動：蓋在原本的動畫上（強度 0～1，慢慢進出）
    const busy = sleeping || lying || dancing || !!oops || this.mode === 'eat' || this.mode === 'wave' || this.mode === 'flip';
    let feelEyes: 'open' | 'closed' | 'happy' | null = null;
    if (!busy) {
      const L = THREE.MathUtils.lerp;
      const hp = this.feelOf('happy');
      if (hp) {
        // 開心：蹦蹦跳、身體左右輕擺
        m.root.position.y += Math.abs(Math.sin(this.t * 5)) * 0.07 * hp;
        m.tilt.rotation.z += Math.sin(this.t * 5) * 0.05 * hp;
        if (hp > 0.5) feelEyes = 'happy';
      }
      const sd = this.feelOf('sad');
      if (sd) {
        // 難過：往下沉、垂頭、手垂下來
        m.root.position.y -= 0.15 * sd;
        m.head.rotation.x += 0.35 * sd;
        m.armL.rotation.z = L(m.armL.rotation.z, 0.1, sd);
        m.armR.rotation.z = L(m.armR.rotation.z, -0.1, sd);
        m.armL.rotation.x = m.armR.rotation.x = L(m.armL.rotation.x, 0.15, sd);
      }
      const sp = this.feelOf('surprised');
      if (sp) {
        // 驚訝：身體往後仰、雙手張開
        m.tilt.rotation.x -= 0.25 * sp;
        m.armL.rotation.x = m.armR.rotation.x = L(m.armL.rotation.x, -1.2, sp);
        m.armL.rotation.z = L(m.armL.rotation.z, 0.9, sp);
        m.armR.rotation.z = L(m.armR.rotation.z, -0.9, sp);
      }
      const sh = this.feelOf('shy');
      if (sh) {
        // 害羞：低頭、把臉轉開一點、雙手在胸前、扭扭身體
        m.head.rotation.x += 0.3 * sh;
        m.head.rotation.y += 0.5 * sh;
        m.armL.rotation.x = m.armR.rotation.x = L(m.armL.rotation.x, -1.0, sh);
        m.armL.rotation.z = L(m.armL.rotation.z, 0.05, sh);
        m.armR.rotation.z = L(m.armR.rotation.z, -0.05, sh);
        m.tilt.rotation.z += Math.sin(this.t * 2) * 0.06 * sh;
        if (sh > 0.5) feelEyes = Math.sin(this.t * 1.3) > 0.4 ? 'closed' : 'happy';
      }
      const sl = this.feelOf('sleepy');
      if (sl) {
        // 想睡：打瞌睡點頭、慢慢往下沉、眼睛常常閉起來
        m.head.rotation.x += (0.2 + Math.max(0, Math.sin(this.t * 1.5)) * 0.2) * sl;
        m.root.position.y -= 0.08 * sl;
        if (sl > 0.5 && Math.sin(this.t * 0.8) > 0.2) feelEyes = 'closed';
      }
      // 小活動
      if (this.act === 'sing') {
        m.head.rotation.z = Math.sin(this.t * 3) * 0.25;
        m.tilt.rotation.z += Math.sin(this.t * 3) * 0.05;
        feelEyes = 'happy';
      } else if (this.act === 'groom') {
        // 輪流轉頭看左右翅膀
        const side = Math.sin(this.modeTime * 1.6) > 0 ? 1 : -1;
        m.head.rotation.y = L(m.head.rotation.y, side * 1.1, 0.8);
        m.head.rotation.x = L(m.head.rotation.x, 0.3, 0.8);
        if (Math.sin(this.modeTime * 3.1) > 0.6) feelEyes = 'closed';
      } else if (this.act === 'search') {
        // 低頭看地上
        m.head.rotation.x = L(m.head.rotation.x, 0.65, 0.9);
      } else if (this.act === 'peek') {
        // 歪頭偷看
        m.head.rotation.z = 0.4;
        m.tilt.rotation.z += 0.12;
      }
    }

    // AI 選的動作：蓋在原本的動畫上（進退場平滑）
    const ge = this.gest ? applyLimbGesture(m, this.gest.g, this.gest.t, envelope(this.gest.t, this.gest.dur)) : null;

    // 眼睛：眨眼 / 睡覺 / 開心
    this.blinkIn -= dt;
    if (ge?.eyes) {
      m.setEyes(ge.eyes);
      return;
    }
    if (sleeping || this.mode === 'rest' && this.modeTime > 4 || oops > 0.3) m.setEyes('closed');
    else if (this.mode === 'happy' || this.mode === 'tickled' || this.mode === 'eat' || this.mode === 'wave' || this.mode === 'bath' || this.mode === 'flip' || dancing) m.setEyes('happy');
    else if (feelEyes) m.setEyes(feelEyes);
    else if (this.blinkIn < 0) {
      m.setEyes('closed');
      if (this.blinkIn < -0.13) this.blinkIn = rand(2, 5);
    } else m.setEyes('open');
  }
}
