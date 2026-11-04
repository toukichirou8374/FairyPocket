// 精靈舞蹈「聲音」玩法的貼紙：自己畫的像素圖（不用素材包、也不用系統的 Emoji），
// 種類參考 Emoji 裡有的東西。分成動物、食物、交通工具三類，每類 8 個。
// names：畫面上顯示、提示時念的名字；alias：小朋友可能會說的其他說法（語音辨識比對用）。

import type { Lang } from '../i18n';
import type { Palette } from '../pixel';
import { ITEM_ICONS } from '../pixel';

export type StickerCategory = 'animal' | 'food' | 'vehicle';

export interface Sticker {
  id: string;
  cat: StickerCategory;
  grid: string[];
  pal: Palette;
  names: Record<Lang, string>;
  alias: Record<Lang, string[]>;
}

const K = '#222222';

export const STICKERS: Sticker[] = [
  // ---------- 動物 ----------
  {
    id: 'dog', cat: 'animal',
    grid: ['............', '.ee......ee.', 'eeebbbbbbeee', 'eebbbbbbbbee', 'eebkbbbbkbee', '.ebbbbbbbbe.', '..bbwwwwbb..', '..bwwkkwwb..', '..bwwwwwwb..', '...bwmmwb...', '....bbbb....', '............'],
    pal: { e: '#7a4a22', b: '#c8873e', w: '#f5e6c8', k: K, m: '#ff7a8a' },
    names: { zh_tw: '狗', ja_jp: 'いぬ', en_us: 'dog' },
    alias: { zh_tw: ['狗狗', '小狗', '狗'], ja_jp: ['犬', 'わんちゃん', 'わんわん'], en_us: ['doggy', 'puppy', 'dog'] },
  },
  {
    id: 'cat', cat: 'animal',
    grid: ['.o........o.', '.oo......oo.', '.oPo....oPo.', '.ooooOOoooo.', 'oooooooooooo', 'oookoooookoo', 'oooooooooooo', 'oowwwwwwwwoo', 'oowwwppwwwoo', '.owwwwwwwwo.', '..oooooooo..', '............'],
    pal: { o: '#f0a040', O: '#c87020', P: '#ffb0c0', k: K, w: '#fff2dc', p: '#ff8aa0' },
    names: { zh_tw: '貓', ja_jp: 'ねこ', en_us: 'cat' },
    alias: { zh_tw: ['貓咪', '小貓', '猫', '猫咪'], ja_jp: ['猫', 'にゃんこ'], en_us: ['kitty', 'cat'] },
  },
  {
    id: 'rabbit', cat: 'animal',
    grid: ['...wp..pw...', '...wp..pw...', '...wp..pw...', '...ww..ww...', '..wwwwwwww..', '.wwwwwwwwww.', '.wwkwwwwkww.', '.wwwwwwwwww.', '.wPwwppwwPw.', '..wwwwwwww..', '...wwwwww...', '............'],
    pal: { w: '#ffffff', p: '#ffb0c8', k: K, P: '#ffd0dc' },
    names: { zh_tw: '兔子', ja_jp: 'うさぎ', en_us: 'rabbit' },
    alias: { zh_tw: ['兔兔', '小白兔', '兔'], ja_jp: ['兎', 'うさちゃん'], en_us: ['bunny', 'rabbit'] },
  },
  {
    id: 'pig', cat: 'animal',
    grid: ['............', '.pp......pp.', '.pPp....pPp.', '.pppppppppp.', 'pppppppppppp', 'pppkppppkppp', 'pppppppppppp', 'pppSSSSSSppp', 'pppSnSSnSppp', 'pppSSSSSSppp', '.pppppppppp.', '..pppppppp..'],
    pal: { p: '#ffb0c4', P: '#ff8aa5', S: '#ff8aa5', k: K, n: '#a0405a' },
    names: { zh_tw: '豬', ja_jp: 'ぶた', en_us: 'pig' },
    alias: { zh_tw: ['豬豬', '小豬', '猪'], ja_jp: ['豚'], en_us: ['piggy', 'pig'] },
  },
  {
    id: 'fish', cat: 'animal',
    grid: ['............', '.....bb.....', '....bbbb....', '..bbbbbbb..t', '.bwkbbbbbbtt', 'bbbbbbbbbttt', 'bbbbbbbbbttt', '.bbbBBBbbbtt', '..bbbbbbb..t', '....bbbb....', '............', '............'],
    pal: { b: '#4aa8ff', B: '#2a78d0', t: '#2a78d0', w: '#ffffff', k: K },
    names: { zh_tw: '魚', ja_jp: 'さかな', en_us: 'fish' },
    alias: { zh_tw: ['魚魚', '小魚', '鱼'], ja_jp: ['魚', 'おさかな'], en_us: ['fish'] },
  },
  {
    id: 'chick', cat: 'animal',
    grid: ['............', '....yyyy....', '...yyyyyy...', '..yyykyyyy..', '..yyyyyyyoo.', '..yyyyyyyo..', '.yyyyyyyy...', 'yyyYYYyyyy..', 'yyyyYYyyyy..', '.yyyyyyyy...', '...o..o.....', '............'],
    pal: { y: '#ffe04a', Y: '#f0b820', o: '#ff8a20', k: K },
    names: { zh_tw: '小雞', ja_jp: 'ひよこ', en_us: 'chick' },
    alias: { zh_tw: ['雞', '小鸡', '鸡', '雞雞'], ja_jp: ['ひよこ', 'にわとり'], en_us: ['chicken', 'chick'] },
  },
  {
    id: 'frog', cat: 'animal',
    grid: ['............', '.ggg....ggg.', 'gwkwg..gwkwg', 'gwwwggggwwwg', 'gggggggggggg', 'gggggggggggg', 'gPggggggggPg', 'ggmmmmmmmmgg', '.gggggggggg.', '..LLLLLLLL..', '...gg..gg...', '............'],
    pal: { g: '#5cc84a', w: '#ffffff', k: K, P: '#ff9ab0', m: '#2a7a2a', L: '#a8e890' },
    names: { zh_tw: '青蛙', ja_jp: 'かえる', en_us: 'frog' },
    alias: { zh_tw: ['蛙', '青蛙'], ja_jp: ['蛙', 'けろけろ'], en_us: ['froggy', 'frog'] },
  },
  {
    id: 'panda', cat: 'animal',
    grid: ['.kk......kk.', 'kkkwwwwwwkkk', '.kwwwwwwwwk.', '.wwwwwwwwww.', 'wwkkwwwwkkww', 'wkWkwwwwkWkw', 'wwkkwwwwkkww', 'wwwwwkkwwwww', '.wwwwwwwwww.', '..wwwwwwww..', '...wwwwww...', '............'],
    pal: { w: '#ffffff', k: K, W: '#ffffff' },
    names: { zh_tw: '熊貓', ja_jp: 'パンダ', en_us: 'panda' },
    alias: { zh_tw: ['熊猫', '貓熊'], ja_jp: ['パンダ'], en_us: ['panda'] },
  },
  // ---------- 食物 ----------
  {
    id: 'apple', cat: 'food', grid: ITEM_ICONS.apple.grid, pal: ITEM_ICONS.apple.pal,
    names: { zh_tw: '蘋果', ja_jp: 'りんご', en_us: 'apple' },
    alias: { zh_tw: ['苹果'], ja_jp: ['林檎'], en_us: ['apple'] },
  },
  {
    id: 'banana', cat: 'food',
    grid: ['..........b.', '.........yb.', '........yy..', '.......yyy..', '......yyyY..', '.....yyyyY..', '...yyyyyY...', '.yyyyyyYY...', 'byyyyyYY....', '.YYYYY......', '............', '............'],
    pal: { y: '#ffe04a', Y: '#d8a820', b: '#6b4423' },
    names: { zh_tw: '香蕉', ja_jp: 'バナナ', en_us: 'banana' },
    alias: { zh_tw: ['香蕉'], ja_jp: ['バナナ'], en_us: ['banana'] },
  },
  {
    id: 'strawberry', cat: 'food',
    grid: ['..gggggggg..', '...gggggg...', '.rrrrrrrrrr.', 'rrwrrrrwrrrr', 'rrrrrwrrrrwr', 'rwrrrrrrwrrr', '.rrrwrrrrrr.', '.rrrrrrwrrr.', '..rrwrrrrr..', '...rrrrrr...', '....rrrr....', '.....rr.....'],
    pal: { g: '#3aa040', r: '#ff3a4a', w: '#ffe08a' },
    names: { zh_tw: '草莓', ja_jp: 'いちご', en_us: 'strawberry' },
    alias: { zh_tw: ['草莓'], ja_jp: ['苺'], en_us: ['strawberry'] },
  },
  {
    id: 'watermelon', cat: 'food',
    grid: ['............', '............', '............', 'rrrrrrrrrrrr', 'rrkrrrkrrrkr', 'grrrrrrrrrrg', 'gwrrkrrkrrwg', '.gwrrrrrrwg.', '..gwwwwwwg..', '...gggggg...', '............', '............'],
    pal: { r: '#ff4a5a', k: K, w: '#e8ffd0', g: '#2aa040' },
    names: { zh_tw: '西瓜', ja_jp: 'すいか', en_us: 'watermelon' },
    alias: { zh_tw: ['西瓜'], ja_jp: ['西瓜'], en_us: ['watermelon'] },
  },
  {
    id: 'grapes', cat: 'food',
    grid: ['.....b......', '.....bLL....', '.pppppppppp.', '.pPpPpPpPpp.', '..pppppppp..', '..pPpPpPpp..', '...pppppp...', '...pPpPpp...', '....pppp....', '....pPpp....', '.....pp.....', '............'],
    pal: { p: '#9a4ad0', P: '#c890ff', b: '#6b4423', L: '#4caf3a' },
    names: { zh_tw: '葡萄', ja_jp: 'ぶどう', en_us: 'grapes' },
    alias: { zh_tw: ['葡萄'], ja_jp: ['葡萄'], en_us: ['grape', 'grapes'] },
  },
  {
    id: 'carrot', cat: 'food',
    grid: ['........g.g.', '.......gggg.', '......ooog..', '.....ooooo..', '....oooOoo..', '...oooooo...', '...ooOooo...', '..ooooo.....', '..oOooo.....', '.oooo.......', '.oo.........', 'o...........'],
    pal: { o: '#ff8a20', O: '#c86010', g: '#4caf3a' },
    names: { zh_tw: '紅蘿蔔', ja_jp: 'にんじん', en_us: 'carrot' },
    alias: { zh_tw: ['胡蘿蔔', '蘿蔔', '红萝卜', '胡萝卜', '萝卜'], ja_jp: ['人参'], en_us: ['carrot'] },
  },
  {
    id: 'icecream', cat: 'food',
    grid: ['.....ww.....', '....wwww....', '...wwwwww...', '..wwwWwwww..', '..wwwwwwWw..', '.wwwwwwwwww.', '.cccccccccc.', '..cCcCcCcc..', '...cccccc...', '...cCcCcc...', '....cccc....', '.....cc.....'],
    pal: { w: '#ffc0d8', W: '#ffffff', c: '#e0a050', C: '#b07020' },
    names: { zh_tw: '冰淇淋', ja_jp: 'アイス', en_us: 'ice cream' },
    alias: { zh_tw: ['霜淇淋', '冰激凌', '冰激淋', '冰淇淋'], ja_jp: ['アイスクリーム', 'ソフトクリーム'], en_us: ['ice cream', 'icecream'] },
  },
  {
    id: 'bread', cat: 'food',
    grid: ['............', '..oooooooo..', '.oowwwwwwoo.', 'oowwwwwwwwoo', 'oowwwwwwwwoo', '.owwwwwwwwo.', '.owwwwwwwwo.', '.owwwwwwwwo.', '.owwwwwwwwo.', '.oooooooooo.', '............', '............'],
    pal: { o: '#b0702a', w: '#ffe0a0' },
    names: { zh_tw: '麵包', ja_jp: 'パン', en_us: 'bread' },
    alias: { zh_tw: ['面包', '麵包'], ja_jp: ['パン'], en_us: ['bread'] },
  },
  // ---------- 交通工具 ----------
  {
    id: 'car', cat: 'vehicle',
    grid: ['............', '............', '....rrrr....', '...rbbrbbr..', '..rrbbrbbrr.', '.rrrrrrrrrrr', 'rrrrrrrrrrrr', 'rrrrrrrrrrrr', 'rrkkrrrrkkrr', '.kgk....kgk.', '..k......k..', '............'],
    pal: { r: '#e03a3a', b: '#a0d8ff', k: K, g: '#aaaaaa' },
    names: { zh_tw: '汽車', ja_jp: 'くるま', en_us: 'car' },
    alias: { zh_tw: ['車', '车', '汽车', '車子', '车子'], ja_jp: ['車', '自動車'], en_us: ['car'] },
  },
  {
    id: 'bus', cat: 'vehicle',
    grid: ['............', '.yyyyyyyyyy.', 'yybbybbybbyy', 'yybbybbybbyy', 'yyyyyyyyyyyy', 'yyyyyyyyyyyy', 'yYYYYYYYYYYy', 'yyyyyyyyyyyy', 'ykkyyyyyykky', '.kgk....kgk.', '..k......k..', '............'],
    pal: { y: '#ffc020', Y: '#e07020', b: '#a0d8ff', k: K, g: '#aaaaaa' },
    names: { zh_tw: '公車', ja_jp: 'バス', en_us: 'bus' },
    alias: { zh_tw: ['巴士', '公交车', '公车', '公交'], ja_jp: ['バス'], en_us: ['bus'] },
  },
  {
    id: 'train', cat: 'vehicle',
    grid: ['...gggggg...', '..gggggggg..', '..gbbbbbbg..', '..gbbbbbbg..', '..gggggggg..', '..gWWWWWWg..', '..gyggggyg..', '..gggggggg..', '...kkkkkk...', '..k......k..', '.k........k.', 'k..........k'],
    pal: { g: '#3aa0e0', W: '#ffffff', b: '#c8f0ff', y: '#ffe060', k: '#555555' },
    names: { zh_tw: '火車', ja_jp: 'でんしゃ', en_us: 'train' },
    alias: { zh_tw: ['列車', '火车', '电车', '電車'], ja_jp: ['電車', '列車', '汽車'], en_us: ['train'] },
  },
  {
    id: 'airplane', cat: 'vehicle',
    grid: ['.....bb.....', '.....ww.....', '.....ww.....', '....wwww....', '.wwwwwwwwww.', 'wwwwwwwwwwww', '.....ww.....', '.....ww.....', '.....ww.....', '...wwwwww...', '....wwww....', '............'],
    pal: { w: '#e8f0ff', b: '#4a90e2' },
    names: { zh_tw: '飛機', ja_jp: 'ひこうき', en_us: 'airplane' },
    alias: { zh_tw: ['飞机'], ja_jp: ['飛行機'], en_us: ['plane', 'aeroplane', 'airplane'] },
  },
  {
    id: 'boat', cat: 'vehicle',
    grid: ['.....m......', '.....ms.....', '.....mss....', '....smsss...', '...ssmssss..', '..sssmsssss.', '.....m......', 'bbbbbbbbbbbb', '.bbbbbbbbbb.', '..bbbbbbbb..', 'wWwWwWwWwWwW', '............'],
    pal: { m: '#6b4423', s: '#ffffff', b: '#e05a3a', w: '#4aa8ff', W: '#a0d8ff' },
    names: { zh_tw: '帆船', ja_jp: 'ふね', en_us: 'boat' },
    alias: { zh_tw: ['船', '小船', '帆船'], ja_jp: ['船', 'ヨット'], en_us: ['sailboat', 'ship', 'boat'] },
  },
  {
    id: 'bicycle', cat: 'vehicle',
    grid: ['............', '............', '.kkk....kk..', '...r....r...', '...rrrrrr...', '..r..r..rr..', '.kkkr.r.kkk.', 'k...kr.k...k', 'k.g.k..k.g.k', 'k...k..k...k', '.kkk....kkk.', '............'],
    pal: { k: '#333333', r: '#e03a3a', g: '#aaaaaa' },
    names: { zh_tw: '腳踏車', ja_jp: 'じてんしゃ', en_us: 'bicycle' },
    alias: { zh_tw: ['自行車', '脚踏车', '自行车', '單車', '单车'], ja_jp: ['自転車'], en_us: ['bike', 'bicycle'] },
  },
  {
    id: 'rocket', cat: 'vehicle',
    grid: ['.....rr.....', '....rwwr....', '....wwww....', '...wwbbww...', '...wbBBbw...', '...wwbbww...', '...wwwwww...', '..rwwwwwwr..', '.rrwwwwwwrr.', '.rr.oooo.rr.', '....oyyo....', '.....yy.....'],
    pal: { r: '#e03a3a', w: '#f0f0f0', b: '#4a90e2', B: '#a0d8ff', o: '#ff8a20', y: '#ffe04a' },
    names: { zh_tw: '火箭', ja_jp: 'ロケット', en_us: 'rocket' },
    alias: { zh_tw: ['火箭'], ja_jp: ['ロケット'], en_us: ['rocket'] },
  },
  {
    id: 'firetruck', cat: 'vehicle',
    grid: ['............', '..gggggggg..', '..g.g.g.g.g.', '.rrrrrrrbbr.', 'rrrrrrrrbbrr', 'rrrrrrrrrrrr', 'rwwwwwwwrrrr', 'rrrrrrrrrrrr', 'rkkrrrrrrkkr', '.kgk....kgk.', '..k......k..', '............'],
    pal: { r: '#e03a3a', g: '#c0c0c0', b: '#a0d8ff', w: '#ffffff', k: K },
    names: { zh_tw: '消防車', ja_jp: 'しょうぼうしゃ', en_us: 'fire truck' },
    alias: { zh_tw: ['消防车', '救火車', '救火车'], ja_jp: ['消防車'], en_us: ['fire engine', 'firetruck', 'fire truck'] },
  },
];

/** 比對用：去掉空白與標點、英文轉小寫、片假名轉平假名 */
export function normalizeSpeech(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 聽到的話裡有沒有說到這張貼紙 */
export function matchesSticker(heard: string, s: Sticker, lang: Lang): boolean {
  const h = normalizeSpeech(heard);
  if (!h) return false;
  return [s.names[lang], ...s.alias[lang]].some((n) => {
    const w = normalizeSpeech(n);
    return !!w && h.includes(w);
  });
}

/** 貼紙圖：外面加一圈深色描邊，看起來像貼紙 */
export function stickerCanvas(s: Sticker, scale = 8): HTMLCanvasElement {
  const h = s.grid.length;
  const w = Math.max(...s.grid.map((r) => r.length));
  const filled = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && !!s.pal[s.grid[y][x]];
  const c = document.createElement('canvas');
  c.width = (w + 2) * scale;
  c.height = (h + 2) * scale;
  const ctx = c.getContext('2d')!;
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) {
      let col: string | undefined;
      if (filled(x, y)) col = s.pal[s.grid[y][x]];
      else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) col = '#3a2a2a';
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect((x + 1) * scale, (y + 1) * scale, scale, scale);
    }
  }
  return c;
}
