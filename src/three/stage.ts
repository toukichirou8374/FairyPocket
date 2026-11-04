// 場景：鏡頭、燈光、地面影子、粒子特效與史萊姆球。

import * as THREE from 'three';
import { drawGrid, foodIcon, HEART, HEART_PAL, ITEM_ICONS } from '../pixel';
import { FOOD_IDS, type Food } from '../game/state';

function spriteTex(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textCanvas(text: string, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(20,30,70,0.8)';
  ctx.strokeText(text, 16, 17);
  ctx.fillStyle = color;
  ctx.fillText(text, 16, 17);
  return c;
}

export type ParticleKind = 'heart' | 'zzz' | 'crumb' | 'note' | 'sparkle' | 'dust';

/** 暫用的粉塵粒子：8 張由大到小的白色方點（原版是 generic_7 → generic_0） */
function dustFrames(): THREE.Texture[] {
  return Array.from({ length: 8 }, (_, i) => {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d')!;
    const s = Math.max(1, Math.round(((8 - i) / 8) * 6));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4 - s / 2, 4 - s / 2, s, s);
    return spriteTex(c);
  });
}

/** 可以丟出去的東西：史萊姆球或背包裡的食物 */
export type Throwable = 'slime' | Food;

/** 丟出去的東西能飛到的最遠深度 */
const FAR_Z = -9;

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  gravity: number;
  /** 依存活時間換圖（粉塵粒子會越變越小） */
  frames?: THREE.Texture[];
  /** 飄落時左右擺動的相位 */
  sway?: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  private particles: Particle[] = [];
  private tex: Record<ParticleKind, THREE.Texture[]>;
  private shadow: THREE.Mesh;
  private motes: THREE.Points;
  ball: { kind: Throwable; mesh: THREE.Sprite; shadow: THREE.Mesh; vel: THREE.Vector3; life: number } | null = null;
  private ballTex: THREE.Texture;
  private foodTex = {} as Record<Food, THREE.Texture>;
  private shadowMat: THREE.MeshBasicMaterial;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 1.45, 5.4);
    this.camera.lookAt(0, 1.0, 0);

    this.scene.add(new THREE.HemisphereLight('#e8f6ff', '#7aa0c8', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(2, 5, 4);
    this.scene.add(sun);

    // 柔和的圓形地面
    const floorC = document.createElement('canvas');
    floorC.width = floorC.height = 128;
    const fctx = floorC.getContext('2d')!;
    const fg = fctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    fg.addColorStop(0, 'rgba(255,255,255,0.55)');
    fg.addColorStop(1, 'rgba(255,255,255,0)');
    fctx.fillStyle = fg;
    fctx.fillRect(0, 0, 128, 128);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(floorC), transparent: true, depthWrite: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // 影子
    const shC = document.createElement('canvas');
    shC.width = shC.height = 64;
    const sctx = shC.getContext('2d')!;
    const sg = sctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    sg.addColorStop(0, 'rgba(20,40,90,0.45)');
    sg.addColorStop(1, 'rgba(20,40,90,0)');
    sctx.fillStyle = sg;
    sctx.fillRect(0, 0, 64, 64);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shC), transparent: true, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.scene.add(this.shadow);

    // 空氣中的光點
    const n = 40;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 5;
      arr[i * 3 + 1] = Math.random() * 3.2;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 4 - 0.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.035, transparent: true, opacity: 0.7, depthWrite: false }));
    this.scene.add(this.motes);

    const heart = spriteTex(drawGrid(HEART, HEART_PAL, 4));
    const note = spriteTex(drawGrid(ITEM_ICONS.call.grid, ITEM_ICONS.call.pal, 4));
    const crumb = (col: string) => {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = col;
      ctx.fillRect(0, 0, 4, 4);
      return spriteTex(c);
    };
    const spark = spriteTex(drawGrid(['..w..', '..w..', 'wwyww', '..w..', '..w..'], { w: '#ffffff', y: '#fff6a0' }, 4));
    this.tex = {
      heart: [heart],
      note: [note],
      zzz: [spriteTex(textCanvas('Z', '#ffffff')), spriteTex(textCanvas('z', '#dfe8ff'))],
      crumb: [crumb('#e8b864'), crumb('#c48a3a'), crumb('#e0303a')],
      sparkle: [spark],
      dust: dustFrames(),
    };

    this.ballTex = spriteTex(drawGrid(ITEM_ICONS.slime.grid, ITEM_ICONS.slime.pal, 4));
    for (const f of FOOD_IDS) this.foodTex[f] = spriteTex(foodIcon(f, 4));
  }

  /** 套用原版食物圖示 */
  useFoodImages(img: Partial<Record<Food, CanvasImageSource>>): void {
    for (const [f, src] of Object.entries(img) as [Food, HTMLImageElement][]) {
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d')!.drawImage(src, 0, 0);
      this.foodTex[f] = spriteTex(c);
    }
  }

  /** 套用原版素材（丟出去的史萊姆球、愛心、音符與粉塵粒子） */
  useImages(img: { slime_ball?: CanvasImageSource; particle_heart?: CanvasImageSource; particle_note?: CanvasImageSource } & Partial<Record<`generic_${number}`, CanvasImageSource>>): void {
    const t = (src: CanvasImageSource) => {
      const c = document.createElement('canvas');
      const s = src as HTMLImageElement;
      c.width = s.width;
      c.height = s.height;
      c.getContext('2d')!.drawImage(src, 0, 0);
      return spriteTex(c);
    };
    if (img.slime_ball) this.ballTex = t(img.slime_ball);
    if (img.particle_heart) this.tex.heart = [t(img.particle_heart)];
    if (img.particle_note) {
      this.tex.note = [t(img.particle_note)];
      this.tintNotes = true;
    }
    // 原版彩色粉塵（dust）用 generic_7 → generic_0，由大到小
    const generic = [7, 6, 5, 4, 3, 2, 1, 0].map((i) => img[`generic_${i}`]);
    if (generic.every(Boolean)) this.tex.dust = generic.map((g) => t(g!));
  }
  private tintNotes = false;

  /**
   * hudH：畫面下方介面（愛心、快捷欄）的高度。
   * 畫面中心往上移到介面上方的區域，橫拿手機時悅靈才不會被快捷欄擋住。
   */
  resize(w: number, h: number, hudH = 0): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 橫向時畫面較矮，鏡頭拉近一點讓悅靈不會太小
    this.camera.fov = w > h ? 34 : 42;
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    // 地面（悅靈休息、睡覺的位置）若被介面擋住，就把整個畫面往上移
    const ground = new THREE.Vector3(0, 0, 0).project(this.camera);
    const groundY = ((1 - ground.y) / 2) * h;
    const shift = THREE.MathUtils.clamp(groundY - (h - hudH - 8), 0, h * 0.35);
    if (shift > 0) this.camera.setViewOffset(w, h, 0, shift, w, h);
    this.camera.updateProjectionMatrix();
  }

  /** 悅靈可以活動的範圍（依螢幕寬度調整） */
  bounds() {
    const halfW = Math.max(0.35, 5.4 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect * 0.8 - 0.3);
    // 頭頂不能飛出畫面上緣（橫拿手機時畫面較矮）
    const maxY = THREE.MathUtils.clamp(this.worldYAtScreen(0.9) - 0.8, 1.0, 2.1);
    return { minX: -halfW, maxX: halfW, minY: 0.45, maxY, minZ: -1.6, maxZ: 1.0 };
  }

  /** 畫面上某個高度（-1 底 ~ 1 頂）對應到 z=0 平面上的世界高度 */
  private worldYAtScreen(ndcY: number): number {
    const p = new THREE.Vector3(0, ndcY, 0.5).unproject(this.camera);
    const o = this.camera.position;
    return o.y + ((p.y - o.y) * (0 - o.z)) / (p.z - o.z);
  }

  setShadow(pos: THREE.Vector3): void {
    this.shadow.position.x = pos.x;
    this.shadow.position.z = pos.z;
    const s = THREE.MathUtils.clamp(1.2 - pos.y * 0.3, 0.45, 1.1);
    this.shadow.scale.setScalar(s);
  }

  /** color 只用在粉塵粒子；spread 是散開的範圍 */
  spawn(kind: ParticleKind, at: THREE.Vector3, count = 1, color?: THREE.ColorRepresentation, spread = 0.35): void {
    if (kind === 'dust') return this.spawnDust(at, count, color ?? '#ffffff', spread);
    for (let i = 0; i < count; i++) {
      const list = this.tex[kind];
      const mat = new THREE.SpriteMaterial({ map: list[Math.floor(Math.random() * list.length)], transparent: true, depthWrite: false });
      // 原版音符粒子是灰階，依音高上色
      if (kind === 'note' && this.tintNotes) mat.color.setHSL(Math.random(), 0.9, 0.6);
      const s = new THREE.Sprite(mat);
      const size = kind === 'crumb' ? 0.05 : kind === 'zzz' ? 0.2 : kind === 'sparkle' ? 0.14 : 0.2;
      s.scale.setScalar(size);
      s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.2));
      const vel =
        kind === 'crumb' ? new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.8, Math.random() * 0.5)
        : kind === 'sparkle' ? new THREE.Vector3((Math.random() - 0.5) * 1.4, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 1)
        : kind === 'zzz' ? new THREE.Vector3(0.15, 0.3, 0)
        : new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.5, 0);
      const max = kind === 'zzz' ? 2.2 : kind === 'crumb' ? 0.8 : 1.3;
      this.particles.push({ sprite: s, vel, life: max, max, gravity: kind === 'crumb' ? 3 : 0 });
      this.scene.add(s);
    }
  }

  /**
   * 原版彩色粉塵粒子，像靈粉或細雪：從身體外圍灑出，慢慢飄落、輕輕左右擺，
   * 越變越小後消失（落到地面也會消失，不會一直堆著）。
   */
  private spawnDust(at: THREE.Vector3, count: number, color: THREE.ColorRepresentation, spread: number): void {
    const base = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const frames = this.tex.dust;
      const mat = new THREE.SpriteMaterial({ map: frames[0], transparent: true, depthWrite: false });
      mat.color.copy(base).multiplyScalar(0.8 + Math.random() * 0.2);
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(0.08 + Math.random() * 0.04);
      // 灑在身體外圍一圈，而不是身體裡面
      const a = Math.random() * Math.PI * 2;
      const r = spread * (0.75 + Math.random() * 0.5);
      s.position.copy(at).add(new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.3) * 0.35, Math.sin(a) * r * 0.6));
      const vel = new THREE.Vector3((Math.random() - 0.5) * 0.06, -(0.12 + Math.random() * 0.12), (Math.random() - 0.5) * 0.04);
      const max = 2.6 + Math.random() * 1.6;
      this.particles.push({ sprite: s, vel, life: max, max, gravity: 0, frames, sway: Math.random() * Math.PI * 2 });
      this.scene.add(s);
    }
  }

  /**
   * 丟出史萊姆球或食物。power 0–1 是蓄力程度（只有史萊姆球會用到，食物固定輕輕拋出）。
   */
  throwItem(kind: Throwable, from: THREE.Vector3, dir: THREE.Vector3, power = 0): void {
    this.removeBall();
    const slime = kind === 'slime';
    const map = slime ? this.ballTex : this.foodTex[kind];
    const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true }));
    mesh.scale.setScalar(0.28);
    mesh.position.copy(from);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(from.x, 0.012, from.z);
    this.scene.add(mesh, shadow);
    const speed = slime ? 3.2 + 8 * power : 3.4;
    const up = slime ? 1.9 + 1.6 * power : 1.8;
    this.ball = { kind, mesh, shadow, vel: dir.clone().multiplyScalar(speed).add(new THREE.Vector3(0, up, 0)), life: 9 + 3 * power };
  }

  removeBall(): void {
    if (!this.ball) return;
    this.scene.remove(this.ball.mesh, this.ball.shadow);
    this.ball.mesh.material.dispose();
    this.ball.shadow.geometry.dispose();
    this.ball = null;
  }

  // ---------- 音符盒 ----------

  noteBlock: THREE.Mesh | null = null;
  private noteTex: THREE.Texture = spriteTex(drawGrid(ITEM_ICONS.noteblock.grid, ITEM_ICONS.noteblock.pal, 1));

  /** 放到地面上某個位置（已經有就搬過去） */
  placeNoteBlock(at: THREE.Vector3): void {
    if (!this.noteBlock) {
      this.noteBlock = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), new THREE.MeshLambertMaterial({ map: this.noteTex }));
      this.scene.add(this.noteBlock);
    }
    this.noteBlock.position.set(at.x, 0.21, at.z);
    this.noteBlock.rotation.y = 0.35;
  }

  removeNoteBlock(): void {
    if (!this.noteBlock) return;
    this.scene.remove(this.noteBlock);
    this.noteBlock.geometry.dispose();
    (this.noteBlock.material as THREE.Material).dispose();
    this.noteBlock = null;
  }

  /** 彈奏時方塊輕輕一跳 */
  bumpNoteBlock(): void {
    if (this.noteBlock) this.noteBlock.scale.setScalar(1.15);
  }

  useNoteBlockImage(img: CanvasImageSource): void {
    const c = document.createElement('canvas');
    const s = img as HTMLImageElement;
    c.width = s.width;
    c.height = s.height;
    c.getContext('2d')!.drawImage(img, 0, 0);
    this.noteTex = spriteTex(c);
    if (this.noteBlock) (this.noteBlock.material as THREE.MeshLambertMaterial).map = this.noteTex;
  }

  itemTexture(kind: Throwable): THREE.Texture {
    return kind === 'slime' ? this.ballTex : this.foodTex[kind];
  }

  /** 某個深度下畫面左右可見的半寬 */
  private halfWidthAt(z: number): number {
    const dist = this.camera.position.z - z;
    return dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect * 0.85;
  }

  update(dt: number, t: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      if (p.sway !== undefined) {
        p.sway += dt * 2.2;
        p.sprite.position.x += Math.cos(p.sway) * 0.05 * dt;
        if (p.sprite.position.y < 0.03) p.life = 0; // 落地就消失
      }
      if (p.frames) {
        const f = p.frames[Math.min(p.frames.length - 1, Math.floor((1 - p.life / p.max) * p.frames.length))];
        if (p.sprite.material.map !== f) {
          p.sprite.material.map = f;
          p.sprite.material.needsUpdate = true;
        }
      } else p.sprite.material.opacity = Math.min(1, (p.life / p.max) * 2);
      if (p.life <= 0) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
      }
    }
    if (this.noteBlock) this.noteBlock.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-10 * dt));
    this.motes.position.y = Math.sin(t * 0.2) * 0.1;
    this.motes.rotation.y = t * 0.02;

    const b = this.ball;
    if (b) {
      b.life -= dt;
      b.vel.y -= 6 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      const p = b.mesh.position;
      const slime = b.kind === 'slime';
      if (p.y < 0.12) {
        p.y = 0.12;
        // 史萊姆球會彈；食物落地只輕輕彈一下就停住
        b.vel.y = Math.abs(b.vel.y) * (slime ? 0.62 : 0.2);
        b.vel.x *= slime ? 0.8 : 0.4;
        b.vel.z *= slime ? 0.8 : 0.4;
        if (slime) b.mesh.scale.set(0.35, 0.2, 1);
      }
      b.mesh.scale.lerp(new THREE.Vector3(0.28, 0.28, 1), 1 - Math.exp(-8 * dt));
      const hw = this.halfWidthAt(p.z);
      for (const [k, lo, hi] of [['x', -hw, hw], ['z', FAR_Z, 2.2]] as const) {
        if (p[k] < lo || p[k] > hi) {
          p[k] = THREE.MathUtils.clamp(p[k], lo, hi);
          b.vel[k] *= -0.6;
        }
      }
      b.shadow.position.set(p.x, 0.012, p.z);
      b.shadow.scale.setScalar(THREE.MathUtils.clamp(1.2 - p.y * 0.3, 0.4, 1.1));
      if (b.life <= 0) this.removeBall();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
