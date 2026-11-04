// 3D 悅靈模型：比例、轉軸與貼圖 UV 完全依照 Minecraft 原版悅靈（32x32 貼圖）。
// 未匯入原版素材時，使用同樣排版的原創暫用貼圖。

import * as THREE from 'three';

const PX = 0.1; // 1 個像素 = 0.1 單位
const TEX = 32;
const GLOW = 0.35; // 發光輪廓的粗細（像素）

type Rect = [u: number, v: number, w: number, h: number];

/**
 * 建立 Minecraft 方塊（addBox）：texOffs(u,v)、尺寸 w×h×d（像素）、膨脹值 inflate。
 * 座標換算：MC 的 y 向下、臉朝 -z；這裡 y 向上、臉朝 +z（繞 X 軸轉 180°）。
 */
// 原版實體的分面明暗（頂最亮、前後次之、左右較暗、底最暗），以 sRGB 倍率換成線性值
const SHADE = [0.65, 0.65, 1, 0.5, 0.85, 0.85].map((f) => Math.pow(f, 2.2));

function mcBox(u: number, v: number, w: number, h: number, d: number, inflate = 0, flatShade = false): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(
    Math.max(w + inflate * 2, 0.001) * PX,
    (h + inflate * 2) * PX,
    Math.max(d + inflate * 2, 0.001) * PX,
  );
  // BoxGeometry 面順序：+x, -x, +y, -y, +z(臉), -z(背)
  const faces: Rect[] = [
    [u + d + w, v + d, d, h], // 左側（+x）
    [u, v + d, d, h], // 右側（-x）
    [u + d, v, w, d], // 頂
    [u + d + w, v, w, d], // 底
    [u + d, v + d, w, h], // 正面
    [u + d + w + d, v + d, w, h], // 背面
  ];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  faces.forEach(([fu, fv, fw, fh], f) => {
    const l = fu / TEX;
    const r = (fu + fw) / TEX;
    const t = 1 - fv / TEX;
    const b = 1 - (fv + fh) / TEX;
    const i = f * 4;
    uv.setXY(i, l, t);
    uv.setXY(i + 1, r, t);
    uv.setXY(i + 2, l, b);
    uv.setXY(i + 3, r, b);
  });
  uv.needsUpdate = true;
  const col = new Float32Array(24 * 3);
  for (let f = 0; f < 6; f++) {
    const s = flatShade ? Math.pow(0.9, 2.2) : SHADE[f];
    for (let k = 0; k < 4; k++) col.set([s, s, s], (f * 4 + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** addBox(x0,y0,z0,w,h,d) 在 MC 座標中的中心 → 本模型座標 */
function center(x0: number, y0: number, z0: number, w: number, h: number, d: number): THREE.Vector3 {
  return new THREE.Vector3((x0 + w / 2) * PX, -(y0 + h / 2) * PX, -(z0 + d / 2) * PX);
}

function pivot(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x * PX, -y * PX, -z * PX);
}

/** 原創暫用貼圖：與原版相同排版，顏色與細節為自製 */
function placeholderSkin(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d')!;
  const fill = (col: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // 頭
  fill('#7fe6ff', 5, 0, 10, 5);
  fill('#5fd2f5', 0, 5, 20, 5);
  fill('#3fb4e8', 15, 5, 5, 5);
  fill('#9ff0ff', 5, 5, 5, 5);
  fill('#ffffff', 6, 7, 1, 2);
  fill('#ffffff', 8, 7, 1, 2);
  // 身體
  fill('#3ab0e6', 0, 10, 10, 6);
  fill('rgba(70,150,220,0.6)', 0, 16, 10, 7);
  // 手臂
  fill('#45c4f5', 23, 0, 6, 12);
  // 翅膀
  fill('rgba(200,240,255,0.85)', 16, 22, 8, 5);
  return c;
}

export type Eyes = 'open' | 'closed' | 'happy';

/** 依原始貼圖產生閉眼與瞇眼版本（自動偵測臉部的白色眼睛像素） */
function eyeVariants(src: CanvasImageSource): Record<Eyes, HTMLCanvasElement> {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = c.height = TEX;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0, TEX, TEX);
    return { c, ctx };
  };
  const open = make();
  const img = open.ctx.getImageData(0, 0, TEX, TEX);
  const at = (x: number, y: number) => (y * TEX + x) * 4;
  const eyes: [number, number][] = [];
  for (let y = 5; y < 10; y++) {
    for (let x = 5; x < 10; x++) {
      const i = at(x, y);
      if (img.data[i] > 200 && img.data[i + 1] > 200 && img.data[i + 2] > 200 && img.data[i + 3] > 200) eyes.push([x, y]);
    }
  }
  const variant = (keepBottomRow: boolean) => {
    const v = make();
    const d = v.ctx.getImageData(0, 0, TEX, TEX);
    const bottom = new Map<number, number>();
    for (const [x, y] of eyes) bottom.set(x, Math.max(bottom.get(x) ?? 0, y));
    for (const [x, y] of eyes) {
      // 用眼睛上方的膚色蓋掉
      let sy = y - 1;
      while (sy >= 5 && eyes.some(([ex, ey]) => ex === x && ey === sy)) sy--;
      const s = at(x, Math.max(5, sy));
      const t = at(x, y);
      const isBottom = bottom.get(x) === y;
      const k = isBottom ? (keepBottomRow ? 0.55 : 0.6) : 1;
      d.data[t] = d.data[s] * k;
      d.data[t + 1] = d.data[s + 1] * k;
      d.data[t + 2] = d.data[s + 2] * k;
      d.data[t + 3] = 255;
    }
    v.ctx.putImageData(d, 0, 0);
    return v.c;
  };
  return { open: open.c, closed: variant(false), happy: variant(true) };
}

function texFrom(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class AllayModel {
  readonly root = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly head = new THREE.Group();
  readonly body = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly wingL = new THREE.Group();
  readonly wingR = new THREE.Group();
  readonly hitbox: THREE.Mesh;
  private skins!: Record<Eyes, THREE.Texture>;
  private eyes: Eyes = 'open';
  private solid: THREE.MeshBasicMaterial;
  private faceMat: THREE.MeshBasicMaterial;
  private glass: THREE.MeshBasicMaterial;
  private wingMat: THREE.MeshBasicMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private shells: THREE.Mesh[] = [];

  constructor() {
    // 悅靈在原版是全亮度渲染（不受環境光影響），只有分面明暗
    const mat = (o: THREE.MeshBasicMaterialParameters = {}) =>
      new THREE.MeshBasicMaterial({ vertexColors: true, alphaTest: 0.02, ...o });
    this.solid = mat();
    this.faceMat = mat();
    // 寫入深度，發光輪廓才不會從半透明的身體透出來
    this.glass = mat({ transparent: true });
    this.wingMat = mat({ transparent: true, side: THREE.DoubleSide, depthWrite: false });

    this.root.add(this.tilt);
    this.tilt.add(this.head, this.body);

    // 頭：texOffs(0,0) addBox(-2.5,-5,-2.5, 5,5,5)；頭與身體轉軸都在脖子（原點）
    const headMesh = new THREE.Mesh(mcBox(0, 0, 5, 5, 5), [this.solid, this.solid, this.solid, this.solid, this.faceMat, this.solid]);
    headMesh.position.copy(center(-2.5, -5, -2.5, 5, 5, 5));
    this.head.add(headMesh);

    // 身體：texOffs(0,10) 3×4×2；texOffs(0,16) 3×5×2 半透明（膨脹 -0.2）
    const inner = new THREE.Mesh(mcBox(0, 10, 3, 4, 2), this.solid);
    inner.position.copy(center(-1.5, 0, -1, 3, 4, 2));
    const outer = new THREE.Mesh(mcBox(0, 16, 3, 5, 2, -0.2), this.glass);
    outer.position.copy(center(-1.5, 0, -1, 3, 5, 2));
    outer.renderOrder = 1;
    this.body.add(inner, outer);

    // 手臂：texOffs(23,0)/(23,6) 1×4×2
    const armR = new THREE.Mesh(mcBox(23, 0, 1, 4, 2, -0.01), this.solid);
    armR.position.copy(center(-0.75, -0.5, -1, 1, 4, 2));
    this.armR.position.copy(pivot(-1.75, 0.5, 0));
    this.armR.add(armR);
    const armL = new THREE.Mesh(mcBox(23, 6, 1, 4, 2, -0.01), this.solid);
    armL.position.copy(center(-0.25, -0.5, -1, 1, 4, 2));
    this.armL.position.copy(pivot(1.75, 0.5, 0));
    this.armL.add(armL);
    this.body.add(this.armR, this.armL);

    // 翅膀：texOffs(16,14) 0×5×8，往身後延伸
    for (const [wing, x] of [[this.wingR, -0.5], [this.wingL, 0.5]] as const) {
      const m = new THREE.Mesh(mcBox(16, 14, 0, 5, 8, 0, true), this.wingMat);
      m.position.copy(center(0, 1, 0, 0, 5, 8));
      m.renderOrder = 2;
      wing.position.copy(pivot(x, 0, 0.6));
      wing.add(m);
      this.body.add(wing);
    }

    // 發光輪廓（像原版「發光」效果）：稍微放大的背面方塊，只在外緣露出一圈顏色
    // 排在半透明身體之後畫，被身體擋住的部分就不會顯示
    this.glowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, transparent: true });
    const shell = (parent: THREE.Object3D, src: THREE.Mesh, w: number, h: number, d: number) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry((w + GLOW * 2) * PX, (h + GLOW * 2) * PX, (d + GLOW * 2) * PX), this.glowMat);
      s.position.copy(src.position);
      s.renderOrder = 3;
      parent.add(s);
      this.shells.push(s);
    };
    shell(this.head, headMesh, 5, 5, 5);
    shell(this.body, inner, 3, 4, 2);
    shell(this.armR, armR, 1, 4, 2);
    shell(this.armL, armL, 1, 4, 2);
    this.setGlow(null);

    // 觸控判定用的放大隱形球
    this.hitbox = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.root.add(this.hitbox);

    this.setSkin(placeholderSkin());
  }

  /** 換貼圖（原版或暫用），會自動產生眨眼用的版本 */
  setSkin(src: CanvasImageSource): void {
    const v = eyeVariants(src);
    this.skins = { open: texFrom(v.open), closed: texFrom(v.closed), happy: texFrom(v.happy) };
    for (const m of [this.solid, this.glass, this.wingMat]) {
      m.map = this.skins.open;
      m.needsUpdate = true;
    }
    const e = this.eyes;
    this.eyes = 'open';
    this.faceMat.map = this.skins.open;
    this.faceMat.needsUpdate = true;
    this.setEyes(e);
  }

  setEyes(e: Eyes): void {
    if (e === this.eyes) return;
    this.eyes = e;
    this.faceMat.map = this.skins[e];
    this.faceMat.needsUpdate = true;
  }

  /** 發光輪廓的顏色；null 代表關閉 */
  setGlow(color: THREE.ColorRepresentation | null): void {
    for (const s of this.shells) s.visible = color !== null;
    if (color !== null) this.glowMat.color.set(color);
  }

  private held: THREE.Sprite | null = null;

  /** 讓悅靈雙手捧著物品（像原版拿著東西時一樣）；null 代表放下 */
  holdItem(tex: THREE.Texture | null): void {
    if (this.held) {
      this.body.remove(this.held);
      this.held.material.dispose();
      this.held = null;
    }
    if (!tex) return;
    this.held = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    this.held.scale.setScalar(0.26);
    this.held.position.set(0, -0.28, 0.32); // 雙手前方
    this.body.add(this.held);
  }

  /** 翅膀張開角度（弧度）：0 = 平貼背後 */
  setWings(spread: number, tilt: number): void {
    this.wingL.rotation.set(tilt, -spread, 0);
    this.wingR.rotation.set(tilt, spread, 0);
  }
}
