// 悅靈的行為大腦、飛行運動與動作動畫。

import * as THREE from 'three';
import type { AllayModel } from './allayModel';
import type { LineKind } from '../game/dialogue';
import type { Personality, PetState } from '../game/state';

export type Mode =
  | 'idle' | 'wander' | 'approach' | 'called' | 'rest' | 'sleep'
  | 'play' | 'eat' | 'happy' | 'tickled' | 'startled' | 'curious' | 'waking';

interface Traits {
  speed: number; // 最高飛行速度
  range: number; // 遊蕩範圍倍率
  nearDist: number; // 靠近玩家時的距離
  wander: number; // 以下為 decide() 的權重
  approach: number;
  spin: number;
  stay: number; // 靠近玩家後停留秒數
  startle: number; // 被突然叫醒時受驚的機率
}

export const TRAITS: Record<Personality, Traits> = {
  guardian: { speed: 1.5, range: 0.6, nearDist: 3.2, wander: 1, approach: 3, spin: 0.4, stay: 10, startle: 0.1 },
  brave: { speed: 2.3, range: 1.0, nearDist: 3.6, wander: 3, approach: 1, spin: 0.8, stay: 4, startle: 0 },
  cautious: { speed: 1.1, range: 0.55, nearDist: 4.2, wander: 1.2, approach: 0.6, spin: 0.2, stay: 5, startle: 0.7 },
  playful: { speed: 1.9, range: 0.9, nearDist: 3.4, wander: 2, approach: 1.5, spin: 2.2, stay: 5, startle: 0.15 },
};

export interface World {
  camera: THREE.PerspectiveCamera;
  bounds(): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  night(): boolean;
}

export interface Hooks {
  say(kind: LineKind): void;
  particle(kind: 'heart' | 'zzz' | 'crumb' | 'note' | 'sparkle', at: THREE.Vector3, count?: number): void;
  caught(): void;
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
    const startled = Math.random() < this.tr.startle;
    this.setMode(startled ? 'startled' : 'waking', startled ? 1 : 1.2);
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
  lookAt(p: THREE.Vector3): void {
    if (!this.awake || this.mode === 'play' || this.mode === 'eat') return;
    if (this.pet.personality === 'cautious' && Math.random() < 0.5) return;
    this.target.copy(p);
    this.clampTarget();
    this.setMode('curious', 4);
    if (Math.random() < 0.3) this.hooks.say('curious');
  }

  chaseBall(): void {
    if (!this.awake) return;
    this.setMode('play', 9);
  }

  // ---------- 每幀更新 ----------

  update(dt: number): void {
    this.t += dt;
    this.modeTime += dt;
    const tr = this.tr;
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
      case 'curious':
        if (this.pos.distanceTo(this.target) < 0.2 || this.modeTime > 7) this.toIdle();
        break;
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
      case 'sleep': {
        this.target.set(this.anchor.x, b.minY + 0.1, this.anchor.z);
        speed *= 0.3;
        this.zzzIn -= dt;
        if (this.zzzIn <= 0) {
          this.zzzIn = 1.6;
          this.hooks.particle('zzz', this.headTop(tmp));
        }
        if (this.pet.energy >= 100 && !this.world.night()) {
          this.setMode('waking', 1.2);
          this.hooks.say('wake');
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
        }
        if (this.modeTime > this.modeDur) this.setMode('happy', 0.9);
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
      case 'waking':
        this.target.set(this.pos.x, b.minY + 0.6, this.pos.z);
        speed *= 0.6;
        if (this.modeTime > this.modeDur) this.toIdle();
        break;
    }

    if (this.mode !== 'play') this.clampTarget();
    this.move(dt, speed);
    this.animate(dt);
  }

  private toIdle(): void {
    this.anchor.copy(this.pos);
    this.clampVec(this.anchor);
    this.setMode('idle', rand(2.5, 6));
  }

  private decide(): void {
    const tr = this.tr;
    if (this.pet.energy < 25) {
      this.anchor.set(rand(-0.3, 0.3), 0, rand(-0.4, 0.6));
      this.setMode('rest', rand(10, 20));
      if (Math.random() < 0.5) this.hooks.say('sleepy');
      return;
    }
    const opts: [number, () => void][] = [
      [tr.wander, () => {
        const b = this.world.bounds();
        const r = tr.range;
        this.target.set(rand(b.minX, b.maxX) * r, rand(b.minY + 0.3, b.maxY), rand(b.minZ * r, b.maxZ));
        this.setMode('wander', 7);
      }],
      [tr.approach, () => this.setMode('approach', tr.stay)],
      [tr.spin, () => {
        this.setMode('happy', 0.9);
        this.hooks.particle('note', this.headTop(tmp), 1);
      }],
      [1.2, () => this.setMode('idle', rand(2, 5))],
    ];
    let r = Math.random() * opts.reduce((s, o) => s + o[0], 0);
    for (const [w, f] of opts) {
      r -= w;
      if (r <= 0) return f();
    }
  }

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
    const facePlayer = this.mode === 'startled' || this.mode === 'sleep' || this.mode === 'rest' || this.mode === 'eat';
    if (hspeed > 0.25 && !facePlayer) wantYaw = Math.atan2(this.vel.x, this.vel.z);
    else {
      const cam = this.world.camera.position;
      wantYaw = Math.atan2(cam.x - this.pos.x, cam.z - this.pos.z);
    }
    const prevYaw = this.yaw;
    const d = angleDiff(this.yaw, wantYaw);
    this.yaw += THREE.MathUtils.clamp(d * 4 * dt, -3.5 * dt, 3.5 * dt);
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, (this.yaw - prevYaw) / Math.max(dt, 1e-4), 1 - Math.exp(-6 * dt));

    // 轉圈動作
    if (this.mode === 'happy' || this.mode === 'tickled') {
      const k = Math.min(1, this.modeTime / this.modeDur);
      this.spin = (this.mode === 'tickled' ? 4 : 2) * Math.PI * (1 - Math.pow(1 - k, 3));
    } else this.spin = 0;

    // 以下動作數值參照原版悅靈的動畫（翅膀 45°±27°、手臂外張 25° 慢擺、飛行時身體前傾 45°）
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    const fwd = Math.cos(this.yaw) * this.vel.z + Math.sin(this.yaw) * this.vel.x;
    this.moveAmt = THREE.MathUtils.lerp(this.moveAmt, sleeping ? 0 : THREE.MathUtils.clamp(fwd / 1.2, 0, 1), k(5));
    const mv = this.moveAmt;
    const still = 1 - mv;

    m.root.position.copy(this.pos);
    const bob = sleeping ? Math.sin(this.t * 1.2) * 0.02 : Math.sin(this.t * 2.2) * 0.03 + Math.cos(this.t * Math.PI) * 0.025 * still;
    m.root.position.y += bob + (this.mode === 'happy' ? Math.sin(Math.min(1, this.modeTime / this.modeDur) * Math.PI) * 0.18 : 0);
    m.root.rotation.y = this.yaw + this.spin;

    // 轉彎側傾；睡覺時整體微微前傾
    const wantRoll = THREE.MathUtils.clamp(-this.yawRate * 0.12, -0.5, 0.5) + (this.mode === 'tickled' ? Math.sin(this.t * 30) * 0.15 : 0);
    this.roll = THREE.MathUtils.lerp(this.roll, wantRoll, k(4));
    this.pitch = THREE.MathUtils.lerp(this.pitch, sleeping ? 0.2 : 0, k(3));
    m.tilt.rotation.set(this.pitch, 0, this.roll);
    // 飛行時只有身體前傾，頭保持
    m.body.rotation.x = mv * (Math.PI / 4);

    // 翅膀
    let flapRate = 7 + mv * 3;
    if (this.mode === 'rest') flapRate = 4;
    if (sleeping) flapRate = 1.2;
    if (this.mode === 'happy' || this.mode === 'tickled' || this.mode === 'called') flapRate += 4;
    this.flapPhase += flapRate * dt;
    const amp = sleeping ? 0.03 : this.mode === 'rest' ? 0.25 : Math.PI * 0.15;
    const open = sleeping ? 0.12 : Math.PI / 4 - mv * 0.3;
    this.wingSpread = THREE.MathUtils.lerp(this.wingSpread, open - Math.cos(this.flapPhase) * amp, k(20));
    this.wingTilt = THREE.MathUtils.lerp(this.wingTilt, sleeping ? 0.1 : 0.4363 * still, k(6));
    m.setWings(this.wingSpread, this.wingTilt);

    // 手臂：平常外張慢擺；拿東西（吃）時往前舉
    const hold = this.mode === 'eat' ? 1 : 0;
    this.holdAmt = THREE.MathUtils.lerp(this.holdAmt, hold, k(8));
    const h = this.holdAmt;
    let armX = h * THREE.MathUtils.lerp(-Math.PI / 3, -1.134, mv) + (this.mode === 'eat' ? Math.sin(this.modeTime * 14) * 0.1 : 0);
    let armZ = 0.4363 - Math.cos(this.t * Math.PI + Math.PI * 1.5) * Math.PI * 0.075 * still * (1 - h);
    if (this.mode === 'happy' || this.mode === 'tickled') { armX = -0.6 + Math.sin(this.t * 18) * 0.4; armZ = 0.7; }
    if (sleeping) { armX = 0; armZ = 0.15; }
    m.armL.rotation.x = THREE.MathUtils.lerp(m.armL.rotation.x, armX, k(10));
    m.armR.rotation.x = m.armL.rotation.x;
    m.armL.rotation.z = THREE.MathUtils.lerp(m.armL.rotation.z, armZ, k(10));
    m.armR.rotation.z = -m.armL.rotation.z;
    m.armL.rotation.y = 0.2793 * h;
    m.armR.rotation.y = -0.2793 * h;

    // 頭：自動看向玩家
    const cam = this.world.camera.position;
    let headY = this.spin ? 0 : THREE.MathUtils.clamp(angleDiff(this.yaw, Math.atan2(cam.x - this.pos.x, cam.z - this.pos.z)), -1, 1);
    let headX = -THREE.MathUtils.clamp(Math.atan2(cam.y - this.pos.y - 0.25, Math.hypot(cam.x - this.pos.x, cam.z - this.pos.z)), -0.6, 0.6);
    if (this.mode === 'eat') headX = 0.25 + Math.sin(this.modeTime * 14) * 0.12;
    if (sleeping) { headX = 0.35 + Math.sin(this.t * 1.2) * 0.03; headY = 0; }
    m.head.rotation.x = THREE.MathUtils.lerp(m.head.rotation.x, headX, k(6));
    m.head.rotation.y = THREE.MathUtils.lerp(m.head.rotation.y, headY, k(6));
    m.head.rotation.z = this.mode === 'curious' ? Math.sin(this.t * 2) * 0.2 : 0;

    // 眼睛：眨眼 / 睡覺 / 開心
    this.blinkIn -= dt;
    if (sleeping || this.mode === 'rest' && this.modeTime > 4) m.setEyes('closed');
    else if (this.mode === 'happy' || this.mode === 'tickled' || this.mode === 'eat') m.setEyes('happy');
    else if (this.blinkIn < 0) {
      m.setEyes('closed');
      if (this.blinkIn < -0.13) this.blinkIn = rand(2, 5);
    } else m.setEyes('open');
  }
}
