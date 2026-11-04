// 以字串格子繪製像素圖。所有圖案皆為原創暫用素材，可直接替換成正式材質。

import { FOODS, type Food } from './game/state';

export type Palette = Record<string, string>;

export function drawGrid(grid: string[], pal: Palette, scale = 1): HTMLCanvasElement {
  const h = grid.length;
  const w = Math.max(...grid.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext('2d')!;
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return c;
}

export function gridURL(grid: string[], pal: Palette, scale = 4): string {
  return drawGrid(grid, pal, scale).toDataURL();
}

// ---- HUD 圖示 ----

export const HEART = [
  '.kk...kk.',
  'krrk.krrk',
  'krwrkrrrk',
  'krrrrrrrk',
  '.krrrrrk.',
  '..krrrk..',
  '...krk...',
  '....k....',
];
export const HEART_PAL: Palette = { k: '#2a0a0a', r: '#e8283a', w: '#ffb4b4', d: '#4a3a3a' };

export const SHANK = [
  '.....kkk.',
  '....kmmmk',
  '...kmmMmk',
  '...kmMmmk',
  '..kkmmmk.',
  '.kwkkkk..',
  'kwwk.....',
  '.kk......',
];
export const SHANK_PAL: Palette = { k: '#2a1608', m: '#b5652a', M: '#e09048', w: '#f2ead8', d: '#4a3a30' };

/** 依填滿程度把格子轉成滿 / 半 / 空版本 */
export function statGrid(grid: string[], level: number, halfKeepFromCol: number, keepRight: boolean): string[] {
  return grid.map((row) =>
    [...row]
      .map((ch, x) => {
        if (ch === '.' || ch === 'k') return ch;
        if (level === 2) return ch;
        if (level === 1 && (keepRight ? x >= halfKeepFromCol : x <= halfKeepFromCol)) return ch;
        return 'd';
      })
      .join(''),
  );
}

export const ITEM_ICONS: Record<string, { grid: string[]; pal: Palette }> = {
  apple: {
    grid: [
      '.....b.gg...',
      '.....bgg....',
      '..rrrbrrr...',
      '.rrwrrrrrr..',
      '.rwrrrrrrR..',
      '.rrrrrrrrR..',
      '.rrrrrrrrR..',
      '.rrrrrrrRR..',
      '..rrrrrRR...',
      '...rr.RR....',
    ],
    pal: { b: '#6b4423', g: '#4caf3a', r: '#e0303a', R: '#a01a24', w: '#ffc0c0' },
  },
  bread: {
    grid: [
      '............',
      '...oooooo...',
      '..oyyyyyyo..',
      '.oyyYyyYyyo.',
      '.oyyyyyyyyo.',
      '.oYyyYyyYyo.',
      '.ooyyyyyyoo.',
      '..oooooooo..',
    ],
    pal: { o: '#8a5a22', y: '#e8b864', Y: '#c48a3a' },
  },
  feather: {
    grid: [
      '.........ww.',
      '........wwl.',
      '.......wwll.',
      '......wwll..',
      '.....wwll...',
      '....wwll....',
      '...wwls.....',
      '..wls.......',
      '.ls.........',
      's...........',
    ],
    pal: { w: '#ffffff', l: '#c8d0d8', s: '#8a8f96' },
  },
  slime: {
    grid: [
      '....gggg....',
      '...gLLggg...',
      '..gLggggGg..',
      '..gggGgggg..',
      '..ggggggGg..',
      '..gGgggggg..',
      '...gggGgg...',
      '....gggg....',
    ],
    pal: { g: '#6fd24a', G: '#3e9a2a', L: '#c4f5a8' },
  },
  call: {
    grid: [
      '......nnnn..',
      '......nnnnn.',
      '......n..nn.',
      '......n...n.',
      '......n.....',
      '......n.....',
      '...nnnn.....',
      '..nnnnn.....',
      '..nnnn......',
      '...nn.......',
    ],
    pal: { n: '#ffe066' },
  },
  noteblock: {
    grid: [
      'kkkkkkkkkkkkkkkk',
      'kbbbbbbbbbbbbbbk',
      'kbBBBBBBBBBBBBbk',
      'kbBkkkkkkkkkkBbk',
      'kbBkbbbbbbbbkBbk',
      'kbBkbbbbnnbbkBbk',
      'kbBkbbbbnbnbkBbk',
      'kbBkbbbbnbbbkBbk',
      'kbBkbbbbnbbbkBbk',
      'kbBkbbnnnbbbkBbk',
      'kbBkbbnnnbbbkBbk',
      'kbBkbbbbbbbbkBbk',
      'kbBkkkkkkkkkkBbk',
      'kbBBBBBBBBBBBBbk',
      'kbbbbbbbbbbbbbbk',
      'kkkkkkkkkkkkkkkk',
    ],
    pal: { k: '#3a2410', b: '#7a4a24', B: '#9a6234', n: '#2a1608' },
  },
  // 以下為原創的暫用圖示（有素材包時改用原版材質）
  hand: {
    grid: [
      '..k.k.k.....',
      '.kwkwkwk....',
      '.kwkwkwk.k..',
      '.kwkwkwkkwk.',
      '.kwwwwwwkwk.',
      '.kwwwwwwwwk.',
      '.kwwwwwwwk..',
      '..kwwwwwwk..',
      '...kwwwwk...',
      '....kkkk....',
    ],
    pal: { k: '#3a2a1a', w: '#f0c090' },
  },
  bed: {
    grid: [
      'kk..........',
      'kwwkrrrrrrrk',
      'kwwkrrrrrrrk',
      'kbbbbbbbbbbk',
      'kk........kk',
    ],
    pal: { k: '#3a2a1a', w: '#ffffff', r: '#c83030', b: '#8a5a30' },
  },
  firework: {
    grid: [
      '.....k......',
      '....krk.....',
      '...kyyyk....',
      '...kryrk....',
      '...kryrk....',
      '...kryrk....',
      '....kbk.....',
      '....kbk.....',
      '.....b......',
    ],
    pal: { k: '#2a2a2a', r: '#d83838', y: '#f8e070', b: '#8a6a40' },
  },
  bucket: {
    grid: [
      '..kkkkkkkk..',
      '.k........k.',
      'kgbbbbbbbbgk',
      'kgbBbbbbbbgk',
      '.kgbbbbbbgk.',
      '.kggggggggk.',
      '..kggggggk..',
      '..kkkkkkkk..',
    ],
    pal: { k: '#2a2a32', g: '#b8b8c0', b: '#3870e0', B: '#a0c8ff' },
  },
  // 原創的像素相機（AR 模式按鈕）
  camera: {
    grid: [
      '...kkkk.....',
      'kkkkkkkkkkkk',
      'kggggggggrgk',
      'kgggkkkkgggk',
      'kggkwbbkkggk',
      'kggkbbbbkggk',
      'kggkbbbbkggk',
      'kgggkkkkgggk',
      'kggggggggggk',
      'kkkkkkkkkkkk',
    ],
    pal: { k: '#1d2b4a', g: '#a8b4c8', r: '#e04848', w: '#ffffff', b: '#4a7ab8' },
  },
  // 原創的像素麥克風（原版沒有麥克風）
  mic: {
    grid: [
      '....kkkk....',
      '...kwggwk...',
      '...kgggGk...',
      '...kwggwk...',
      '...kgggGk...',
      '.k.kwggwk.k.',
      '.k..kkkk..k.',
      '..k......k..',
      '...kkkkkk...',
      '.....kk.....',
      '....kkkk....',
    ],
    pal: { k: '#2a2a32', w: '#e8e8f0', g: '#a8a8b8', G: '#787888' },
  },
  bell: {
    grid: [
      '.....kk.....',
      '....kyyk....',
      '...kyyYyk...',
      '...kyyYyk...',
      '..kyyyyYyk..',
      '..kyyyyYyk..',
      '.kyyyyyyYyk.',
      'kkkkkkkkkkkk',
      '.....kk.....',
    ],
    pal: { k: '#5a3a08', y: '#f8d040', Y: '#c89818' },
  },
  amethyst: {
    grid: [
      '.......kk...',
      '......kpPk..',
      '.....kppPk..',
      '....kpLpPk..',
      '...kpLppk...',
      '..kpLppk....',
      '.kpppPk.....',
      '.kpPPk......',
      '..kkk.......',
    ],
    pal: { k: '#3a1a5a', p: '#a070e0', P: '#7040b0', L: '#e0c8ff' },
  },
  chest: {
    grid: [
      '.kkkkkkkkkk.',
      'kbbbbbbbbbbk',
      'kbBBBBBBBBbk',
      'kkkkkggkkkkk',
      'kbbbbggbbbbk',
      'kbBBBBBBBBbk',
      'kbBBBBBBBBbk',
      'kbbbbbbbbbbk',
      '.kkkkkkkkkk.',
    ],
    pal: { k: '#3a2410', b: '#a0682a', B: '#c88a3c', g: '#d8d8d8' },
  },
};

const FOOD_BLOB = [
  '...kkkk...',
  '..kcwccck.',
  '.kcwcccCck',
  '.kccccccCk',
  '.kcccccCCk',
  '..kccCCCk.',
  '...kkkk...',
];

/** 沒有原版素材時的食物暫用圖示（依食物顏色上色的小圓塊） */
export function foodIcon(food: Food, scale = 1): HTMLCanvasElement {
  const c = FOODS[food].color;
  return drawGrid(FOOD_BLOB, { k: '#2a1a10', c, C: shade(c, 0.7), w: '#ffffff' }, scale);
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
