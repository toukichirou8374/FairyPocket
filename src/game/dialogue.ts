// 悅靈的台詞（繁中、日文、英文）。{n} 會被替換成玩家為牠取的名字，{f} 是食物名稱。

import type { Personality } from './state';
import { getLang, type Lang } from '../i18n';

export type LineKind =
  | 'greet' | 'welcomeBack' | 'idle' | 'hungry' | 'sleepy' | 'wake' | 'fed' | 'full'
  | 'pet' | 'tickle' | 'play' | 'call' | 'night' | 'curious'
  | 'fedFood' | 'favorite' | 'fullFood' | 'dance' | 'duplicate'
  | 'missed' | 'longAway' | 'lonely' | 'happyIdle' | 'bedtime' | 'morning'
  // 時段問候與記憶話題（{d} 是天數或次數）
  | 'greetMorning' | 'greetAfternoon' | 'greetEvening'
  | 'remFood' | 'mostFood' | 'missPlay' | 'missDance' | 'streak' | 'together'
  | 'mFed' | 'mPetted' | 'mPlayed' | 'mDays' | 'mStreak' | 'cakeDone' | 'cakeBite' | 'heard' | 'waveBack' | 'bath' | 'firework';

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
    missed: ['你終於回來了！我好想你！', '等你等了好久喔…可是你回來了就好！', '{n}一直在這裡等你喔！'],
    longAway: ['真的是你！好久好久不見了！', '我還以為你忘記我了…嗚嗚，好開心！', '你回來了！今天要陪我很久喔！'],
    lonely: ['陪我一下好不好…', '有點寂寞…', '你在忙嗎？我想跟你玩…', '摸摸我嘛…'],
    happyIdle: ['今天好開心喔～♪', '跟你在一起最快樂了！', '嘿嘿，心情超好！'],
    bedtime: ['到睡覺時間了…晚安～', '呼啊…我先去睡囉，你也早點睡', '晚安，明天見！'],
    morning: ['早安！新的一天開始了！', '早安～睡得好飽！', '天亮了！今天要做什麼呢？'],
    greetMorning: ['早安！今天也一起度過吧～', '早安～你睡得好嗎？', '早上好！{n}已經準備好了！'],
    greetAfternoon: ['午安！你今天過得怎麼樣？', '下午好～吃過午餐了嗎？', '午安！我剛剛一直在等你～'],
    greetEvening: ['晚上好！今天辛苦了～', '你來了！今天發生了什麼事呢？', '睡覺前要陪我玩一下喔！'],
    remFood: ['上次你餵我吃的{f}好好吃喔！', '我還記得{f}的味道～', '{f}…想起來就好開心！'],
    mostFood: ['你最常給我{f}耶！你是不是也喜歡？', '說到{f}，我已經吃過好多次了！', '{f}是我們的回憶味道～'],
    missPlay: ['好久沒玩史萊姆球了…想玩！', '還記得一起玩球嗎？再來一次嘛！'],
    missDance: ['好想再聽一次音階盒…', '上次跳舞好開心，還想再跳！'],
    streak: ['我們已經連續 {d} 天見面了！', '連續第 {d} 天！每天都見得到你真好～'],
    together: ['我們認識第 {d} 天了耶！', '跟你在一起已經 {d} 天了～'],
    mFed: ['這是你第 {d} 次餵我耶！謝謝你一直照顧我！'],
    mPetted: ['你已經摸摸我 {d} 次了！最喜歡你的手了～'],
    mPlayed: ['我們一起玩了 {d} 次了！下一次也要玩喔！'],
    mDays: ['我們已經一起度過 {d} 天了！以後也請多指教！'],
    mStreak: ['連續 {d} 天都來看我！好感動…'],
    bath: ['哇！好涼喔～', '洗得香香的！', '甩甩甩～嘿嘿，濺到你了嗎？', '泡泡好好玩！'],
    firework: ['哇～好漂亮！', '再放一個！再放一個！', '天空開花了！'],
    waveBack: ['嗨嗨～我看到你了！', '揮揮手～你好呀！', '你在跟我打招呼嗎？我也揮揮！'],
    heard: ['嗯嗯！我聽到了～', '♪～你說的我都懂喔！', '嘿嘿，再多說一點！', '{n}聽得好開心！'],
    cakeBite: ['啊嗚～蛋糕好甜！', '再吃一片就好…嘿嘿', '蛋糕軟綿綿的～', '還剩 {d} 片！'],
    cakeDone: ['蛋糕全部吃完了！好幸福～', '最後一片也好好吃！謝謝你的蛋糕！'],
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
    missed: ['やっと帰ってきた！会いたかったよ！', 'ずっと待ってたんだよ…でも帰ってきてくれてよかった！', '{n}はずっとここで待ってたよ！'],
    longAway: ['ほんとにあなただ！ひさしぶり！', '忘れられちゃったかと思った…うれしい！', 'おかえり！今日はいっぱいいっしょにいてね！'],
    lonely: ['ちょっとだけいっしょにいて…', 'なんだかさみしいな…', 'いそがしい？遊びたいな…', 'なでてほしいな…'],
    happyIdle: ['今日はすごく楽しい～♪', 'あなたといると一番しあわせ！', 'えへへ、ごきげんだよ！'],
    bedtime: ['もう寝る時間…おやすみ～', 'ふわぁ…先に寝るね、あなたも早く寝てね', 'おやすみ、また明日！'],
    morning: ['おはよう！新しい一日だね！', 'おはよう～よく寝た！', '朝だ！今日はなにする？'],
    greetMorning: ['おはよう！今日もいっしょにすごそうね～', 'おはよう～よく眠れた？', 'おはよう！{n}はもう準備できてるよ！'],
    greetAfternoon: ['こんにちは！今日はどんな日？', 'こんにちは～お昼ごはん食べた？', 'こんにちは！ずっと待ってたよ～'],
    greetEvening: ['こんばんは！今日もおつかれさま～', '来てくれた！今日はなにがあったの？', '寝る前にちょっと遊んでね！'],
    remFood: ['この前もらった{f}、おいしかったな！', '{f}の味、まだ覚えてるよ～', '{f}…思い出すだけでうれしい！'],
    mostFood: ['{f}をいちばんくれるよね！あなたも好きなの？', '{f}はもう何回も食べたよ！', '{f}はわたしたちの思い出の味～'],
    missPlay: ['ずっとスライムボールで遊んでないな…遊びたい！', 'いっしょにボール遊びしたの覚えてる？またやろう！'],
    missDance: ['また音符ブロックの音が聞きたいな…', 'この前のダンス楽しかった、また踊りたい！'],
    streak: ['{d} 日連続で会えてるよ！', '連続 {d} 日目！毎日会えてうれしい～'],
    together: ['出会って {d} 日目だね！', 'いっしょにいて {d} 日になったよ～'],
    mFed: ['ごはんをくれたの、これで {d} 回目だよ！いつもありがとう！'],
    mPetted: ['なでなで {d} 回目！あなたの手、大好き～'],
    mPlayed: ['いっしょに遊んだの {d} 回目！次も遊ぼうね！'],
    mDays: ['いっしょに {d} 日すごしたよ！これからもよろしくね！'],
    mStreak: ['{d} 日連続で会いに来てくれた！感動…'],
    bath: ['わぁ！つめたい～', 'いいにおいになった！', 'ぶるぶる～えへへ、かかった？', 'あわあわ楽しい！'],
    firework: ['わぁ～きれい！', 'もう一回！もう一回！', '空に花がさいた！'],
    waveBack: ['やっほ～見えてるよ！', 'ふりふり～こんにちは！', 'あいさつしてくれたの？わたしもふりふり！'],
    heard: ['うんうん！聞こえたよ～', '♪～ちゃんとわかってるよ！', 'えへへ、もっと話して！', '{n}、聞けてうれしい！'],
    cakeBite: ['あーん～ケーキあまい！', 'もうひと切れだけ…えへへ', 'ケーキふわふわ～', 'あと {d} 切れ！'],
    cakeDone: ['ケーキ全部食べちゃった！しあわせ～', '最後のひと切れもおいしい！ケーキありがとう！'],
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
    missed: ["You're finally back! I missed you!", 'I waited so long… but I\'m glad you\'re here!', '{n} was waiting right here for you!'],
    longAway: ["It's really you! It's been so long!", 'I thought you forgot me… I\'m so happy!', 'Welcome back! Stay with me a long time today!'],
    lonely: ['Stay with me a little?', "I'm a bit lonely…", 'Are you busy? I want to play…', 'Pet me, please…'],
    happyIdle: ["I'm so happy today~♪", "Being with you is the best!", "Hehe, I'm in a great mood!"],
    bedtime: ["It's bedtime… good night~", "Yawn… I'll sleep first, you sleep early too", 'Good night, see you tomorrow!'],
    morning: ['Good morning! A new day!', 'Morning~ I slept so well!', "It's morning! What shall we do today?"],
    greetMorning: ["Good morning! Let's spend today together~", 'Morning~ did you sleep well?', 'Good morning! {n} is ready!'],
    greetAfternoon: ['Good afternoon! How is your day?', 'Hi~ did you have lunch?', 'Good afternoon! I was waiting for you~'],
    greetEvening: ['Good evening! You worked hard today~', "You're here! What happened today?", 'Play with me a bit before bed!'],
    remFood: ['The {f} you gave me last time was so yummy!', 'I still remember the taste of that {f}~', '{f}… just thinking about it makes me happy!'],
    mostFood: ['You give me {f} the most! Do you like it too?', "I've had {f} so many times now!", '{f} tastes like our memories~'],
    missPlay: ["We haven't played with the slimeball in a while… let's play!", "Remember playing catch? Let's do it again!"],
    missDance: ['I want to hear the note block again…', 'Dancing last time was so fun, I want to dance again!'],
    streak: ["We've met {d} days in a row!", 'Day {d} in a row! I love seeing you every day~'],
    together: ["It's day {d} since we met!", "We've been together for {d} days~"],
    mFed: ["That's feeding number {d}! Thanks for always taking care of me!"],
    mPetted: ["You've petted me {d} times! I love your hands~"],
    mPlayed: ["We've played {d} times! Let's play next time too!"],
    mDays: ["We've spent {d} days together! Please keep being my friend!"],
    mStreak: ["You came to see me {d} days in a row! I'm so touched…"],
    bath: ['Whoa! So cool~', 'All clean and fresh!', 'Shake shake~ hehe, did I splash you?', 'Bubbles are fun!'],
    firework: ['Wow~ so pretty!', 'Another one! Another one!', 'The sky is blooming!'],
    waveBack: ['Hi hi~ I can see you!', 'Wave wave~ hello!', 'Are you saying hi? I wave back!'],
    heard: ['Mm-hm! I heard you~', '♪~ I understand everything you say!', 'Hehe, tell me more!', '{n} loves listening to you!'],
    cakeBite: ['Nom~ the cake is so sweet!', 'Just one more slice… hehe', 'So soft and fluffy~', '{d} slices left!'],
    cakeDone: ['I ate the whole cake! So happy~', 'The last slice was yummy too! Thanks for the cake!'],
  },
};

const BY_PERSONALITY: Record<Lang, Record<Personality, Table>> = {
  zh_tw: {
    guardian: {
      idle: ['我會一直守著你的', '有我在，不用怕！', '你累了嗎？要休息一下喔'],
      call: ['我在這裡！一直都在！', '需要我嗎？馬上到！'],
      night: ['你先睡，我幫你守夜'],
      remFood: ['上次的{f}很好吃，你自己也要好好吃飯喔'],
    },
    brave: {
      idle: ['我想飛到更遠的地方看看！', '什麼都不怕！', '探險！探險！'],
      play: ['再丟遠一點也沒問題！', '這點距離難不倒我！'],
      missPlay: ['好久沒丟球了！這次丟遠一點，我一定接得到！'],
    },
    cautious: {
      idle: ['剛剛那是什麼聲音…？', '待在你旁邊比較安心', '慢慢來就好…'],
      wake: ['嚇、嚇我一跳…', '唔…被吵醒了…'],
      curious: ['好像…沒問題吧？', '我仔細看看喔…'],
      streak: ['每天都見到你…好安心'],
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

export function pickLine(kind: LineKind, personality: Personality, name: string, rnd = Math.random, food = '', lang: Lang = getLang(), d: number | string = ''): string {
  // 個性台詞放兩次，出現機率比較高
  const own = BY_PERSONALITY[lang][personality][kind] ?? [];
  const pool = [...COMMON[lang][kind], ...own, ...own];
  return pool[Math.floor(rnd() * pool.length)].replaceAll('{n}', name).replaceAll('{f}', food).replaceAll('{d}', String(d));
}
