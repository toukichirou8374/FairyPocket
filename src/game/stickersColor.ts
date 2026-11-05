// 貼紙簿 v0.32 新增：顏色（顏料一滴一滴）與形狀。一樣是自己畫的 12×12 像素圖。

import type { Sticker } from './stickers';

type Names = [string, string, string];
type Alias = [string[], string[], string[]];

function s(id: string, cat: Sticker['cat'], grid: string[], pal: Sticker['pal'], names: Names, alias: Alias): Sticker {
  return {
    id,
    cat,
    grid,
    pal,
    names: { zh_tw: names[0], ja_jp: names[1], en_us: names[2] },
    alias: { zh_tw: alias[0], ja_jp: alias[1], en_us: alias[2] },
  };
}

// ---------- 顏色：一滴顏料（c 顏色、h 亮的地方、o 外框） ----------
const DROP = [
  '...oooooo...',
  '..occccccoo.',
  '.occhhccccco',
  '.ochhcccccco',
  'occcccccccco',
  'occcccccccco',
  '.occcccccco.',
  '..occcccco..',
  '.o.occcco.o.',
  '....occo....',
  '.....oo.....',
  '............',
];

function color(id: string, c: string, o: string, names: Names, alias: Alias, h = '#ffffff'): Sticker {
  return s(`color_${id}`, 'color', DROP, { c, o, h }, names, alias);
}

/** 彩虹：顏料的形狀，一條一條不同顏色 */
const RAINBOW = DROP.map((row, y) => row.replace(/[ch]/g, 'raygbp'[Math.min(5, Math.max(0, y - 1))]));

export const COLOR_STICKERS: Sticker[] = [
  color('red', '#e83a3a', '#a02020', ['紅色', 'あか', 'red'], [['紅色', '紅', '红色'], ['あか', '赤', 'あかいろ', '赤色'], ['red']]),
  color('orange', '#ff9a2a', '#c06a10', ['橘色', 'オレンジ', 'orange'], [['橘色', '橙色', '橘', '橘子色'], ['オレンジ', 'だいだい', 'オレンジいろ'], ['orange']]),
  color('yellow', '#ffd83a', '#c0a010', ['黃色', 'きいろ', 'yellow'], [['黃色', '黃', '黄色'], ['きいろ', '黄色'], ['yellow']]),
  color('green', '#4cc04a', '#2a8028', ['綠色', 'みどり', 'green'], [['綠色', '綠', '绿色'], ['みどり', '緑', 'みどりいろ', '緑色'], ['green']]),
  color('blue', '#3a7ae8', '#2050a0', ['藍色', 'あお', 'blue'], [['藍色', '藍', '蓝色'], ['あお', '青', 'あおいろ', '青色'], ['blue']]),
  color('purple', '#9a5ad8', '#6a3098', ['紫色', 'むらさき', 'purple'], [['紫色', '紫'], ['むらさき', '紫', 'むらさきいろ'], ['purple', 'violet']]),
  color('pink', '#ff8ac0', '#c05a8a', ['粉紅色', 'ピンク', 'pink'], [['粉紅色', '粉紅', '粉色', '粉红色'], ['ピンク', 'ももいろ'], ['pink']]),
  color('brown', '#9a6a3a', '#6a4220', ['咖啡色', 'ちゃいろ', 'brown'], [['咖啡色', '棕色', '褐色'], ['ちゃいろ', '茶色'], ['brown']]),
  color('black', '#2a2a2a', '#000000', ['黑色', 'くろ', 'black'], [['黑色', '黑'], ['くろ', '黒', 'くろいろ', '黒色'], ['black']], '#8a8a8a'),
  color('white', '#ffffff', '#9a9aa8', ['白色', 'しろ', 'white'], [['白色', '白'], ['しろ', '白', 'しろいろ'], ['white']], '#dde4f0'),
  color('gray', '#9a9aa0', '#5a5a60', ['灰色', 'はいいろ', 'gray'], [['灰色', '灰'], ['はいいろ', '灰色', 'グレー'], ['gray', 'grey']]),
  s('rainbow', 'color', RAINBOW, { o: '#7a7a8a', r: '#e83a3a', a: '#ff9a2a', y: '#ffd83a', g: '#4cc04a', b: '#3a7ae8', p: '#9a5ad8' }, ['彩虹', 'にじ', 'rainbow'], [['彩虹', '彩虹色'], ['にじ', '虹', 'にじいろ'], ['rainbow']]),
];

// ---------- 形狀 ----------
/** 用公式畫：fn(x, y) 為 true 的格子塗上顏色 */
function shape(fn: (x: number, y: number) => boolean): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 12; y++) {
    let r = '';
    for (let x = 0; x < 12; x++) r += fn(x + 0.5, y + 0.5) ? 'c' : '.';
    rows.push(r);
  }
  return rows;
}

const sh = (id: string, grid: string[], c: string, names: Names, alias: Alias) => s(`shape_${id}`, 'shape', grid, { c }, names, alias);

export const SHAPE_STICKERS: Sticker[] = [
  sh('circle', shape((x, y) => (x - 6) ** 2 + (y - 6) ** 2 <= 30), '#3a7ae8', ['圓形', 'まる', 'circle'], [['圓形', '圓圈', '圓', '圆形'], ['まる', '丸', 'えん', 'まるい'], ['circle']]),
  sh('triangle', shape((x, y) => y > 0.5 && y < 11.5 && Math.abs(x - 6) <= (y - 0.5) / 2 + 0.3), '#e83a3a', ['三角形', 'さんかく', 'triangle'], [['三角形', '三角'], ['さんかく', '三角', 'さんかくけい'], ['triangle']]),
  sh('square', shape((x, y) => x > 1 && x < 11 && y > 1 && y < 11), '#4cc04a', ['正方形', 'しかく', 'square'], [['正方形', '方形', '四方形'], ['しかく', '四角', 'せいほうけい'], ['square']]),
  sh('rectangle', shape((x, y) => x > 0 && x < 12 && y > 3 && y < 9), '#ff9a2a', ['長方形', 'ながしかく', 'rectangle'], [['長方形', '长方形'], ['ながしかく', '長方形', 'ちょうほうけい'], ['rectangle']]),
  sh('star', [
    '.....cc.....', '.....cc.....', '....cccc....', 'cccccccccccc', '.cccccccccc.', '..cccccccc..',
    '...cccccc...', '..cccccccc..', '..ccc..ccc..', '.ccc....ccc.', '.cc......cc.', '............',
  ], '#ffc81a', ['星形', 'ほし', 'star'], [['星形', '星星', '星'], ['ほし', '星', 'ほしがた'], ['star']]),
  sh('heart', [
    '............', '.ccc....ccc.', 'ccccc..ccccc', 'cccccccccccc', 'cccccccccccc', 'cccccccccccc',
    '.cccccccccc.', '..cccccccc..', '...cccccc...', '....cccc....', '.....cc.....', '............',
  ], '#ff5a8a', ['愛心', 'ハート', 'heart'], [['愛心', '心形', '爱心', '心'], ['ハート', 'はーと'], ['heart']]),
  sh('diamond', shape((x, y) => Math.abs(x - 6) + Math.abs(y - 6) <= 6), '#9a5ad8', ['菱形', 'ひしがた', 'diamond'], [['菱形'], ['ひしがた', '菱形'], ['diamond']]),
  sh('oval', shape((x, y) => ((x - 6) / 5.8) ** 2 + ((y - 6) / 3.8) ** 2 <= 1), '#2ab0b0', ['橢圓形', 'だえん', 'oval'], [['橢圓形', '橢圓', '椭圆'], ['だえん', '楕円', 'たまごがた'], ['oval']]),
];
