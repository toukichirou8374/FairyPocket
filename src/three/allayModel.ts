// 3D 方塊悅靈模型。材質為原創暫用像素圖（非 Minecraft 原版檔案），
// 之後取得授權素材時只需替換本檔的貼圖格子或改載入 PNG。

import * as THREE from 'three';
import { drawGrid, type Palette } from '../pixel';

const PAL: Palette = {
  a: '#3b8fe0', // 頭頂深藍
  b: '#8fdcff', // 臉
  c: '#6cc4f5', // 下巴陰影
  e: '#12306b', // 眼睛
  m: '#4aa8f0', // 身體
  n: '#2f7fd0', // 身體暗部
  w: 'rgba(255,255,255,0.95)',
  x: 'rgba(205,239,255,0.8)',
};

const FACE_OPEN = ['aaaaaaaa', 'aabbbbaa', 'bbbbbbbb', 'bbebbebb', 'bbebbebb', 'bbbbbbbb', 'cbbbbbbc', 'cccccccc'];
const FACE_CLOSED = ['aaaaaaaa', 'aabbbbaa', 'bbbbbbbb', 'bbbbbbbb', 'beebbeeb', 'bbbbbbbb', 'cbbbbbbc', 'cccccccc'];
const FACE_HAPPY = ['aaaaaaaa', 'aabbbbaa', 'bbbbbbbb', 'bbebbebb', 'bebebebe', 'bbbbbbbb', 'cbbbbbbc', 'cccccccc'];
const HEAD_SIDE = ['aaaaaaaa', 'aaaaabbb', 'aaabbbbb', 'abbbbbbb', 'bbbbbbbb', 'bbbbbbbb', 'cbbbbbbb', 'cccccccc'];
const HEAD_BACK = ['aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', 'aabaabaa', 'caaaaaac', 'cccccccc'];
const HEAD_TOP = ['aaaaaaaa', 'aaaaaaaa', 'aanaaaaa', 'aaaaaaaa', 'aaaaanaa', 'aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa'];
const HEAD_BOTTOM = Array(8).fill('cccccccc');
const BODY = ['mmmm', 'mnmm', 'mmmn', 'mmmm', 'nmmm', 'mmnm'];
const WING = ['wwwwxx..', 'wxxxxxxx', 'wxwxxxxx', 'wxxxwxx.', 'wxxxxx..', 'wwxx....'];

function tex(grid: string[]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(drawGrid(grid, PAL));
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowMat(map: THREE.Texture, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map,
    emissive: new THREE.Color('#ffffff'),
    emissiveMap: map,
    emissiveIntensity: 0.45,
    roughness: 0.8,
    metalness: 0,
    ...opts,
  });
}

export type Eyes = 'open' | 'closed' | 'happy';

export class AllayModel {
  readonly root = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly head = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly wingL = new THREE.Group();
  readonly wingR = new THREE.Group();
  readonly hitbox: THREE.Mesh;
  private faceMat: THREE.MeshStandardMaterial;
  private faces: Record<Eyes, THREE.Texture>;
  private eyes: Eyes = 'open';

  constructor() {
    this.root.add(this.tilt);
    const body = new THREE.Group();
    this.tilt.add(body);

    // 頭
    this.faces = { open: tex(FACE_OPEN), closed: tex(FACE_CLOSED), happy: tex(FACE_HAPPY) };
    this.faceMat = glowMat(this.faces.open);
    const side = glowMat(tex(HEAD_SIDE));
    const headMats = [side, side, glowMat(tex(HEAD_TOP)), glowMat(tex(HEAD_BOTTOM)), this.faceMat, glowMat(tex(HEAD_BACK))];
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), headMats);
    headMesh.position.y = 0.25;
    this.head.position.y = 0.2;
    this.head.add(headMesh);
    body.add(this.head);

    // 身體：內層實心 + 外層半透明殼
    const bodyTex = tex(BODY);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.38, 0.2), glowMat(bodyTex));
    inner.position.y = 0;
    body.add(inner);
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.46, 0.27),
      new THREE.MeshStandardMaterial({ color: '#c8f2ff', transparent: true, opacity: 0.32, emissive: '#9fe4ff', emissiveIntensity: 0.4, depthWrite: false }),
    );
    shell.position.y = -0.02;
    body.add(shell);

    // 手臂（肩膀為轉軸）
    for (const [arm, x] of [[this.armL, 0.2], [this.armR, -0.2]] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.09), glowMat(bodyTex));
      m.position.y = -0.16;
      arm.position.set(x, 0.14, 0.02);
      arm.add(m);
      body.add(arm);
    }

    // 翅膀（內側邊為轉軸）
    const wingTex = tex(WING);
    const wingMat = new THREE.MeshBasicMaterial({ map: wingTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.9 });
    for (const [wing, s] of [[this.wingL, 1], [this.wingR, -1]] as const) {
      const g = new THREE.PlaneGeometry(0.56, 0.42);
      const m = new THREE.Mesh(g, wingMat);
      m.position.set(0.28 * s, 0.05, 0);
      if (s < 0) m.scale.x = -1;
      wing.position.set(0.03 * s, 0.1, -0.15);
      wing.add(m);
      body.add(wing);
    }

    // 自身柔光
    // 放在身後偏下，只照亮周圍與地面，不會在臉上形成亮斑
    const light = new THREE.PointLight('#9fe4ff', 0.6, 2.2, 2);
    light.position.set(0, -0.35, -0.35);
    body.add(light);

    // 觸控判定用的放大隱形球
    this.hitbox = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 0.2;
    this.root.add(this.hitbox);
  }

  setEyes(e: Eyes): void {
    if (e === this.eyes) return;
    this.eyes = e;
    this.faceMat.map = this.faces[e];
    this.faceMat.emissiveMap = this.faces[e];
    this.faceMat.needsUpdate = true;
  }
}
