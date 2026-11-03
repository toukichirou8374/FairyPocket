// 悅靈的台詞。{n} 會被替換成玩家為牠取的名字，{f} 是食物名稱。

import type { Personality } from './state';

export type LineKind =
  | 'greet' | 'welcomeBack' | 'idle' | 'hungry' | 'sleepy' | 'wake' | 'fed' | 'full'
  | 'pet' | 'tickle' | 'play' | 'call' | 'night' | 'curious'
  | 'fedFood' | 'favorite' | 'fullFood' | 'dance' | 'duplicate';

type Table = Partial<Record<LineKind, string[]>>;

const COMMON: Record<LineKind, string[]> = {
  greet: ['你好呀！我是{n}～', '今天也請多指教！'],
  welcomeBack: ['你回來了！我一直在等你～', '好想你喔！', '歡迎回來！'],
  idle: ['啦啦啦～♪', '今天天氣真好', '你在做什麼呀？', '我聽見音樂的聲音了！', '要一起玩嗎？'],
  hungry: ['肚子咕嚕咕嚕叫了…', '有沒有好吃的呀？', '想吃麵包…'],
  sleepy: ['好睏喔…', '呼啊～眼睛快閉起來了'],
  wake: ['嗯…？早安…', '我醒來了！', '剛剛夢到好多蛋糕！'],
  fed: ['好好吃！謝謝你～', '嗯嗯！最喜歡了！', '吃飽飽，好開心！'],
  full: ['吃不下了啦～', '肚子已經圓滾滾了！'],
  pet: ['嘿嘿～好舒服', '再摸一下嘛', '最喜歡你了！'],
  tickle: ['好癢！哈哈哈！', '不要搔我癢啦～哈哈！'],
  play: ['接到了！再丟一次！', '好好玩！', '看我的！'],
  call: ['我來了！', '你叫我嗎？', '飛過來囉～'],
  night: ['夜深了，要早點睡喔', '星星好漂亮…'],
  curious: ['那裡有什麼嗎？', '咦？', '我去看看！'],
  fedFood: ['是{f}！謝謝你～', '{f}耶！我認得！', '哇，{f}！好好吃！', '接到{f}了！開動囉～'],
  favorite: ['{f}！我最喜歡{f}了！', '是{f}！！你怎麼知道我愛吃這個！'],
  fullFood: ['是{f}…可是我吃不下了啦～', '{f}先留著，等等再吃好嗎？'],
  dance: ['是音樂！我要跳舞～♪', '♪～這個聲音好好聽！', '一起跳舞吧！'],
  duplicate: ['哇！多了一個好朋友！', '紫水晶亮晶晶～新夥伴誕生了！', '我們變成兩個了耶！'],
};

const BY_PERSONALITY: Record<Personality, Table> = {
  guardian: {
    idle: ['我會一直守著你的', '有我在，不用怕！', '你累了嗎？要休息一下喔'],
    call: ['我在這裡！一直都在！', '需要我嗎？馬上到！'],
    night: ['你先睡，我幫你守夜'],
  },
  brave: {
    idle: ['我想飛到更遠的地方看看！', '什麼都不怕！', '探險！探險！'],
    play: ['再丟遠一點也沒問題！', '這點距離難不倒我！'],
  },
  cautious: {
    idle: ['剛剛那是什麼聲音…？', '待在這裡比較安心', '慢慢來就好…'],
    wake: ['嚇、嚇我一跳…', '唔…被吵醒了…'],
    curious: ['好像…沒問題吧？'],
  },
  playful: {
    idle: ['來玩嘛來玩嘛！', '轉圈圈～轉圈圈～', '我們來比賽誰飛得快！', '史萊姆球！我要玩史萊姆球！'],
    play: ['再一次！再一次！', '耶～我最厲害！'],
    dance: ['轉圈圈～跳舞最好玩了！'],
  },
};

export function pickLine(kind: LineKind, personality: Personality, name: string, rnd = Math.random, food = ''): string {
  const pool = [...COMMON[kind], ...(BY_PERSONALITY[personality][kind] ?? []), ...(BY_PERSONALITY[personality][kind] ?? [])];
  return pool[Math.floor(rnd() * pool.length)].replaceAll('{n}', name).replaceAll('{f}', food);
}
