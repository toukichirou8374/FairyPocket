// 貼紙簿 v0.26 新增的像素貼紙：動物、食物、交通工具再多一些，另外加上工作車、運動、建築、心情。
// 一樣是自己畫的 12×12 像素圖，種類參考 Emoji 裡有的東西。

import type { Sticker } from './stickers';

const K = '#222222';
const G = '#5cc84a';

/** 圓形（球、臉）：圓裡面的每一格用 fn 決定顏色字元 */
function round(fn: (x: number, y: number) => string): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 12; y++) {
    let s = '';
    for (let x = 0; x < 12; x++) {
      const dx = x - 5.5;
      const dy = y - 5.5;
      s += dx * dx + dy * dy <= 30 ? fn(x, y) : '.';
    }
    rows.push(s);
  }
  return rows;
}

/** 在格子上點幾個點 */
function dots(grid: string[], marks: [number, number, string][]): string[] {
  const g = grid.map((r) => r.split(''));
  for (const [x, y, c] of marks) g[y][x] = c;
  return g.map((r) => r.join(''));
}

/** 笑臉的嘴 */
const SMILE: [number, number, string][] = [[3, 7, 'k'], [4, 8, 'k'], [5, 8, 'k'], [6, 8, 'k'], [7, 8, 'k'], [8, 7, 'k']];

const face = (marks: [number, number, string][], skin = 'y') => dots(round(() => skin), marks);

// 汽車的車身（計程車、警車用）
const CAR = ['............', '............', '....rrrr....', '...rbbrbbr..', '..rrbbrbbrr.', '.rrrrrrrrrrr', 'rrrrrrrrrrrr', 'rrrrrrrrrrrr', 'rrkkrrrrkkrr', '.kgk....kgk.', '..k......k..', '............'];

type Names = [string, string, string];
function s(id: string, cat: Sticker['cat'], grid: string[], pal: Sticker['pal'], names: Names, alias: [string[], string[], string[]]): Sticker {
  return {
    id,
    cat,
    grid,
    pal,
    names: { zh_tw: names[0], ja_jp: names[1], en_us: names[2] },
    alias: { zh_tw: alias[0], ja_jp: alias[1], en_us: alias[2] },
  };
}

export const MORE_STICKERS: Sticker[] = [
  // ---------- 動物 ----------
  s('bear', 'animal',
    ['.bb......bb.', 'bBBbbbbbbBBb', '.bbbbbbbbbb.', 'bbbbbbbbbbbb', 'bbkbbbbbbkbb', 'bbbbbbbbbbbb', 'bbbbwwwwbbbb', 'bbbwwkkwwbbb', 'bbbwwwwwwbbb', '.bbbwmmwbbb.', '..bbbbbbbb..', '............'],
    { b: '#9a6a3a', B: '#f0c890', w: '#f0d8b0', k: K, m: '#c05050' },
    ['熊', 'くま', 'bear'], [['熊熊', '小熊', '熊'], ['熊', 'くまさん'], ['teddy', 'bear']]),
  s('lion', 'animal',
    ['..MMMMMMMM..', '.MMMMMMMMMM.', 'MMyyyyyyyyMM', 'MMyyyyyyyyMM', 'MMykyyyykyMM', 'MMyyyyyyyyMM', 'MMyyywwyyyMM', 'MMyywkkwyyMM', 'MMyyywwyyyMM', '.MMyymmyyMM.', '..MMMMMMMM..', '............'],
    { M: '#d8782a', y: '#ffd060', w: '#fff0c8', k: K, m: '#c05050' },
    ['獅子', 'ライオン', 'lion'], [['獅子', '狮子'], ['ライオン', 'らいおん'], ['lion']]),
  s('elephant', 'animal',
    ['............', '.EEEggggEEE.', 'EEEEggggEEEE', 'EEEgkggkgEEE', 'EEEggggggEEE', '.EEggggggEE.', '...wggggw...', '....gggg....', '.....gg.....', '.....gg.....', '......gg....', '............'],
    { E: '#8a94a8', g: '#aab4c8', w: '#ffffff', k: K },
    ['大象', 'ぞう', 'elephant'], [['象', '大象'], ['象', 'ぞうさん'], ['elephant']]),
  s('monkey', 'animal',
    ['...bbbbbb...', '..bbbbbbbb..', '.bbFFbbFFbb.', 'FbFFFFFFFFbF', 'FbFkFFFFkFbF', '.bFFFFFFFFb.', '..FFFkkFFF..', '..FFmmmmFF..', '...FFFFFF...', '....bbbb....', '............', '............'],
    { b: '#8a5a30', F: '#f0c890', k: K, m: '#c05050' },
    ['猴子', 'さる', 'monkey'], [['猴子', '小猴子', '猴'], ['猿', 'おさるさん'], ['monkey']]),
  s('penguin', 'animal',
    ['....nnnn....', '...nnnnnn...', '..nnwwwwnn..', '..nwkwwkwn..', '..nwwoowwn..', '.nnwwwwwwnn.', 'nnnwwwwwwnnn', '.nnwwwwwwnn.', '..nwwwwwwn..', '..nnwwwwnn..', '...oo..oo...', '............'],
    { n: '#2a3040', w: '#ffffff', k: K, o: '#ff9a20' },
    ['企鵝', 'ペンギン', 'penguin'], [['企鹅', '企鵝'], ['ペンギン', 'ぺんぎん'], ['penguin']]),
  s('cow', 'animal',
    ['H..........H', '.HwwwwwwwwH.', 'EwwKKwwwwwwE', 'wwkKKwwwwkww', 'wwwwwwwKKwww', '.wwwwwwKKww.', '.pppppppppp.', '.ppnppppnpp.', '.pppppppppp.', '..pppppppp..', '............', '............'],
    { H: '#e8dcc0', w: '#ffffff', K: '#333333', k: K, E: '#f0c0c0', p: '#ffb8c0', n: '#a04060' },
    ['牛', 'うし', 'cow'], [['牛', '乳牛', '牛牛'], ['牛', 'うしさん', 'もーもー'], ['cow']]),
  s('mouse', 'animal',
    ['............', '.ggg....ggg.', 'gpppg..gpppg', 'gpppggggpppg', '.gggggggggg.', '..gkggggkg..', '..gggggggg..', '...gggggg...', '....gPPg....', '.....gg.....', '............', '............'],
    { g: '#b8b8c8', p: '#ffc0d0', P: '#ff7a9a', k: K },
    ['老鼠', 'ねずみ', 'mouse'], [['老鼠', '小老鼠', '鼠'], ['鼠', 'ねずみさん'], ['mouse', 'rat']]),
  s('turtle', 'animal',
    ['............', '............', '....SSSS....', '...SsSSsS...', '..SSsSSsSS..', '.hSSsSSsSSS.', 'hkhLLLLLLLL.', 'hhh.h....h..', '....h....h..', '............', '............', '............'],
    { S: '#3a9a4a', s: '#2a6a30', L: '#c8b060', h: '#7ac860', k: K },
    ['烏龜', 'かめ', 'turtle'], [['乌龟', '烏龜', '龜', '小烏龜'], ['亀', 'かめさん'], ['tortoise', 'turtle']]),

  // ---------- 食物 ----------
  s('orange', 'food',
    ['......g.....', '.....gLL....', '...oooooo...', '..oooooooo..', '.oooooooooo.', '.oWoooooooo.', '.oooooooooo.', '.oooooooooo.', '..oooooooo..', '...oooooo...', '............', '............'],
    { o: '#ff9a20', W: '#ffd080', g: '#5a3a20', L: '#4ab040' },
    ['橘子', 'みかん', 'orange'], [['柳丁', '柳橙', '橘子', '桔子'], ['蜜柑', 'オレンジ'], ['orange']]),
  s('cherry', 'food',
    ['.......gg...', '......g.g...', '.....g...g..', '....g....g..', '...g.....g..', '..rrr...rrr.', '.rrWrr.rrWrr', '.rrrrr.rrrrr', '.rrrrr.rrrrr', '..rrr...rrr.', '............', '............'],
    { g: '#4a8a30', r: '#e02a40', W: '#ff9aa8' },
    ['櫻桃', 'さくらんぼ', 'cherry'], [['樱桃', '櫻桃'], ['さくらんぼ', 'チェリー'], ['cherries', 'cherry']]),
  s('donut', 'food',
    ['............', '...pppppp...', '..ppSppSpp..', '.ppppppppSp.', '.pSpp..pppp.', '.ppp....ppp.', '.dpp....ppd.', '.dddd..dddd.', '..dddddddd..', '...dddddd...', '............', '............'],
    { p: '#ff8ab8', S: '#ffe04a', d: '#d8a060' },
    ['甜甜圈', 'ドーナツ', 'donut'], [['甜甜圈'], ['ドーナツ', 'どーなつ'], ['doughnut', 'donut']]),
  s('pizza', 'food',
    ['............', '.cccccccccc.', '.cyyyyyyyyc.', '..yyRyyyyy..', '..yyyyyRyy..', '...yyyyyy...', '...yRyyyy...', '....yyyy....', '....yyRy....', '.....yy.....', '.....yy.....', '............'],
    { c: '#c87830', y: '#ffd050', R: '#d83030' },
    ['披薩', 'ピザ', 'pizza'], [['比薩', '披萨', '披薩'], ['ピザ', 'ぴざ'], ['pizza']]),
  s('onigiri', 'food',
    ['............', '.....ww.....', '....wwww....', '...wwwwww...', '..wwwwwwww..', '.wwwwwwwwww.', '.wwwnnnnwww.', 'wwwwnnnnwwww', 'wwwwnnnnwwww', '.wwwnnnnwww.', '............', '............'],
    { w: '#ffffff', n: '#1a3a2a' },
    ['飯糰', 'おにぎり', 'rice ball'], [['饭团', '飯糰', '御飯糰'], ['おにぎり', 'おむすび'], ['rice ball', 'onigiri']]),
  s('egg', 'food',
    ['............', '...wwww.....', '..wwwwwww...', '.wwwwwwwwww.', '.wwwyyyywww.', 'wwwyyyyyywww', 'wwwyyWyyywww', '.wwwyyyywww.', '.wwwwwwwwww.', '..wwwwwwww..', '....www.....', '............'],
    { w: '#ffffff', y: '#ffc020', W: '#ffe890' },
    ['荷包蛋', 'たまごやき', 'egg'], [['蛋', '雞蛋', '荷包蛋', '煎蛋'], ['卵', 'たまご', '目玉焼き', 'めだまやき'], ['fried egg', 'egg']]),
  s('cake', 'food',
    ['.....r......', '....wrw.....', '...wwwwww...', '..wwwwwwwww.', '.pppppppppp.', '.wwwwwwwwww.', '.yyyyyyyyyy.', '.pppppppppp.', '.yyyyyyyyyy.', '.yyyyyyyyyy.', '............', '............'],
    { r: '#e02a40', w: '#ffffff', p: '#ff8ab8', y: '#ffe0a0' },
    ['蛋糕', 'ケーキ', 'cake'], [['蛋糕', '草莓蛋糕'], ['ケーキ', 'けーき'], ['cake']]),
  s('milk', 'food',
    ['....wwww....', '....bbbb....', '...wwwwww...', '..wwwwwwww..', '..wwwwwwww..', '..bbbbbbbb..', '..bwwbbwwb..', '..bbbbbbbb..', '..wwwwwwww..', '..wwwwwwww..', '..wwwwwwww..', '............'],
    { w: '#f4f8ff', b: '#4a90e2' },
    ['牛奶', 'ぎゅうにゅう', 'milk'], [['牛奶', '奶'], ['牛乳', 'ミルク'], ['milk']]),

  // ---------- 交通工具 ----------
  s('taxi', 'vehicle',
    dots(CAR, [[5, 1, 'S'], [6, 1, 'S']]),
    { r: '#ffc820', b: '#a0d8ff', k: K, g: '#aaaaaa', S: '#ffffff' },
    ['計程車', 'タクシー', 'taxi'], [['计程车', '出租车', '計程車', '小黃'], ['タクシー'], ['cab', 'taxi']]),
  s('helicopter', 'vehicle',
    ['kkkkkkkkkkk.', '.....k......', '...bbbbb....', '..bwwbbbbbbb', '.bwwwbbb..bb', '.bbbbbbb....', '..bbbbb.....', '..k...k.....', 'kkkkkkkkk...', '............', '............', '............'],
    { k: '#555555', b: '#4a90e2', w: '#c8f0ff' },
    ['直升機', 'ヘリコプター', 'helicopter'], [['直升机', '直昇機', '直升機'], ['ヘリコプター', 'ヘリ'], ['helicopter']]),
  s('balloon', 'vehicle',
    ['...rrrrrr...', '..rryyyyrr..', '.rrryyyyrrr.', '.rrryyyyrrr.', '.rrryyyyrrr.', '..rryyyyrr..', '...rryyrr...', '....rrrr....', '....k..k....', '....k..k....', '....dddd....', '....dddd....'],
    { r: '#e03a3a', y: '#ffe04a', k: '#555555', d: '#8a5a30' },
    ['熱氣球', 'ききゅう', 'hot air balloon'], [['热气球', '熱氣球', '氣球'], ['気球', 'ききゅう'], ['hot air balloon', 'balloon']]),
  s('motorbike', 'vehicle',
    ['............', '............', '.......kk...', '........r...', '..rrrrrrr...', '.rrrrrrrrr..', '.kkk.rr.kkk.', 'k...kr.k...k', 'k.g.k..k.g.k', 'k...k..k...k', '.kkk....kkk.', '............'],
    { k: '#333333', r: '#3a7ad0', g: '#aaaaaa' },
    ['機車', 'バイク', 'motorcycle'], [['机车', '摩托车', '摩托車', '機車'], ['バイク', 'オートバイ'], ['motorbike', 'scooter', 'motorcycle']]),

  // ---------- 工作車 ----------
  s('police', 'work',
    dots(CAR, [[5, 1, 'R'], [6, 1, 'B']]).map((r, y) => (y >= 2 && y <= 5 ? r.replaceAll('r', 'w') : y >= 6 && y <= 8 ? r.replaceAll('r', 'n') : r)),
    { w: '#ffffff', n: '#2a3a6a', b: '#a0d8ff', k: K, g: '#aaaaaa', R: '#e03a3a', B: '#3a7ad0' },
    ['警車', 'パトカー', 'police car'], [['警车', '警察車', '警車'], ['パトカー', 'けいさつ'], ['police', 'police car']]),
  s('ambulance', 'work',
    ['............', '.R..........', 'wwwwwwwww...', 'wwwrwwwwwbb.', 'wwrrrwwwwbbw', 'wwwrwwwwwwww', 'wwwwwwwwwwww', 'rrrrrrrrrrrr', 'wkkwwwwwwkkw', '.kgk....kgk.', '..k......k..', '............'],
    { w: '#ffffff', r: '#e03a3a', R: '#e03a3a', b: '#a0d8ff', k: K, g: '#aaaaaa' },
    ['救護車', 'きゅうきゅうしゃ', 'ambulance'], [['救护车', '救護車'], ['救急車', 'きゅうきゅうしゃ'], ['ambulance']]),
  s('excavator', 'work',
    ['............', '......yyy...', '.....y...y..', '....y.....y.', 'yyyyy.....kk', 'ybbyy.....kk', 'ybbyyy......', 'yyyyyyyy....', 'kkkkkkkk....', 'kgkgkgkk....', '.kkkkkk.....', '............'],
    { y: '#ffc020', b: '#a0d8ff', k: '#444444', g: '#999999' },
    ['挖土機', 'ショベルカー', 'excavator'], [['挖土机', '怪手', '挖土機'], ['ショベルカー', 'パワーショベル'], ['digger', 'excavator']]),
  s('roller', 'work',
    ['............', '............', '....yyyyy...', '....ybbby...', '....ybbby...', '.yyyyyyyyyy.', 'yyyyyyyyyyyy', 'GGGGGyyyyyyy', 'GGGGG..kkk..', 'GGGGG.kkgkk.', 'GGGGG..kkk..', '............'],
    { y: '#ffc020', b: '#a0d8ff', G: '#888888', k: '#333333', g: '#aaaaaa' },
    ['壓路機', 'ロードローラー', 'road roller'], [['压路机', '壓路機'], ['ロードローラー'], ['steamroller', 'road roller']]),
  s('dumptruck', 'work',
    ['............', '............', 'ooooooo.....', 'oooooooo....', 'ooooooooyyy.', 'ooooooooybby', 'yyyyyyyyybby', 'yyyyyyyyyyyy', 'ykkkyyyykkky', '.kgk....kgk.', '..k......k..', '............'],
    { o: '#c87830', y: '#ffc020', b: '#a0d8ff', k: K, g: '#aaaaaa' },
    ['砂石車', 'ダンプカー', 'dump truck'], [['砂石车', '卡車', '卡车', '翻斗車', '砂石車'], ['ダンプカー', 'ダンプ', 'トラック'], ['truck', 'dump truck']]),
  s('garbagetruck', 'work',
    ['............', '............', 'gggggggg....', 'gGGGGGGgyyy.', 'gGGGGGGgybby', 'ggggggggybby', 'ggggggggyyyy', 'gggggggggggg', 'gkkkggggkkkg', '.kgk....kgk.', '..k......k..', '............'],
    { g: '#4aa860', G: '#2a7a40', y: '#ffffff', b: '#a0d8ff', k: K },
    ['垃圾車', 'ごみしゅうしゅうしゃ', 'garbage truck'], [['垃圾车', '垃圾車'], ['ごみ収集車', 'ごみしゅうしゅうしゃ', 'パッカー車'], ['trash truck', 'garbage truck']]),

  // ---------- 運動 ----------
  s('soccer', 'sport',
    ['............', '....wwww....', '..wwwkkwww..', '.wwwkkkkwww.', '.kwwwkkwwwk.', '.kkwwwwwwkk.', '.kwwwwwwwwk.', '.wwwkkkkwww.', '.wwkkkkkkww.', '..wwkkkkww..', '....wwww....', '............'],
    { w: '#ffffff', k: '#333333' },
    ['足球', 'サッカー', 'soccer'], [['足球', '踢足球'], ['サッカー', 'さっかー'], ['football', 'soccer']]),
  s('basketball', 'sport',
    round((x, y) => (x === 5 || y === 6 || ((x === 2 || x === 9) && y > 2 && y < 9) ? 'k' : 'o')),
    { o: '#f08a30', k: '#5a2a10' },
    ['籃球', 'バスケットボール', 'basketball'], [['篮球', '打籃球', '籃球'], ['バスケットボール', 'バスケ'], ['basketball']]),
  s('baseball', 'sport',
    round((x, y) => ((x === 3 || x === 8) && y >= 3 && y <= 8 ? 'r' : 'w')),
    { w: '#ffffff', r: '#e03a3a' },
    ['棒球', 'やきゅう', 'baseball'], [['棒球', '打棒球'], ['野球', 'やきゅう'], ['baseball']]),
  s('tennis', 'sport',
    round((x, y) => (Math.abs(Math.hypot(x + 2, y - 5.5) - 6.5) < 0.6 || Math.abs(Math.hypot(x - 13, y - 5.5) - 6.5) < 0.6 ? 'w' : 'y')),
    { y: '#d8f040', w: '#ffffff' },
    ['網球', 'テニス', 'tennis'], [['网球', '打網球', '網球'], ['テニス'], ['tennis']]),
  s('volleyball', 'sport',
    round((x, y) => (y === 3 || y === 4 ? 'b' : y === 7 || y === 8 ? 'y' : 'w')),
    { w: '#ffffff', b: '#3a7ad0', y: '#ffd020' },
    ['排球', 'バレーボール', 'volleyball'], [['排球', '打排球'], ['バレーボール', 'バレー'], ['volleyball']]),
  s('pingpong', 'sport',
    ['............', '...rrrr.....', '..rrrrrr....', '.rrrrrrrr...', '.rrrrrrrr...', '.rrrrrrrr.w.', '..rrrrrr....', '...rrrr.....', '....bb......', '....bb......', '....bb......', '............'],
    { r: '#e03a3a', b: '#a06a3a', w: '#ffffff' },
    ['桌球', 'たっきゅう', 'table tennis'], [['乒乓球', '桌球'], ['卓球', 'たっきゅう'], ['ping pong', 'table tennis']]),
  s('swimming', 'sport',
    ['............', '............', '............', '.kkkk..kkkk.', 'kbbbbkkbbbbk', 'kbWbbkkbWbbk', 'kbbbbkkbbbbk', '.kkkk..kkkk.', '............', 'WW..WW..WW..', '..WW..WW..WW', '............'],
    { k: '#333333', b: '#5ad0ff', W: '#4aa8ff' },
    ['游泳', 'すいえい', 'swimming'], [['游泳', '玩水'], ['水泳', 'すいえい', 'およぐ'], ['swim', 'swimming']]),
  s('running', 'sport',
    ['............', '............', '............', '............', '....rr......', '...rrrr.....', '...rrwrr....', '..rrrrrrr...', '.rrrrrrrrrr.', 'rrrrrrrrrrrr', 'wwwwwwwwwwww', '............'],
    { r: '#e05a8a', w: '#ffffff' },
    ['跑步', 'かけっこ', 'running'], [['跑步', '賽跑', '跑'], ['かけっこ', 'はしる', '走る'], ['run', 'running']]),

  // ---------- 建築 ----------
  s('house', 'building',
    ['.....rr.....', '....rrrr....', '...rrrrrr...', '..rrrrrrrr..', '.rrrrrrrrrr.', 'rrrrrrrrrrrr', '.wwwwwwwwww.', '.wbbwwwwbbw.', '.wbbwddwbbw.', '.wwwwddwwww.', '.wwwwddwwww.', '............'],
    { r: '#d84a3a', w: '#fff0d0', b: '#a0d8ff', d: '#8a5a30' },
    ['房子', 'いえ', 'house'], [['房子', '家', '房屋'], ['家', 'おうち'], ['home', 'house']]),
  s('school', 'building',
    ['.....kff....', '.....k......', '....yyyy....', '...yyccyy...', '.yyyyccyyyy.', 'yyyyyyyyyyyy', 'ybbyybbyybby', 'yyyyyyyyyyyy', 'ybbyyddyybby', 'yyyyyddyyyyy', 'gggggggggggg', '............'],
    { y: '#f0d8a0', c: '#ffffff', b: '#a0d8ff', d: '#8a5a30', k: '#555555', f: '#e03a3a', g: G },
    ['學校', 'がっこう', 'school'], [['学校', '學校'], ['学校', 'がっこう'], ['school']]),
  s('hospital', 'building',
    ['............', '.wwwwwwwwww.', '.wwwwrrwwww.', '.wwwrrrrwww.', '.wwwwrrwwww.', '.wwwwwwwwww.', '.wbbwbbwbbw.', '.wwwwwwwwww.', '.wbbwddwbbw.', '.wwwwddwwww.', 'gggggggggggg', '............'],
    { w: '#f4f4f4', r: '#e03a3a', b: '#a0d8ff', d: '#8a5a30', g: G },
    ['醫院', 'びょういん', 'hospital'], [['医院', '醫院'], ['病院', 'びょういん'], ['hospital']]),
  s('castle', 'building',
    ['.p........p.', 'ppp......ppp', 'GGG.G..G.GGG', 'GGGGGGGGGGGG', 'GbGGGGGGGGbG', 'GGGGGGGGGGGG', 'GGGGGddGGGGG', 'GGGGddddGGGG', 'GGGGddddGGGG', 'GGGGddddGGGG', 'gggggggggggg', '............'],
    { p: '#ff7aa0', G: '#c8c8d8', b: '#4a5aa0', d: '#6b4423', g: G },
    ['城堡', 'おしろ', 'castle'], [['城堡', '城'], ['お城', 'しろ'], ['castle']]),
  s('tower', 'building',
    ['.....yy.....', '.....rr.....', '.....rr.....', '....rrrr....', '....wwww....', '....rrrr....', '...rr..rr...', '...wwwwww...', '..rr....rr..', '..rr....rr..', '.rr......rr.', 'rr........rr'],
    { y: '#ffe04a', r: '#e04a2a', w: '#ffffff' },
    ['鐵塔', 'タワー', 'tower'], [['铁塔', '塔', '鐵塔'], ['タワー', 'とう'], ['tower']]),
  s('shop', 'building',
    ['............', 'rwrwrwrwrwrw', 'rwrwrwrwrwrw', '.wrwrwrwrwr.', '.yyyyyyyyyy.', '.ybbbbyddyy.', '.ybbbbyddyy.', '.ybbbbyddyy.', '.yyyyyyddyy.', '.yyyyyyddyy.', 'gggggggggggg', '............'],
    { r: '#e03a3a', w: '#ffffff', y: '#f0d8a0', b: '#a0d8ff', d: '#8a5a30', g: G },
    ['商店', 'おみせ', 'shop'], [['商店', '店', '便利商店'], ['お店', 'みせ'], ['store', 'shop']]),
  s('shrine', 'building',
    ['............', 'rrrrrrrrrrrr', '.rrrrrrrrrr.', '..r......r..', '.rrrrrrrrrr.', '..r......r..', '..r......r..', '..r......r..', '..r......r..', '..r......r..', '.kkk....kkk.', '............'],
    { r: '#e04a2a', k: '#333333' },
    ['神社', 'じんじゃ', 'shrine'], [['神社', '鳥居'], ['神社', '鳥居', 'とりい'], ['shrine']]),
  s('building', 'building',
    ['............', '..bbbbbbbb..', '..bcbccbcb..', '..bbbbbbbb..', '..bcbccbcb..', '..bbbbbbbb..', '..bcbccbcb..', '..bbbbbbbb..', '..bcbccbcb..', '..bbbddbbb..', '..bbbddbbb..', 'gggggggggggg'],
    { b: '#7a8aa8', c: '#ffe680', d: '#444444', g: G },
    ['大樓', 'ビル', 'building'], [['大楼', '大樓', '高樓'], ['ビル', 'びる'], ['skyscraper', 'building']]),

  // ---------- 心情 ----------
  s('happy', 'feeling', face([[3, 4, 'k'], [8, 4, 'k'], ...SMILE, [2, 6, 'p'], [9, 6, 'p']]),
    { y: '#ffd84a', k: K, p: '#ff9ab0' },
    ['開心', 'うれしい', 'happy'], [['开心', '高興', '高兴', '快樂', '開心'], ['嬉しい', 'うれしい', 'たのしい'], ['glad', 'happy']]),
  s('sad', 'feeling', face([[3, 5, 'k'], [8, 5, 'k'], [8, 6, 'b'], [8, 7, 'b'], [3, 9, 'k'], [4, 8, 'k'], [5, 8, 'k'], [6, 8, 'k'], [7, 8, 'k'], [8, 9, 'k']]),
    { y: '#ffd84a', k: K, b: '#4aa8ff' },
    ['難過', 'かなしい', 'sad'], [['难过', '傷心', '伤心', '難過'], ['悲しい', 'かなしい'], ['sad']]),
  s('angry', 'feeling', face([[2, 3, 'k'], [3, 4, 'k'], [9, 3, 'k'], [8, 4, 'k'], [3, 5, 'k'], [8, 5, 'k'], [4, 8, 'k'], [5, 8, 'k'], [6, 8, 'k'], [7, 8, 'k']], 'o'),
    { o: '#ff7a4a', k: K },
    ['生氣', 'おこってる', 'angry'], [['生气', '生氣'], ['怒ってる', 'おこってる', 'おこる'], ['mad', 'angry']]),
  s('surprised', 'feeling', face([[3, 3, 'k'], [3, 4, 'k'], [8, 3, 'k'], [8, 4, 'k'], [5, 7, 'k'], [6, 7, 'k'], [4, 8, 'k'], [7, 8, 'k'], [5, 9, 'k'], [6, 9, 'k']]),
    { y: '#ffd84a', k: K },
    ['驚訝', 'びっくり', 'surprised'], [['惊讶', '嚇一跳', '吓一跳', '驚訝'], ['びっくり', 'おどろいた'], ['surprise', 'surprised']]),
  s('sleepy', 'feeling', face([[2, 5, 'k'], [3, 5, 'k'], [4, 5, 'k'], [7, 5, 'k'], [8, 5, 'k'], [9, 5, 'k'], [5, 8, 'k'], [6, 8, 'k'], [10, 0, 'z'], [11, 0, 'z'], [11, 1, 'z'], [10, 2, 'z'], [11, 2, 'z']]),
    { y: '#ffd84a', k: K, z: '#4a90e2' },
    ['想睡覺', 'ねむい', 'sleepy'], [['想睡', '好睏', '睏', '想睡覺'], ['眠い', 'ねむい'], ['tired', 'sleepy']]),
  s('love', 'feeling', face([[2, 3, 'r'], [4, 3, 'r'], [2, 4, 'r'], [3, 4, 'r'], [4, 4, 'r'], [3, 5, 'r'], [7, 3, 'r'], [9, 3, 'r'], [7, 4, 'r'], [8, 4, 'r'], [9, 4, 'r'], [8, 5, 'r'], ...SMILE]),
    { y: '#ffd84a', k: K, r: '#e8304a' },
    ['喜歡', 'だいすき', 'love'], [['喜欢', '愛', '爱', '喜歡'], ['大好き', 'だいすき', 'すき'], ['love']]),
  s('laugh', 'feeling', face([[2, 5, 'k'], [3, 4, 'k'], [4, 5, 'k'], [7, 5, 'k'], [8, 4, 'k'], [9, 5, 'k'], [3, 7, 'k'], [4, 7, 'k'], [5, 7, 'k'], [6, 7, 'k'], [7, 7, 'k'], [8, 7, 'k'], [3, 8, 'k'], [4, 8, 'r'], [5, 8, 'r'], [6, 8, 'r'], [7, 8, 'r'], [8, 8, 'k'], [4, 9, 'k'], [5, 9, 'k'], [6, 9, 'k'], [7, 9, 'k']]),
    { y: '#ffd84a', k: K, r: '#ff6a7a' },
    ['大笑', 'わらう', 'laugh'], [['大笑', '笑', '哈哈'], ['笑う', 'わらう', 'わらってる'], ['laughing', 'laugh']]),
  s('scared', 'feeling', face([[3, 4, 'k'], [8, 4, 'k'], [3, 3, 'w'], [8, 3, 'w'], [3, 8, 'k'], [4, 7, 'k'], [5, 8, 'k'], [6, 7, 'k'], [7, 8, 'k'], [8, 7, 'k']], 'v'),
    { v: '#b8c8ff', k: K, w: '#ffffff' },
    ['害怕', 'こわい', 'scared'], [['害怕', '好可怕', '怕'], ['怖い', 'こわい'], ['afraid', 'scared']]),
];
