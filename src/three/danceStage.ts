// 「精靈舞蹈」的舞台：用原版方塊材質搭的小舞台（粉白格子舞池、樺木柱、螢石燈、音階盒、唱片機、花），
// 以及悅靈頭上的花圈。材質來自玩家自己的素材包；沒有素材包時用相近的純色。

import * as THREE from 'three';

/** 舞台與花圈用到的原版材質 */
export const DANCE_TEXTURES = {
  wool_pink: 'textures/block/pink_wool.png',
  wool_white: 'textures/block/white_wool.png',
  planks: 'textures/block/dark_oak_planks.png',
  log: 'textures/block/birch_log.png',
  log_top: 'textures/block/birch_log_top.png',
  glowstone: 'textures/block/glowstone.png',
  note: 'textures/block/note_block.png',
  juke_side: 'textures/block/jukebox_side.png',
  juke_top: 'textures/block/jukebox_top.png',
  poppy: 'textures/block/poppy.png',
  dandelion: 'textures/block/dandelion.png',
  cornflower: 'textures/block/cornflower.png',
  allium: 'textures/block/allium.png',
  oxeye: 'textures/block/oxeye_daisy.png',
  bluet: 'textures/block/azure_bluet.png',
  tulip: 'textures/block/pink_tulip.png',
  leaves: 'textures/block/azalea_leaves.png',
} as const;
export type DanceTex = keyof typeof DANCE_TEXTURES;
export type DanceImages = Partial<Record<DanceTex, HTMLImageElement>>;

const FALLBACK: Record<DanceTex, string> = {
  wool_pink: '#f39ab5',
  wool_white: '#f2f2f2',
  planks: '#4a3220',
  log: '#d8d2c0',
  log_top: '#c8b88a',
  glowstone: '#ffd97a',
  note: '#6b4128',
  juke_side: '#6b4128',
  juke_top: '#4a2c1a',
  poppy: '#e03030',
  dandelion: '#ffd800',
  cornflower: '#4a6cf0',
  allium: '#b060e0',
  oxeye: '#ffffff',
  bluet: '#e8f0ff',
  tulip: '#ff9ac0',
  leaves: '#5a8a30',
};

const FLOWERS: DanceTex[] = ['poppy', 'dandelion', 'cornflower', 'allium', 'oxeye', 'bluet', 'tulip'];

function texture(img: HTMLImageElement): THREE.Texture {
  // 動態材質（例如有好幾格的）只取第一格
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = Math.min(img.height, img.width);
  c.getContext('2d')!.drawImage(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Mats {
  private cache = new Map<string, THREE.Material>();
  constructor(private img: DanceImages) {}

  /** 方塊面 */
  block(k: DanceTex, glow = false): THREE.Material {
    const key = `${k}:${glow}`;
    let m = this.cache.get(key);
    if (!m) {
      const im = this.img[k];
      const opts = im ? { map: texture(im) } : { color: FALLBACK[k] };
      m = glow ? new THREE.MeshBasicMaterial(opts) : new THREE.MeshLambertMaterial(opts);
      if (k === 'leaves') {
        // 杜鵑葉的材質是灰綠色的半透明圖，加點綠色
        (m as THREE.MeshLambertMaterial).color = new THREE.Color(im ? '#ffffff' : FALLBACK.leaves);
        (m as THREE.MeshLambertMaterial).alphaTest = 0.5;
        (m as THREE.MeshLambertMaterial).transparent = true;
      }
      this.cache.set(key, m);
    }
    return m;
  }

  /** 花：透明的十字平面 */
  flower(k: DanceTex): THREE.Material {
    const key = `flower:${k}`;
    let m = this.cache.get(key);
    if (!m) {
      const im = this.img[k];
      m = im
        ? new THREE.MeshBasicMaterial({ map: texture(im), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
        : new THREE.MeshBasicMaterial({ color: FALLBACK[k], side: THREE.DoubleSide });
      this.cache.set(key, m);
    }
    return m;
  }
}

/** 一格方塊的大小（世界單位） */
const B = 0.5;

function box(mats: THREE.Material | THREE.Material[], w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
  m.position.set(x, y + h / 2, z);
  return m;
}

function cross(mat: THREE.Material, size: number, x: number, y: number, z: number, turn = 0): THREE.Group {
  const g = new THREE.Group();
  for (const r of [Math.PI / 4, -Math.PI / 4]) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    q.rotation.y = r;
    g.add(q);
  }
  g.position.set(x, y + size / 2, z);
  g.rotation.y = turn;
  return g;
}

/**
 * 搭舞台。悅靈在 (0, 1.25, 0.6) 跳舞，舞台的中心就在牠的正下方。
 * BoxGeometry 的面順序：+x, -x, +y, -y, +z, -z
 */
export function buildDanceStage(img: DanceImages): THREE.Group {
  const m = new Mats(img);
  const g = new THREE.Group();
  g.name = 'danceStage';
  const SLAB = 0.25;
  const plank = m.block('planks');
  // 舞池：7 × 4 格，粉紅與白色羊毛相間，側面是深色橡木木板
  for (let i = -3; i <= 3; i++) {
    for (let j = 0; j < 4; j++) {
      const top = m.block((i + j) % 2 === 0 ? 'wool_pink' : 'wool_white');
      g.add(box([plank, plank, top, plank, plank, plank], B, SLAB, B, i * B, 0, 1.35 - j * B));
    }
  }
  // 後面兩根樺木柱，上面是發光的螢石，柱子之間掛一排杜鵑葉當花棚
  const log = m.block('log');
  const logTop = m.block('log_top');
  for (const sx of [-1, 1]) {
    const x = sx * 1.75;
    for (let k = 0; k < 3; k++) g.add(box([log, log, logTop, logTop, log, log], B, B, B, x, k * B, -0.45));
    g.add(box(m.block('glowstone', true), B, B, B, x, 3 * B, -0.45));
  }
  const leaves = m.block('leaves');
  for (let i = -3; i <= 3; i++) {
    g.add(box(leaves, B, B * 0.6, B, i * B, 3.4 * B, -0.45));
    // 葉子上開著花
    if (i % 2 === 0) g.add(cross(m.flower(FLOWERS[(i + 3) % FLOWERS.length]), 0.32, i * B, 3.4 * B + B * 0.6, -0.45, i));
  }
  // 舞台上的音階盒（前面兩角）與唱片機（後面中間）
  const note = m.block('note');
  for (const sx of [-1, 1]) g.add(box(note, B * 0.8, B * 0.8, B * 0.8, sx * 1.5, SLAB, 1.35));
  const js = m.block('juke_side');
  const jt = m.block('juke_top');
  g.add(box([js, js, jt, js, js, js], B * 0.8, B * 0.8, B * 0.8, 0, SLAB, -0.15));
  // 舞池前緣與舞台前面的地上都是花
  for (let i = -2; i <= 2; i++) g.add(cross(m.flower(FLOWERS[(i + 7) % FLOWERS.length]), 0.3, i * B * 0.9, SLAB, 1.52, i * 1.3));
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 14; n++) {
    const x = (rnd() - 0.5) * 4.6;
    const z = 1.75 + rnd() * 0.9;
    g.add(cross(m.flower(FLOWERS[n % FLOWERS.length]), 0.34, x, 0, z, rnd() * Math.PI));
  }
  return g;
}

/** 悅靈的花圈：一圈杜鵑葉，上面插著各種花（加在頭上，頭頂高度 0.5） */
export function buildCrown(img: DanceImages): THREE.Group {
  const m = new Mats(img);
  const g = new THREE.Group();
  g.name = 'crown';
  const leaf = m.block('leaves');
  const Y = 0.5;
  const R = 0.28;
  const T = 0.09;
  // 葉子圈（四邊）
  g.add(box(leaf, R * 2 + T, T, T, 0, Y - T / 2, R));
  g.add(box(leaf, R * 2 + T, T, T, 0, Y - T / 2, -R));
  g.add(box(leaf, T, T, R * 2 + T, R, Y - T / 2, 0));
  g.add(box(leaf, T, T, R * 2 + T, -R, Y - T / 2, 0));
  // 花：沿著圈插一圈，每朵朝外
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // 正方形的圈：把角度投影到方框上
    const cx = Math.sin(a);
    const cz = Math.cos(a);
    const k = R / Math.max(Math.abs(cx), Math.abs(cz));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), m.flower(FLOWERS[i % FLOWERS.length]));
    f.position.set(cx * k * 1.04, Y + 0.09, cz * k * 1.04);
    f.rotation.y = a;
    g.add(f);
  }
  return g;
}
