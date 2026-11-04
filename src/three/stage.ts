// 場景：鏡頭、燈光、地面影子、粒子特效與史萊姆球。

import * as THREE from 'three';
import { drawGrid, foodIcon, HEART, HEART_PAL, ITEM_ICONS } from '../pixel';
import { FOOD_IDS, type Food } from '../game/state';
import type { BiomeStyle } from './biome';

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

/** 把原版灰階材質（草地、睡蓮葉…）染上顏色，保留透明度 */
function tinted(src: HTMLImageElement, tint?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  if (tint) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(src, 0, 0);
  }
  return c;
}

/** 床的大小（1 個方塊；悅靈躺得下） */
const BED = 1;
const BED_FACES = ['head_up', 'foot_up', 'head_east', 'head_west', 'foot_east', 'foot_west', 'foot_south', 'head_north', 'down'] as const;
type BedFace = (typeof BED_FACES)[number];

/** 原版煙火常見的顏色 */
const FIREWORK_COLORS = ['#ff5050', '#ffa030', '#ffe040', '#70ff60', '#60c8ff', '#c070ff', '#ff80c0', '#ffffff'];

/** 暫用的火花：8 張由大到小的十字 */
function sparkFrames(): THREE.Texture[] {
  return Array.from({ length: 8 }, (_, i) => {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    const r = Math.max(0, 3 - Math.floor(i / 2));
    ctx.fillRect(4 - r, 3, r * 2 + 1, 1);
    ctx.fillRect(3 + 0, 4 - r, 1, r * 2 + 1);
    return spriteTex(c);
  });
}

/** 蛋糕方塊的邊長（世界單位） */
const CAKE = 0.5;

/** 暫用材質：上半部一種顏色、下半部另一種（rows 為下半部從第幾列開始） */
function solid(top: string, bottom = top, rows = 0): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, 16, 16);
  if (rows) {
    ctx.fillStyle = bottom;
    ctx.fillRect(0, rows + 2, 16, 16 - rows - 2);
  } else if (bottom !== top) {
    // 頂面的紅色小點（像原版的櫻桃糖霜）
    ctx.fillStyle = bottom;
    for (const [x, y] of [[4, 4], [10, 6], [6, 11], [12, 12]]) ctx.fillRect(x, y, 1, 1);
  }
  return c;
}

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
  private softFloor!: THREE.Mesh;
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
    this.softFloor = floor;

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

  // ---------- 蛋糕（原版方塊：寬 14、高 8 像素，共 7 片，從一側一片一片吃掉） ----------

  cake: THREE.Mesh | null = null;
  /** 已經吃掉幾片（0–6） */
  cakeBites = 0;
  private cakeTex: Record<'top' | 'side' | 'bottom' | 'inner', THREE.Texture> = {
    top: spriteTex(solid('#f4f0ea', '#d83838')),
    side: spriteTex(solid('#f4f0ea', '#a8582c', 8)),
    bottom: spriteTex(solid('#a8582c')),
    inner: spriteTex(solid('#f4f0ea', '#c87a3a', 8)),
  };

  /** 在地上放一個完整的蛋糕（已經有就換成新的） */
  placeCake(at: THREE.Vector3): void {
    this.removeCake();
    this.cakeBites = 0;
    this.cake = new THREE.Mesh(this.cakeGeometry(0), this.cakeMaterials());
    this.cake.position.set(at.x, 0, at.z);
    this.cake.rotation.y = 0.35;
    this.scene.add(this.cake);
  }

  /** 吃一片；回傳還剩幾片（0 代表吃完、蛋糕消失） */
  biteCake(): number {
    if (!this.cake) return 0;
    this.cakeBites++;
    this.spawn('crumb', this.cake.position.clone().add(new THREE.Vector3(0, CAKE * 0.5, 0)), 4);
    if (this.cakeBites >= 7) {
      this.removeCake();
      return 0;
    }
    this.cake.geometry.dispose();
    this.cake.geometry = this.cakeGeometry(this.cakeBites);
    this.cake.material = this.cakeMaterials();
    return 7 - this.cakeBites;
  }

  removeCake(): void {
    if (!this.cake) return;
    this.scene.remove(this.cake);
    this.cake.geometry.dispose();
    this.cake = null;
  }

  useCakeImages(img: { cake_top?: CanvasImageSource; cake_side?: CanvasImageSource; cake_bottom?: CanvasImageSource; cake_inner?: CanvasImageSource }): void {
    const t = (src?: CanvasImageSource) => {
      if (!src) return null;
      const s = src as HTMLImageElement;
      const c = document.createElement('canvas');
      c.width = s.width;
      c.height = s.height;
      c.getContext('2d')!.drawImage(src, 0, 0);
      return spriteTex(c);
    };
    this.cakeTex = {
      top: t(img.cake_top) ?? this.cakeTex.top,
      side: t(img.cake_side) ?? this.cakeTex.side,
      bottom: t(img.cake_bottom) ?? this.cakeTex.bottom,
      inner: t(img.cake_inner) ?? this.cakeTex.inner,
    };
    if (this.cake) this.cake.material = this.cakeMaterials();
  }

  private cakeMaterials(): THREE.Material[] {
    const m = (map: THREE.Texture) => new THREE.MeshLambertMaterial({ map, transparent: true, alphaTest: 0.1 });
    const side = m(this.cakeTex.side);
    // 面的順序：+x, -x（被吃掉的切面）, 頂, 底, +z, -z
    return [side, this.cakeBites ? m(this.cakeTex.inner) : side, m(this.cakeTex.top), m(this.cakeTex.bottom), side, side];
  }

  /** 原版蛋糕模型：x 從 1+2×已吃片數 到 15、高 0–8、z 1–15（像素） */
  private cakeGeometry(bites: number): THREE.BoxGeometry {
    const x0 = 1 + 2 * bites, x1 = 15;
    const g = new THREE.BoxGeometry(((x1 - x0) / 16) * CAKE, (8 / 16) * CAKE, (14 / 16) * CAKE);
    g.translate(((x0 + x1) / 32 - 0.5) * CAKE, (4 / 16) * CAKE, 0);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const face = (f: number, u0: number, u1: number, v0: number, v1: number) => {
      const i = f * 4;
      uv.setXY(i, u0 / 16, 1 - v0 / 16);
      uv.setXY(i + 1, u1 / 16, 1 - v0 / 16);
      uv.setXY(i + 2, u0 / 16, 1 - v1 / 16);
      uv.setXY(i + 3, u1 / 16, 1 - v1 / 16);
    };
    face(0, 1, 15, 8, 16);
    face(1, 1, 15, 8, 16);
    face(2, x0, x1, 1, 15);
    face(3, x0, x1, 1, 15);
    face(4, x0, x1, 8, 16);
    face(5, 16 - x1, 16 - x0, 8, 16);
    uv.needsUpdate = true;
    return g;
  }

  // ---------- 生態域背景：地面方塊、植物、天氣 ----------

  private ground: THREE.Mesh | null = null;
  private plants = new THREE.Group();
  private weather: BiomeStyle['weather'] = null;
  private weatherIn = 0;

  /** 換生態域；img 是素材包裡讀到的材質（原版路徑 → 圖片），沒有就用純色 */
  setBiome(style: BiomeStyle, img: Record<string, HTMLImageElement | undefined>): void {
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
    }
    this.scene.remove(this.plants);
    this.plants = new THREE.Group();
    // 地面：一大片重複的方塊材質，邊緣慢慢淡出
    const SIZE = 10;
    const fade = document.createElement('canvas');
    fade.width = fade.height = 128;
    const fc = fade.getContext('2d')!;
    const g = fc.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.55, '#fff');
    g.addColorStop(1, '#000');
    fc.fillStyle = g;
    fc.fillRect(0, 0, 128, 128);
    const groundImg = img[style.ground];
    const mat = new THREE.MeshBasicMaterial({ alphaMap: new THREE.CanvasTexture(fade), transparent: true, depthWrite: false });
    if (groundImg) {
      const t = spriteTex(tinted(groundImg, style.groundTint));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(SIZE / 0.75, SIZE / 0.75);
      mat.map = t;
      mat.color.setScalar(0.92);
    } else mat.color.set(style.groundColor);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.002;
    this.ground.renderOrder = -1;
    this.scene.add(this.ground);
    this.softFloor.visible = false;

    // 植物：固定的位置（每次換回同一個生態域看起來都一樣），避開中間悅靈活動的地方
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const p of style.plants) {
      const src = img[p.tex];
      if (!src) continue;
      const tex = spriteTex(tinted(src, p.tint));
      for (let i = 0; i < p.count; i++) {
        let x = 0, z = 0;
        do {
          x = (rnd() - 0.5) * 6.4;
          z = -2.8 + rnd() * 4;
        } while (Math.hypot(x, z) < 1);
        const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
        const size = 0.5;
        if (p.flat) {
          const pad = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
          pad.rotation.set(-Math.PI / 2, 0, rnd() * Math.PI * 2);
          pad.position.set(x, 0.004, z);
          this.plants.add(pad);
        } else {
          // 像原版的花草：兩片交叉的平面
          const plant = new THREE.Group();
          for (const r of [Math.PI / 4, -Math.PI / 4]) {
            const q = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
            q.rotation.y = r;
            plant.add(q);
          }
          plant.position.set(x, size / 2, z);
          plant.rotation.y = rnd() * Math.PI;
          this.plants.add(plant);
        }
      }
    }
    this.scene.add(this.plants);
    this.weather = style.weather;
    // 有天氣粒子時就不用原本的白色光點
    this.motes.visible = !style.weather;
  }

  /** AR 模式：相機畫面當背景，藏起地面、植物與天氣（保留悅靈的影子） */
  setAR(on: boolean): void {
    if (this.ground) this.ground.visible = !on;
    this.plants.visible = !on;
    this.motes.visible = !on && !this.weather;
    this.arMode = on;
  }
  private arMode = false;

  private spawnWeather(): void {
    const w = this.weather!;
    const frame = this.tex.dust[w.kind === 'snow' ? 2 : 4];
    const mat = new THREE.SpriteMaterial({ map: frame, transparent: true, depthWrite: false });
    mat.color.set(w.color).multiplyScalar(0.85 + Math.random() * 0.15);
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(w.kind === 'snow' ? 0.07 + Math.random() * 0.05 : 0.06 + Math.random() * 0.04);
    const x = (Math.random() - 0.5) * 7, z = -2.8 + Math.random() * 4.5;
    let vel: THREE.Vector3, life: number;
    if (w.kind === 'snow') {
      s.position.set(x, 3.4, z);
      vel = new THREE.Vector3((Math.random() - 0.5) * 0.1, -(0.45 + Math.random() * 0.25), 0);
      life = 8;
    } else if (w.kind === 'spore') {
      s.position.set(x, 0.05 + Math.random() * 0.5, z);
      vel = new THREE.Vector3((Math.random() - 0.5) * 0.08, 0.12 + Math.random() * 0.1, 0);
      life = 6;
    } else if (w.kind === 'ash') {
      s.position.set(x, Math.random() * 2.8, z);
      vel = new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.05 + Math.random() * 0.1, (Math.random() - 0.5) * 0.05);
      life = 4;
    } else {
      s.position.set(x, 0.3 + Math.random() * 2.4, z);
      vel = new THREE.Vector3((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.04, 0);
      life = 5;
    }
    this.particles.push({ sprite: s, vel, life, max: life, gravity: 0, sway: Math.random() * Math.PI * 2 });
    this.scene.add(s);
  }

  // ---------- 床（原版紅色床：寬 16、高 9、長 32 像素，床頭朝後） ----------

  bed: THREE.Group | null = null;
  private bedTex: Partial<Record<BedFace, THREE.Texture>> = {};

  placeBed(at: THREE.Vector3): void {
    this.removeBed();
    const g = new THREE.Group();
    const S = BED;
    const box = (head: boolean) => {
      const geo = new THREE.BoxGeometry(S, (9 / 16) * S, S);
      geo.translate(0, (4.5 / 16) * S, head ? -S / 2 : S / 2);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      // 側面只用材質下半部 9 像素
      for (const face of [0, 1, 4, 5]) {
        const i = face * 4;
        uv.setXY(i, 0, 9 / 16);
        uv.setXY(i + 1, 1, 9 / 16);
        uv.setXY(i + 2, 0, 0);
        uv.setXY(i + 3, 1, 0);
      }
      const m = (k: BedFace, color: string) =>
        new THREE.MeshLambertMaterial({ map: this.bedTex[k] ?? null, color: this.bedTex[k] ? '#ffffff' : color, transparent: true, alphaTest: 0.1 });
      // 面的順序：+x（東）, -x（西）, 頂, 底, +z（南，床尾）, -z（北，床頭）
      const mats = head
        ? [m('head_east', '#c83030'), m('head_west', '#c83030'), m('head_up', '#f0f0f0'), m('down', '#8a5a30'), m('head_up', '#c83030'), m('head_north', '#8a5a30')]
        : [m('foot_east', '#c83030'), m('foot_west', '#c83030'), m('foot_up', '#c83030'), m('down', '#8a5a30'), m('foot_south', '#8a5a30'), m('foot_up', '#c83030')];
      return new THREE.Mesh(geo, mats);
    };
    g.add(box(true), box(false));
    this.blanket = null;
    g.position.set(at.x, 0, at.z);
    g.rotation.y = 0.35;
    this.bed = g;
    this.scene.add(g);
  }

  removeBed(): void {
    if (!this.bed) return;
    this.scene.remove(this.bed);
    this.bed = null;
    this.blanket = null;
  }

  /** 悅靈躺下的位置：頭靠在枕頭上（脖子在床頭半格的位置） */
  bedSpot(out: THREE.Vector3): THREE.Vector3 {
    const b = this.bed!;
    return out.set(0, (9 / 16) * BED + 0.05, -BED * 0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.rotation.y).add(b.position);
  }

  /** 床的方向（悅靈躺下時跟著轉） */
  bedYaw(): number {
    return this.bed?.rotation.y ?? 0;
  }

  private blanket: THREE.Mesh | null = null;

  /** 悅靈睡在床上時蓋上被子（原版床尾的紅色被子） */
  setBlanket(on: boolean): void {
    if (!this.bed) return;
    if (!this.blanket) {
      const h = 0.2;
      const geo = new THREE.BoxGeometry(BED * 0.98, h, BED * 1.42);
      geo.translate(0, (9 / 16) * BED + h / 2, BED * 0.28);
      const top = new THREE.MeshLambertMaterial({ map: this.bedTex.foot_up ?? null, color: this.bedTex.foot_up ? '#ffffff' : '#c83030' });
      const side = new THREE.MeshLambertMaterial({ color: '#a82828' });
      this.blanket = new THREE.Mesh(geo, [side, side, top, side, side, side]);
      this.bed.add(this.blanket);
    }
    this.blanket.visible = on;
  }

  useBedImages(img: Partial<Record<`bed_${BedFace}`, HTMLImageElement>>): void {
    for (const k of BED_FACES) {
      const src = img[`bed_${k}`];
      if (src) this.bedTex[k] = spriteTex(tinted(src));
    }
    if (this.bed) this.placeBed(this.bed.position);
  }

  // ---------- 唱片機 ----------

  jukebox: THREE.Mesh | null = null;
  private jukeTex: { side: THREE.Texture | null; top: THREE.Texture | null } = { side: null, top: null };

  placeJukebox(at: THREE.Vector3): void {
    if (!this.jukebox) {
      const m = (t: THREE.Texture | null, c: string) => new THREE.MeshLambertMaterial({ map: t, color: t ? '#ffffff' : c });
      const side = m(this.jukeTex.side, '#7a4a2a');
      const top = m(this.jukeTex.top, '#5a3420');
      this.jukebox = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), [side, side, top, side, side, side]);
      this.scene.add(this.jukebox);
    }
    this.jukebox.position.set(at.x, 0.21, at.z);
    this.jukebox.rotation.y = -0.35;
  }

  useJukeboxImages(img: { jukebox_side?: HTMLImageElement; jukebox_top?: HTMLImageElement }): void {
    if (img.jukebox_side) this.jukeTex.side = spriteTex(tinted(img.jukebox_side));
    if (img.jukebox_top) this.jukeTex.top = spriteTex(tinted(img.jukebox_top));
    if (this.jukebox) {
      const at = this.jukebox.position.clone();
      this.scene.remove(this.jukebox);
      this.jukebox = null;
      this.placeJukebox(at);
    }
  }

  // ---------- 煙火（原版的火花粒子 spark_7 → spark_0） ----------

  private rockets: { sprite: THREE.Sprite; vel: THREE.Vector3; fuse: number; color: THREE.Color; trail: number }[] = [];
  private rocketTex: THREE.Texture = spriteTex(drawGrid(ITEM_ICONS.firework.grid, ITEM_ICONS.firework.pal, 4));
  private sparkTex: THREE.Texture[] = sparkFrames();
  /** 煙火炸開時呼叫（播放爆炸聲用） */
  onBurst: ((at: THREE.Vector3) => void) | null = null;

  /** 放煙火：在畫面上緣附近炸開（橫拿手機時也看得到） */
  launchFirework(at: THREE.Vector3): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.rocketTex, transparent: true, depthWrite: false }));
    sprite.scale.setScalar(0.32);
    sprite.position.set(at.x, 0.15, at.z);
    const color = new THREE.Color(FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)]);
    this.rockets.push({ sprite, vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 3.4, (Math.random() - 0.5) * 0.3), fuse: Math.max(0.35, (this.bounds().maxY + 0.2 - 0.15) / 3.4) + Math.random() * 0.12, color, trail: 0 });
    this.scene.add(sprite);
  }

  private spark(at: THREE.Vector3, vel: THREE.Vector3, color: THREE.Color, life: number, size: number, gravity: number): void {
    const mat = new THREE.SpriteMaterial({ map: this.sparkTex[0], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.color.copy(color);
    const sp = new THREE.Sprite(mat);
    sp.scale.setScalar(size);
    sp.position.copy(at);
    this.particles.push({ sprite: sp, vel, life, max: life, gravity, frames: this.sparkTex });
    this.scene.add(sp);
  }

  private updateRockets(dt: number): void {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.fuse -= dt;
      r.sprite.position.addScaledVector(r.vel, dt);
      r.trail -= dt;
      if (r.trail <= 0) {
        r.trail = 0.04;
        this.spark(r.sprite.position.clone(), new THREE.Vector3((Math.random() - 0.5) * 0.2, -0.4, (Math.random() - 0.5) * 0.2), new THREE.Color('#fff4c0'), 0.5, 0.08, 0);
      }
      if (r.fuse > 0) continue;
      // 炸開：一顆大球的火花，再加一點白色閃光
      const at = r.sprite.position.clone();
      for (let k = 0; k < 70; k++) {
        const dir = new THREE.Vector3().randomDirection().multiplyScalar(1.4 + Math.random() * 0.5);
        this.spark(at, dir, r.color, 1.3 + Math.random() * 0.5, 0.13, 0.7);
      }
      for (let k = 0; k < 12; k++) this.spark(at, new THREE.Vector3().randomDirection().multiplyScalar(0.6), new THREE.Color('#ffffff'), 0.6, 0.1, 0.3);
      this.onBurst?.(at);
      this.scene.remove(r.sprite);
      r.sprite.material.dispose();
      this.rockets.splice(i, 1);
    }
  }

  // ---------- 洗澡：水花（splash_0 → 3）與泡泡 ----------

  private splashTex: THREE.Texture[] = [spriteTex(solid('#5a8cff'))];
  private bubbleTex: THREE.Texture = spriteTex(drawGrid(['.kk.', 'k.wk', 'k..k', '.kk.'], { k: '#a8d0ff', w: '#ffffff' }, 2));

  splash(at: THREE.Vector3, count = 12): void {
    for (let k = 0; k < count; k++) {
      const mat = new THREE.SpriteMaterial({ map: this.splashTex[0], transparent: true, depthWrite: false });
      const sp = new THREE.Sprite(mat);
      sp.scale.setScalar(0.12);
      sp.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.2, (Math.random() - 0.5) * 0.2));
      const vel = new THREE.Vector3((Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 1);
      this.particles.push({ sprite: sp, vel, life: 0.8, max: 0.8, gravity: 4, frames: this.splashTex });
      this.scene.add(sp);
    }
  }

  bubbles(at: THREE.Vector3, count = 8): void {
    for (let k = 0; k < count; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bubbleTex, transparent: true, depthWrite: false }));
      sp.scale.setScalar(0.07 + Math.random() * 0.07);
      sp.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.3) * 0.4, (Math.random() - 0.5) * 0.3));
      const vel = new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.25 + Math.random() * 0.25, 0);
      const life = 1.4 + Math.random() * 1.2;
      this.particles.push({ sprite: sp, vel, life, max: life, gravity: 0, sway: Math.random() * 6 });
      this.scene.add(sp);
    }
  }

  usePlayImages(img: Partial<Record<string, HTMLImageElement>>): void {
    const t = (src: HTMLImageElement) => spriteTex(tinted(src));
    if (img.firework_rocket) this.rocketTex = t(img.firework_rocket);
    const sparks = [7, 6, 5, 4, 3, 2, 1, 0].map((i) => img[`spark_${i}`]);
    if (sparks.every(Boolean)) this.sparkTex = sparks.map((x) => t(x!));
    const splashes = [0, 1, 2, 3].map((i) => img[`splash_${i}`]);
    if (splashes.every(Boolean)) this.splashTex = splashes.map((x) => t(x!));
    if (img.bubble) this.bubbleTex = t(img.bubble);
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
    this.updateRockets(dt);
    if (this.noteBlock) this.noteBlock.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-10 * dt));
    this.motes.position.y = Math.sin(t * 0.2) * 0.1;
    if (this.weather && !this.arMode) {
      this.weatherIn -= dt;
      while (this.weatherIn <= 0) {
        this.weatherIn += this.weather.every;
        this.spawnWeather();
      }
    }
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
