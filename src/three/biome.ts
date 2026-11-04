// 生態域背景主題（H）：天空顏色、地面方塊、地上的植物、天氣粒子與偶爾的環境音。
// 材質與音效都來自玩家自己的原版素材包；沒有素材包時用純色。

export type Biome = 'plains' | 'swamp' | 'snow' | 'nether' | 'ruins';
export const BIOMES: Biome[] = ['plains', 'swamp', 'snow', 'nether', 'ruins'];

export interface BiomeStyle {
  /** 天空漸層（上、下）；白天與晚上 */
  day: [string, string];
  night: [string, string];
  /** 地面方塊材質，tint 是原版草地等灰階材質的染色 */
  ground: string;
  groundTint?: string;
  /** 沒有素材包時的地面顏色 */
  groundColor: string;
  /** 地上的植物（交叉的兩片平面，像原版的花草）；flat 為平貼地面（睡蓮葉） */
  plants: { tex: string; tint?: string; flat?: boolean; count: number }[];
  /** 天氣粒子：下雪、灰燼、孢子、塵埃 */
  weather: { kind: 'snow' | 'ash' | 'spore' | 'mote'; color: string; every: number } | null;
  /** 偶爾的環境音（原版路徑，有多個版本會隨機挑） */
  ambient?: { path: string; vol: number; every: [number, number] };
}

const block = (n: string) => `textures/block/${n}.png`;
const GRASS = '#91bd59';
const SWAMP = '#6a7039';

export const BIOME_STYLE: Record<Biome, BiomeStyle> = {
  plains: {
    day: ['#78a7ff', '#c0d8ff'],
    night: ['#0b1030', '#253a6e'],
    ground: block('grass_block_top'),
    groundTint: GRASS,
    groundColor: '#7fb050',
    plants: [
      { tex: block('short_grass'), tint: GRASS, count: 7 },
      { tex: block('dandelion'), count: 3 },
      { tex: block('poppy'), count: 3 },
      { tex: block('oxeye_daisy'), count: 2 },
    ],
    weather: null,
  },
  swamp: {
    day: ['#7f9a8a', '#c4ceb0'],
    night: ['#0d1a14', '#2a3a2c'],
    ground: block('grass_block_top'),
    groundTint: SWAMP,
    groundColor: '#5a6430',
    plants: [
      { tex: block('lily_pad'), tint: '#208030', flat: true, count: 4 },
      { tex: block('blue_orchid'), count: 3 },
      { tex: block('brown_mushroom'), count: 3 },
      { tex: block('short_grass'), tint: SWAMP, count: 5 },
    ],
    weather: { kind: 'spore', color: '#b8c870', every: 0.6 },
    ambient: { path: 'sounds/mob/frog/idle', vol: 0.3, every: [18, 40] },
  },
  snow: {
    day: ['#a9c4ff', '#eef4ff'],
    night: ['#1a2340', '#4a5a86'],
    ground: block('snow'),
    groundColor: '#f0f4fa',
    plants: [{ tex: block('fern'), tint: '#80a755', count: 3 }],
    weather: { kind: 'snow', color: '#ffffff', every: 0.08 },
  },
  nether: {
    // 地獄沒有日夜
    day: ['#2a0808', '#7a2414'],
    night: ['#2a0808', '#7a2414'],
    ground: block('netherrack'),
    groundColor: '#6a2020',
    plants: [
      { tex: block('crimson_roots'), count: 5 },
      { tex: block('crimson_fungus'), count: 3 },
      { tex: block('nether_sprouts'), count: 4 },
    ],
    weather: { kind: 'ash', color: '#ff6a4a', every: 0.25 },
    ambient: { path: 'sounds/ambient/nether/nether_wastes/addition', vol: 0.25, every: [15, 35] },
  },
  ruins: {
    day: ['#9fb7d8', '#e6dcc6'],
    night: ['#141a2e', '#3d3a4a'],
    ground: block('mossy_stone_bricks'),
    groundColor: '#7a8070',
    plants: [
      { tex: block('dead_bush'), count: 3 },
      { tex: block('fern'), tint: GRASS, count: 4 },
      { tex: block('cracked_stone_bricks'), flat: true, count: 3 },
    ],
    weather: { kind: 'mote', color: '#e8dcb8', every: 0.5 },
  },
};

const BIOME_KEY = 'fairypocket.biome.v1';

export function loadBiome(storage: Pick<Storage, 'getItem'>): Biome {
  const v = storage.getItem(BIOME_KEY);
  return BIOMES.includes(v as Biome) ? (v as Biome) : 'plains';
}

export function saveBiome(storage: Pick<Storage, 'setItem'>, b: Biome): void {
  storage.setItem(BIOME_KEY, b);
}

/** 生態域用到的所有材質（換背景時才從素材包讀） */
export function biomeTextures(b: Biome): string[] {
  const s = BIOME_STYLE[b];
  return [s.ground, ...s.plants.map((p) => p.tex)];
}
