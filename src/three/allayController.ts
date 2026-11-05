// 悅靈的行為大腦、飛行運動與動作動畫。

import * as THREE from 'three';
import type { AllayModel } from './allayModel';
import type { LineKind } from '../game/dialogue';
import { moodLevel, PERSONALITY_COLOR, type Personality, type PetState } from '../game/state';

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
}

export interface Hooks {
  say(kind: LineKind): void;
  particle(kind: 'heart' | 'zzz' | 'crumb' | 'note' | 'sparkle' | 'dust', at: THREE.Vector3, count?: number, color?: string, spread?: number): void;
  caught(): void;
  /** 飛到蛋糕旁邊了（可以吃一片） */
  atCake?(): void;
  /** 情境音效（拍翅、衝刺、打呼、吃東西、醒來…） */
  sfx?(e: 'flap' | 'dash' | 'snore' | 'bite' | 'burp' | 'wake' | 'startle', at: THREE.Vector3): void;
}

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

    switch (this.mode) {
      case 'idle': {
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
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
      case 'flourish': {
        // 繞一圈小小的 8 字飛舞
        const a = (this.modeTime / this.modeDur) * Math.PI * 2;
        this.target.set(this.anchor.x + Math.sin(a) * 0.55, this.anchor.y + Math.sin(a * 2) * 0.18, this.anchor.z + (1 - Math.cos(a)) * 0.3);
        speed *= 1.6;
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
        if (this.pet.energy < 12) {
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
        // 白天小睡至少睡 20 秒
        if (this.pet.energy >= 100 && !this.world.night() && this.modeTime > 20) {
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
    this.move(dt, speed);
    this.animate(dt);
    this.aura(dt);
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
    this.anchor.copy(this.pos);
    this.clampVec(this.anchor);
    this.setMode('idle', rand(2.5, 6));
  }

  private decide(): void {
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
    const facePlayer = this.mode === 'startled' || this.mode === 'sleep' || this.mode === 'rest' || this.mode === 'eat' || this.mode === 'wave';
    const lying = this.lying;
    if (lying) wantYaw = this.world.bedYaw?.() ?? 0;
    else if (this.posed) {
      const cam = this.world.camera.position;
      wantYaw = Math.atan2(cam.x - this.pos.x, cam.z - this.pos.z) + this.poseYaw;
    } else if (hspeed > 0.25 && !facePlayer) wantYaw = Math.atan2(this.vel.x, this.vel.z);
    else {
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
    this.flapPhase += flapRate * dt;
    const amp = sleeping ? 0.03 : this.mode === 'rest' ? 0.25 : Math.PI * 0.15;
    const open = sleeping ? 0.12 : Math.PI / 4 - mv * 0.3;
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
    m.armL.rotation.x = THREE.MathUtils.lerp(m.armL.rotation.x, armX, k(10));
    m.armR.rotation.x = m.armL.rotation.x;
    m.armL.rotation.z = THREE.MathUtils.lerp(m.armL.rotation.z, armZ, k(10));
    m.armR.rotation.z = -m.armL.rotation.z;
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
    // 懊惱：低頭、左右搖頭
    if (oops) { headX += 0.4 * oops; headY = Math.sin(this.modeTime * 13) * 0.45 * oops; }
    m.head.rotation.x = THREE.MathUtils.lerp(m.head.rotation.x, headX, k(6));
    m.head.rotation.y = dancing || oops ? headY : THREE.MathUtils.lerp(m.head.rotation.y, headY, k(6));
    m.head.rotation.z = dancing ? sway * 0.524 : this.mode === 'curious' || this.mode === 'observe' ? Math.sin(this.t * 2) * 0.2 : this.mode === 'listen' ? 0.35 : this.mode === 'wave' ? Math.sin(this.modeTime * 9 + 0.8) * 0.18 * this.waveAmount() : 0; // 頭歪 30°

    // 眼睛：眨眼 / 睡覺 / 開心
    this.blinkIn -= dt;
    if (sleeping || this.mode === 'rest' && this.modeTime > 4 || oops > 0.3) m.setEyes('closed');
    else if (this.mode === 'happy' || this.mode === 'tickled' || this.mode === 'eat' || this.mode === 'wave' || this.mode === 'bath' || this.mode === 'flip' || dancing) m.setEyes('happy');
    else if (this.blinkIn < 0) {
      m.setEyes('closed');
      if (this.blinkIn < -0.13) this.blinkIn = rand(2, 5);
    } else m.setEyes('open');
  }
}
