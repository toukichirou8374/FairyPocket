// 以字串格子繪製像素圖。所有圖案皆為原創暫用素材，可直接替換成正式材質。

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
};
