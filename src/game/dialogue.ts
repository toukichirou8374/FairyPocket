// 悅靈的台詞（繁中、日文、英文）。{n} 會被替換成玩家為牠取的名字，{f} 是食物名稱。

import type { Personality } from './state';
import { getLang, type Lang } from '../i18n';

export type LineKind =
  | 'greet' | 'welcomeBack' | 'idle' | 'hungry' | 'sleepy' | 'wake' | 'fed' | 'full'
  | 'pet' | 'tickle' | 'play' | 'call' | 'night' | 'curious'
  | 'fedFood' | 'favorite' | 'fullFood' | 'dance' | 'duplicate';

type Table = Partial<Record<LineKind, string[]>>;

const COMMON: Record<Lang, Record<LineKind, string[]>> = {
  zh_tw: {
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
  },
  ja_jp: {
    greet: ['こんにちは！{n}だよ～', '今日もよろしくね！'],
    welcomeBack: ['おかえり！ずっと待ってたよ～', '会いたかった！', 'おかえりなさい！'],
    idle: ['ららら～♪', 'いいお天気だね', 'なにしてるの？', '音楽が聞こえる！', 'いっしょに遊ぶ？'],
    hungry: ['おなかがぐうぐう鳴ってる…', 'なにかおいしいものある？', 'パンが食べたいな…'],
    sleepy: ['ねむいよ…', 'ふわぁ～、目が閉じちゃう'],
    wake: ['ん…？おはよう…', '起きたよ！', 'ケーキの夢を見てた！'],
    fed: ['おいしい！ありがとう～', 'うんうん！大好き！', 'おなかいっぱい、しあわせ！'],
    full: ['もう食べられないよ～', 'おなかがまんまるだよ！'],
    pet: ['えへへ～気持ちいい', 'もっとなでて', 'だーいすき！'],
    tickle: ['くすぐったい！あはは！', 'くすぐらないで～あはは！'],
    play: ['キャッチ！もう一回！', 'たのしい！', '見ててね！'],
    call: ['来たよ！', '呼んだ？', '飛んでいくね～'],
    night: ['夜もおそいね、早く寝ようね', '星がきれい…'],
    curious: ['あそこになにかある？', 'あれ？', '見てくるね！'],
    fedFood: ['{f}だ！ありがとう～', '{f}だね！知ってるよ！', 'わぁ、{f}！おいしい！', '{f}キャッチ！いただきます～'],
    favorite: ['{f}！{f}が一番好き！', '{f}だ！！どうして好きなの知ってるの！'],
    fullFood: ['{f}だ…でももう食べられないよ～', '{f}はあとで食べてもいい？'],
    dance: ['音楽だ！踊っちゃう～♪', '♪～いい音！', 'いっしょに踊ろう！'],
    duplicate: ['わぁ！友だちが増えた！', 'アメジストがキラキラ～新しい仲間だ！', 'ふたりになったよ！'],
  },
  en_us: {
    greet: ["Hi there! I'm {n}~", 'Nice to see you today!'],
    welcomeBack: ["You're back! I was waiting~", 'I missed you!', 'Welcome back!'],
    idle: ['La la la~♪', 'What a nice day', 'What are you doing?', 'I can hear music!', 'Wanna play?'],
    hungry: ['My tummy is rumbling…', 'Got anything yummy?', 'I want some bread…'],
    sleepy: ["I'm so sleepy…", 'Yawn~ my eyes are closing'],
    wake: ['Hm…? Morning…', "I'm awake!", 'I dreamed about lots of cake!'],
    fed: ['Yummy! Thank you~', 'Mm-hm! I love it!', 'So full and happy!'],
    full: ["I can't eat any more~", 'My tummy is all round!'],
    pet: ['Hehe~ that feels nice', 'Pet me more!', 'I like you so much!'],
    tickle: ['That tickles! Hahaha!', "Don't tickle me~ haha!"],
    play: ['Got it! Throw it again!', 'This is fun!', 'Watch me!'],
    call: ["I'm coming!", 'Did you call me?', 'Flying over~'],
    night: ["It's late, sleep early okay?", 'The stars are so pretty…'],
    curious: ["What's over there?", 'Huh?', "I'll go take a look!"],
    fedFood: ['{f}! Thank you~', 'A {f}! I know this one!', 'Wow, {f}! Yummy!', 'Caught the {f}! Time to eat~'],
    favorite: ['{f}! I love {f} the most!', 'It\'s {f}!! How did you know?'],
    fullFood: ["{f}… but I'm too full~", 'Can I save the {f} for later?'],
    dance: ["Music! Let's dance~♪", '♪~ What a nice sound!', 'Dance with me!'],
    duplicate: ['Wow! A new friend!', 'The amethyst sparkles~ a new friend is born!', 'Now there are two of us!'],
  },
};

const BY_PERSONALITY: Record<Lang, Record<Personality, Table>> = {
  zh_tw: {
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
      idle: ['剛剛那是什麼聲音…？', '待在你旁邊比較安心', '慢慢來就好…'],
      wake: ['嚇、嚇我一跳…', '唔…被吵醒了…'],
      curious: ['好像…沒問題吧？', '我仔細看看喔…'],
    },
    playful: {
      idle: ['來玩嘛來玩嘛！', '轉圈圈～轉圈圈～', '我們來比賽誰飛得快！', '史萊姆球！我要玩史萊姆球！'],
      play: ['再一次！再一次！', '耶～我最厲害！'],
      dance: ['轉圈圈～跳舞最好玩了！'],
      curious: ['那是什麼那是什麼？'],
    },
  },
  ja_jp: {
    guardian: {
      idle: ['ずっと見守ってるからね', 'わたしがいるから大丈夫！', 'つかれた？少し休もうね'],
      call: ['ここにいるよ！ずっといるよ！', '呼んだ？すぐ行くね！'],
      night: ['先に寝ていいよ、見張ってるから'],
    },
    brave: {
      idle: ['もっと遠くまで飛んでみたい！', 'こわいものなんてない！', '探検だ！探検だ！'],
      play: ['もっと遠くでも平気！', 'これくらい楽勝！'],
    },
    cautious: {
      idle: ['今のなんの音…？', 'あなたのそばが安心する', 'ゆっくりでいいよ…'],
      wake: ['び、びっくりした…', 'うぅ…起こされちゃった…'],
      curious: ['だ…大丈夫かな？', 'よーく見てみるね…'],
    },
    playful: {
      idle: ['遊ぼう遊ぼう！', 'くるくる～くるくる～', 'どっちが速いか競争しよう！', 'スライムボール！スライムボールで遊びたい！'],
      play: ['もう一回！もう一回！', 'やった～わたしが一番！'],
      dance: ['くるくる～踊るの大好き！'],
      curious: ['なになに？あれなに？'],
    },
  },
  en_us: {
    guardian: {
      idle: ["I'll always watch over you", "I'm here, don't worry!", 'Tired? Take a little rest'],
      call: ["I'm here! Always!", 'Need me? Coming right away!'],
      night: ["You sleep, I'll keep watch"],
    },
    brave: {
      idle: ['I want to fly even farther!', "I'm not afraid of anything!", 'Adventure! Adventure!'],
      play: ['Throw it farther, I can do it!', 'That distance is easy!'],
    },
    cautious: {
      idle: ['What was that sound…?', 'I feel safe next to you', "Let's take it slow…"],
      wake: ['Y-you startled me…', 'Mmh… you woke me up…'],
      curious: ['Is it… okay?', 'Let me look closely…'],
    },
    playful: {
      idle: ["Let's play, let's play!", 'Spin spin~ spin spin~', "Let's race!", 'Slimeball! I want to play with the slimeball!'],
      play: ['Again! Again!', "Yay~ I'm the best!"],
      dance: ['Spinning~ dancing is the best!'],
      curious: ["What's that, what's that?"],
    },
  },
};

export function pickLine(kind: LineKind, personality: Personality, name: string, rnd = Math.random, food = '', lang: Lang = getLang()): string {
  // 個性台詞放兩次，出現機率比較高
  const own = BY_PERSONALITY[lang][personality][kind] ?? [];
  const pool = [...COMMON[lang][kind], ...own, ...own];
  return pool[Math.floor(rnd() * pool.length)].replaceAll('{n}', name).replaceAll('{f}', food);
}
