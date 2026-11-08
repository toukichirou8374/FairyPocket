// 跟悅靈說話（麥克風模式）：把聽到的話轉成文字，找出關鍵字判斷意思，選一句合適的話回答。
// 這是「三層人性化」的第一層（規則）：
//   1. 關鍵字判斷意思：規則由上往下比對，「比較長、意思比較特別」的說法放前面，
//      例如「你太安靜了」在「安靜」前面、「不可愛」在「可愛」前面、「你好嗎」在「你好」前面。
//   2. 看情境改變回答（refine）：時段（晚上說早安）、肚子餓、想睡、一直重複同一句、很喜歡你的時候。
//   3. 依個性選台詞：守護、勇敢、膽小、愛玩，各有自己的說法（出現機率比較高）。
// 以後第二層（本機 AI）、第三層（雲端 AI）只要換掉 detectIntent／talkLine，其他不用改。
// 台詞盡量不放名字 {n}，這樣才能事先做好神經語音（scripts/make-voices.mjs）。

import { pickFresh } from './recent';
import type { Lang } from '../i18n';
import type { Personality } from './state';
import { normalizeSpeech } from './stickers';

export type Intent =
  | 'tooQuiet' | 'quiet' | 'notCute' | 'mean' | 'sorry' | 'birthday' | 'howAreYou' | 'likes' | 'whoAmI' | 'age' | 'doing'
  | 'where' | 'love' | 'morning' | 'night' | 'goOut' | 'bye' | 'home' | 'greet' | 'thanks' | 'proud' | 'cheer' | 'praise'
  | 'sing' | 'dance' | 'joke' | 'story' | 'play' | 'full' | 'tasty' | 'hungry' | 'name' | 'sick' | 'cold' | 'hot' | 'rain'
  | 'scared' | 'hurt' | 'sad' | 'happy' | 'angry' | 'bath' | 'brush' | 'school' | 'friend' | 'fly' | 'come';

/** 情境改變後的回答（第一層的「像生物」） */
export type Reply = Intent | 'repeat' | 'morningAtNight' | 'nightAtDay' | 'hungryNoPlay' | 'sleepyNoPlay' | 'lovesBack';

type Words = Record<Lang, string[]>;

/** 意思 → 各語言的關鍵字（順序就是比對的優先順序） */
const RULES: [Intent, Words][] = [
  ['tooQuiet', {
    zh_tw: ['太安靜', '好安靜', '很安靜耶', '怎麼不說話', '都不說話', '說說話', '說話啊', '跟我說話', '你好安靜'],
    ja_jp: ['静かすぎ', 'しずかすぎ', 'なんでしゃべらない', 'しゃべって', 'なにか話して', 'なにかいって', 'おしゃべりして'],
    en_us: ['too quiet', 'so quiet', 'say something', 'talk to me', 'why are you quiet', 'speak up'],
  }],
  ['quiet', {
    zh_tw: ['安靜', '小聲', '噓', '不要吵', '別吵', '好吵', '太吵', '閉嘴'],
    ja_jp: ['静かに', 'しずかに', 'しーっ', 'うるさい', 'だまって'],
    en_us: ['be quiet', 'quiet', 'shh', 'hush', 'too loud', 'stop talking'],
  }],
  ['notCute', {
    zh_tw: ['不可愛', '討厭你', '不喜歡你', '壞壞'],
    ja_jp: ['かわいくない', 'きらい', '嫌い'],
    en_us: ['not cute', 'hate you', "don't like you", 'do not like you'],
  }],
  ['mean', {
    zh_tw: ['笨蛋', '壞蛋', '你好笨', '你很笨', '討厭鬼', '臭臭'],
    ja_jp: ['ばか', 'バカ', 'あほ', 'まぬけ'],
    en_us: ['stupid', 'dummy', 'idiot', 'silly head'],
  }],
  ['sorry', {
    zh_tw: ['對不起', '抱歉', '不好意思', '我錯了'],
    ja_jp: ['ごめん', 'すみません', 'すいません'],
    en_us: ['sorry', 'my bad', 'apologize'],
  }],
  ['birthday', {
    zh_tw: ['生日快樂', '生日'],
    ja_jp: ['たんじょうび', '誕生日', 'おたんじょう'],
    en_us: ['happy birthday', 'birthday'],
  }],
  ['howAreYou', {
    zh_tw: ['你好嗎', '你還好嗎', '今天好嗎', '過得好嗎', '你好不好'],
    ja_jp: ['げんき', '元気', 'だいじょうぶ', '大丈夫'],
    en_us: ['how are you', 'are you okay', 'are you ok', "how's it going", 'how is it going'],
  }],
  ['likes', {
    zh_tw: ['你喜歡什麼', '喜歡吃什麼', '最喜歡什麼', '愛吃什麼', '喜歡什麼顏色', '喜歡玩什麼'],
    ja_jp: ['なにがすき', '何が好き', 'すきなもの', '好きなもの', 'すきなたべもの', 'すきないろ'],
    en_us: ['what do you like', 'favorite', 'favourite'],
  }],
  ['whoAmI', {
    zh_tw: ['我是誰', '知道我是誰', '記得我嗎'],
    ja_jp: ['わたしはだれ', 'ぼくはだれ', '私は誰', '僕は誰', 'おぼえてる'],
    en_us: ['who am i', 'remember me'],
  }],
  ['age', {
    zh_tw: ['幾歲', '多大了'],
    ja_jp: ['なんさい', '何歳', 'いくつなの'],
    en_us: ['how old'],
  }],
  ['doing', {
    zh_tw: ['在做什麼', '在幹嘛', '在幹什麼', '在幹麻', '在忙什麼'],
    ja_jp: ['なにしてる', '何してる', 'なにしてるの'],
    en_us: ['what are you doing', 'what you doing', "what's up", 'whats up'],
  }],
  ['where', {
    zh_tw: ['你在哪', '在哪裡', '跑去哪'],
    ja_jp: ['どこにいる', 'どこなの', 'どこいった'],
    en_us: ['where are you'],
  }],
  ['love', {
    zh_tw: ['喜歡你', '愛你', '好可愛', '可愛', '最喜歡', '抱抱'],
    ja_jp: ['すき', '好き', 'かわいい', '可愛い', 'あいしてる', 'だいすき', 'ぎゅー'],
    en_us: ['love you', 'like you', 'cute', 'adorable', 'hug'],
  }],
  ['morning', {
    zh_tw: ['早安', '早上好', '起床'],
    ja_jp: ['おはよう'],
    en_us: ['good morning', 'wake up'],
  }],
  ['night', {
    zh_tw: ['晚安', '睡覺', '想睡', '好睏'],
    ja_jp: ['おやすみ', 'ねむい', '眠い', 'ねる'],
    en_us: ['good night', 'goodnight', 'sleep', 'bedtime'],
  }],
  ['goOut', {
    zh_tw: ['我要出門', '出門了', '去上學', '去學校', '出去玩'],
    ja_jp: ['いってきます', 'でかける', '出かける', 'がっこういってくる'],
    en_us: ['going out', 'going to school', 'off to school', 'heading out'],
  }],
  ['bye', {
    zh_tw: ['掰掰', '拜拜', '再見', '我要走了'],
    ja_jp: ['バイバイ', 'ばいばい', 'またね', 'さようなら'],
    en_us: ['bye', 'see you', 'goodbye'],
  }],
  ['home', {
    zh_tw: ['我回來了', '我回家了', '回來囉'],
    ja_jp: ['ただいま'],
    en_us: ["i'm home", "i'm back", 'i am home'],
  }],
  ['thanks', {
    zh_tw: ['謝謝', '谢谢', '感謝'],
    ja_jp: ['ありがとう'],
    en_us: ['thank'],
  }],
  ['proud', {
    zh_tw: ['我做到了', '我會了', '我學會', '一百分', '我好棒', '我很棒', '我成功', '我贏了'],
    ja_jp: ['できた', 'ひゃくてん', '100点', '勝った', 'できるようになった'],
    en_us: ['i did it', 'i can do it', 'hundred', 'i won', 'i made it'],
  }],
  ['cheer', {
    zh_tw: ['加油'],
    ja_jp: ['がんばれ', 'がんばって', '頑張れ', 'ファイト'],
    en_us: ['good luck', 'you can do it', 'go go'],
  }],
  ['praise', {
    zh_tw: ['好棒', '很棒', '厲害', '好乖', '做得好', '讚'],
    ja_jp: ['すごい', 'えらい', 'いいね', 'じょうず', '上手'],
    en_us: ['good job', 'great', 'awesome', 'well done', 'good girl', 'good boy', 'amazing'],
  }],
  ['greet', {
    zh_tw: ['你好', '哈囉', '哈喽', '嗨', '午安'],
    ja_jp: ['こんにちは', 'こんばんは', 'やあ', 'ハロー', 'やっほー'],
    en_us: ['hello', 'hi', 'hey', 'good afternoon'],
  }],
  ['sing', {
    zh_tw: ['唱歌', '唱首歌', '唱一首'],
    ja_jp: ['うたって', '歌って', 'うたう'],
    en_us: ['sing', 'song'],
  }],
  ['dance', {
    zh_tw: ['跳舞', '轉圈'],
    ja_jp: ['おどって', '踊って', 'ダンス', 'くるくる'],
    en_us: ['dance', 'spin'],
  }],
  ['joke', {
    zh_tw: ['笑話', '好笑的', '逗我笑'],
    ja_jp: ['ギャグ', 'じょうだん', 'おもしろいこと', '笑わせて'],
    en_us: ['joke', 'something funny', 'make me laugh'],
  }],
  ['story', {
    zh_tw: ['故事'],
    ja_jp: ['おはなし', 'お話', 'むかしばなし'],
    en_us: ['story'],
  }],
  ['play', {
    zh_tw: ['來玩', '一起玩', '玩遊戲', '好無聊'],
    ja_jp: ['あそぼう', '遊ぼう', 'あそんで', 'たいくつ'],
    en_us: ["let's play", 'play with me', 'bored'],
  }],
  ['full', {
    zh_tw: ['吃飽', '好飽'],
    ja_jp: ['おなかいっぱい', 'ごちそうさま'],
    en_us: ["i'm full", 'so full'],
  }],
  ['tasty', {
    zh_tw: ['好好吃', '好吃'],
    ja_jp: ['おいしい', '美味しい'],
    en_us: ['yummy', 'delicious', 'tasty'],
  }],
  ['hungry', {
    zh_tw: ['肚子餓', '餓了', '好餓', '吃飯', '想吃'],
    ja_jp: ['おなかすいた', 'お腹すいた', 'たべたい', 'ごはん'],
    en_us: ['hungry', 'eat', 'food', 'snack'],
  }],
  ['name', {
    zh_tw: ['叫什麼', '你的名字', '你是誰'],
    ja_jp: ['なまえ', '名前', 'だれ'],
    en_us: ['your name', 'who are you'],
  }],
  ['sick', {
    zh_tw: ['生病', '不舒服', '感冒', '發燒', '咳嗽'],
    ja_jp: ['びょうき', '病気', 'かぜひいた', '風邪', 'ねつがある', '熱がある'],
    en_us: ['sick', 'a cold', 'fever', 'not feeling well'],
  }],
  ['cold', {
    zh_tw: ['好冷', '很冷', '冷死', '好冰'],
    ja_jp: ['さむい', '寒い'],
    en_us: ['cold', 'freezing'],
  }],
  ['hot', {
    zh_tw: ['好熱', '很熱', '熱死'],
    ja_jp: ['あつい', '暑い'],
    en_us: ['hot'],
  }],
  ['rain', {
    zh_tw: ['下雨', '雨好大', '打雷'],
    ja_jp: ['あめがふって', '雨', 'かみなり'],
    en_us: ['rain', 'thunder'],
  }],
  ['scared', {
    zh_tw: ['我怕', '好怕', '害怕', '可怕', '恐怖'],
    ja_jp: ['こわい', '怖い'],
    en_us: ['scared', 'scary', 'afraid'],
  }],
  ['hurt', {
    zh_tw: ['好痛', '痛痛', '很痛', '受傷', '跌倒'],
    ja_jp: ['痛い', 'いたっ', 'けがした', 'ころんだ'],
    en_us: ['hurt', 'ouch', 'fell down'],
  }],
  ['sad', {
    zh_tw: ['難過', '不開心', '傷心', '想哭', '好累'],
    ja_jp: ['かなしい', '悲しい', 'さみしい', 'つかれた'],
    en_us: ['sad', 'lonely', 'tired', 'cry'],
  }],
  ['happy', {
    zh_tw: ['好開心', '好高興', '好快樂', '開心'],
    ja_jp: ['うれしい', 'たのしい', '楽しい'],
    en_us: ["i'm happy", 'so happy', 'fun'],
  }],
  ['angry', {
    zh_tw: ['生氣', '氣死'],
    ja_jp: ['おこった', '怒った', 'むかつく', 'ぷんぷん'],
    en_us: ['angry', 'mad'],
  }],
  ['bath', {
    zh_tw: ['洗澡', '泡澡'],
    ja_jp: ['おふろ', 'お風呂'],
    en_us: ['bath', 'shower'],
  }],
  ['brush', {
    zh_tw: ['刷牙'],
    ja_jp: ['はみがき', '歯みがき', '歯磨き'],
    en_us: ['brush my teeth', 'brush teeth', 'brushing'],
  }],
  ['school', {
    zh_tw: ['學校', '上課', '老師', '幼稚園', '作業'],
    ja_jp: ['がっこう', '学校', 'ようちえん', '幼稚園', 'せんせい', 'しゅくだい'],
    en_us: ['school', 'teacher', 'kindergarten', 'homework'],
  }],
  ['friend', {
    zh_tw: ['好朋友', '朋友'],
    ja_jp: ['ともだち', '友達'],
    en_us: ['friend'],
  }],
  ['fly', {
    zh_tw: ['飛高高', '飛起來', '飛一下', '飛飛'],
    ja_jp: ['とんで', '飛んで'],
    en_us: ['fly'],
  }],
  ['come', {
    zh_tw: ['過來', '來這裡', '來我這'],
    ja_jp: ['こっちきて', 'こっちに来て', 'おいで'],
    en_us: ['come here', 'come over'],
  }],
];

/** 英文的關鍵字要是完整的字（避免 "hi" 比對到 "this"） */
function hasWord(text: string, word: string): boolean {
  const re = new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
  return re.test(text);
}

/** 找出聽到的話的意思；不知道就回傳 null */
export function detectIntent(heard: string, lang: Lang): Intent | null {
  if (lang === 'en_us') {
    const h = ` ${heard.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `;
    for (const [intent, words] of RULES) if (words.en_us.some((w) => hasWord(h, w))) return intent;
    return null;
  }
  const h = normalizeSpeech(heard);
  if (!h) return null;
  for (const [intent, words] of RULES) if (words[lang].some((w) => h.includes(normalizeSpeech(w)))) return intent;
  return null;
}

// ---------- 情境 ----------

export interface TalkCtx {
  /** 現在幾點（0–23） */
  hour: number;
  hungry: boolean;
  sleepy: boolean;
  /** 一分鐘內第幾次說同一個意思（1 = 第一次） */
  repeat: number;
  /** 喜歡你的程度 0–100 */
  affection: number;
}

/** 看情境改變回答：晚上說早安、肚子餓不想玩、一直說同一句…… */
export function refine(intent: Intent, ctx: TalkCtx, rnd = Math.random): Reply {
  if (ctx.repeat >= 3 && intent !== 'quiet') return 'repeat';
  const night = ctx.hour >= 18 || ctx.hour < 4;
  if (intent === 'morning' && night) return 'morningAtNight';
  if (intent === 'night' && ctx.hour >= 7 && ctx.hour < 17) return 'nightAtDay';
  if ((intent === 'play' || intent === 'dance' || intent === 'fly') && ctx.hungry) return 'hungryNoPlay';
  if ((intent === 'play' || intent === 'dance' || intent === 'fly') && ctx.sleepy) return 'sleepyNoPlay';
  if (intent === 'love' && ctx.affection > 70 && rnd() < 0.5) return 'lovesBack';
  return intent;
}

// ---------- 台詞 ----------

type Lines = Record<Lang, string[]>;
const L = (zh_tw: string[], ja_jp: string[], en_us: string[]): Lines => ({ zh_tw, ja_jp, en_us });

/** 大家都會說的台詞 */
export const TALK_LINES: Record<Reply, Lines> = {
  tooQuiet: L(['那我來唱歌給你聽！啦啦啦～', '我在這裡喔！要聊什麼呢？'], ['じゃあ歌っちゃう！ららら〜', 'ここにいるよ！なにをお話しする？'], ["Then I'll sing for you! La la la~", "I'm right here! What shall we talk about?"]),
  quiet: L(['好，我小聲一點…', '噓…我安靜陪你', '好喔，我用悄悄話跟你說', '我變成安靜的小老鼠了'], ['うん、しずかにするね…', 'しーっ…そばにいるね', 'ないしょばなしでいくね', 'しずかなねずみさんになるね'], ["Okay, I'll be quiet…", 'Shh… I’ll stay quietly with you', "Okay, I'll whisper", "I'm a quiet little mouse now"]),
  notCute: L(['嗚嗚…那我要更努力！', '哼，我明明很可愛！', '那我笑一個給你看，嘻嘻！', '沒關係，我還是喜歡你'], ['えーん…もっとがんばる！', 'むー、かわいいもん！', 'じゃあ、にっこりしてみるね！', 'いいもん、わたしはあなたがすき'], ["Aww… I'll try harder!", "Hmph, I'm totally cute!", "Then here's my best smile!", "That's okay, I still like you"]),
  mean: L(['嗚…不可以說別人笨喔', '哼！我才不笨呢！'], ['うぅ…そんなこと言っちゃだめだよ', 'むー！ばかじゃないもん！'], ["Hey… that's not a nice word", "Hmph! I'm not silly!"]),
  sorry: L(['沒關係！我們還是好朋友', '嗯，我原諒你了！', '說對不起的你好勇敢', '來，打勾勾和好吧！'], ['いいよ！ずっとなかよしだよ', 'うん、ゆるしてあげる！', 'ごめんねって言えて、えらいね', 'ゆびきりして、なかなおり！'], ["It's okay! We're still friends", 'Okay, I forgive you!', 'Saying sorry is brave!', "Let's pinky promise and make up!"]),
  birthday: L(['生日快樂！祝你天天開心！', '哇！要吃蛋糕嗎？生日快樂！'], ['おたんじょうびおめでとう！', 'わーい！ケーキたべる？おめでとう！'], ['Happy birthday! Have the best day!', 'Yay! Cake time? Happy birthday!']),
  howAreYou: L(['我很好！你呢？', '超有精神的！謝謝你問我', '今天也很有精神喔！', '吃飽睡飽，心情超好！'], ['げんきだよ！あなたは？', 'とってもげんき！きいてくれてありがとう', 'きょうもげんきいっぱい！', 'たくさんねたから、ばっちり！'], ["I'm great! How about you?", "Full of energy! Thanks for asking", "I'm feeling super good today!", 'I slept well, so I feel great!']),
  likes: L(['我最喜歡蛋糕和音樂！', '我喜歡亮晶晶的東西，還有你！', '我喜歡唱歌，還有在天空飛', '我最喜歡跟你一起玩了！'], ['ケーキと音楽がだいすき！', 'キラキラしたものと、あなたがすき！', 'うたうのと、そらをとぶのがすき', 'あなたとあそぶのがいちばんすき！'], ['I love cake and music!', 'I like shiny things, and you!', 'I like singing and flying in the sky', 'Playing with you is my favorite!']),
  whoAmI: L(['你是我最重要的好朋友！', '當然記得！你是我的主人呀'], ['いちばんだいじなおともだち！', 'もちろんおぼえてるよ！'], ["You're my most important friend!", 'Of course I remember you!']),
  age: L(['嗯…我是悅靈，年紀是祕密！', '跟你認識的那天，就是我的生日喔'], ['うーん…ひみつ！', 'あなたに会えた日がわたしのたんじょうびだよ'], ["Hmm… that's a secret!", 'The day I met you is my birthday']),
  doing: L(['我在等你呀！', '我在聽音樂，在想要不要跳舞'], ['あなたをまってたよ！', '音楽をきいてたの'], ['Waiting for you!', 'Listening to music and thinking about dancing']),
  where: L(['我在這裡！就在你旁邊', '在這裡在這裡！', '我在你身邊飛來飛去喔', '回頭看看，我在這裡！'], ['ここだよ！となりにいるよ', 'ここここ！', 'あなたのまわりをとんでるよ', 'うしろをみて、ここだよ！'], ["I'm right here! Next to you", 'Over here, over here!', "I'm flying around you!", "Look behind you, I'm here!"]),
  love: L(['我也最喜歡你了！', '嘿嘿，好開心～', '你的愛讓我好溫暖', '我們永遠在一起喔'], ['わたしもだいすき！', 'えへへ、うれしい〜', 'あなたのきもちで、ぽかぽかするよ', 'ずっといっしょだよ'], ['I love you too!', 'Hehe, that makes me happy~', 'Your love makes me feel warm', "We'll always be together"]),
  lovesBack: L(['我最最最喜歡你了！全世界第一！', '每次你這樣說，我的心都亮起來了'], ['せかいでいちばんだいすき！', 'そう言ってくれると、むねがキラキラするの'], ['I love you the most in the whole world!', 'When you say that, my heart sparkles']),
  morning: L(['早安！今天也一起加油！', '早安～睡得好嗎？'], ['おはよう！今日もいっしょにがんばろう！', 'おはよう〜よくねむれた？'], ["Good morning! Let's have a great day!", 'Morning~ Did you sleep well?']),
  morningAtNight: L(['咦？現在是晚上了啦！', '早安？外面天都黑了喔'], ['あれ？いまは夜だよ！', 'おはよう？そとはまっくらだよ'], ["Huh? It's nighttime now!", "Good morning? It's dark outside!"]),
  night: L(['晚安，做個好夢喔', '呼啊…我也想睡了'], ['おやすみ、いいゆめをね', 'ふわぁ…わたしもねむい'], ['Good night, sweet dreams', 'Yawn… I’m sleepy too']),
  nightAtDay: L(['現在還是白天耶，要午睡嗎？', '這麼早就要睡啦？'], ['まだおひるだよ、おひるね？', 'もうねちゃうの？'], ["It's still daytime! A nap?", 'Sleeping already?']),
  goOut: L(['路上小心喔！', '早點回來，我會等你'], ['いってらっしゃい！きをつけてね', 'はやくかえってきてね'], ['Have a good time! Be careful!', "Come back soon, I'll wait"]),
  bye: L(['掰掰！要早點回來喔', '再見～我會等你'], ['バイバイ！はやくかえってきてね', 'またね〜まってるよ'], ['Bye! Come back soon', "See you~ I'll wait for you"]),
  home: L(['歡迎回來！我好想你！', '你回來了！今天好玩嗎？'], ['おかえり！あいたかった！', 'おかえりなさい！たのしかった？'], ['Welcome home! I missed you!', "You're back! Did you have fun?"]),
  greet: L(['你好呀！', '嗨嗨！今天也很高興見到你', '嗨！你來找我玩啦！', '你好你好！我等你好久了'], ['こんにちは！', 'やっほー！会えてうれしい', 'やあ！あそびにきてくれたの？', 'こんにちは！まってたよ'], ['Hello!', 'Hi hi! So happy to see you', 'Hi! Did you come to play?', 'Hello hello! I was waiting for you']),
  thanks: L(['不客氣！', '嘿嘿，能幫上忙真好', '不用謝啦，我們是好朋友嘛', '下次也可以找我喔！'], ['どういたしまして！', 'えへへ、よかった', 'いいよいいよ、なかよしだもん', 'またいつでもよんでね！'], ["You're welcome!", 'Hehe, happy to help', "No problem, we're friends!", 'Ask me anytime!']),
  proud: L(['哇！你好厲害！', '我就知道你做得到！'], ['わあ！すごいすごい！', 'できるってしってたよ！'], ["Wow! You're amazing!", 'I knew you could do it!']),
  cheer: L(['謝謝！我會加油的！', '有你幫我加油，我好有力氣！'], ['ありがとう！がんばる！', 'おうえんしてくれるとげんきでる！'], ["Thanks! I'll do my best!", 'Your cheering gives me power!']),
  praise: L(['真的嗎？好開心！', '嘿嘿，被稱讚了～', '你這樣說，我都害羞了啦', '我會繼續努力的！'], ['ほんと？うれしい！', 'えへへ、ほめられちゃった〜', 'そういわれると、てれちゃう', 'これからもがんばるね！'], ['Really? Yay!', 'Hehe, thank you~', "You're making me blush!", "I'll keep doing my best!"]),
  sing: L(['啦啦啦～我是快樂的悅靈～', '你也一起唱嘛！啦啦～'], ['ららら〜たのしいな〜', 'いっしょにうたおう！らら〜'], ['La la la~ I’m a happy allay~', 'Sing with me! La la~']),
  dance: L(['看我轉圈圈！', '一起跳舞吧！', '左搖搖，右搖搖！', '跟著我一起跳，一二三！'], ['くるくる〜見てて！', 'いっしょにおどろう！', 'ひだりにゆらゆら、みぎにゆらゆら！', 'いっしょにおどろう、いち、に、さん！'], ['Watch me spin!', "Let's dance together!", 'Sway left, sway right!', 'Dance with me, one, two, three!']),
  joke: L(['為什麼蛋糕最開心？因為它每天都在笑「糕」興！', '我剛剛想飛，結果撞到雲，雲說：你好軟喔！'], ['パンはパンでも、たべられないパンはなーんだ？フライパン！', 'ふとんがふっとんだ！'], ['Why did the cookie go to the doctor? It felt crummy!', 'What do you call a sleeping bull? A bulldozer!']),
  story: L(['從前從前，有一隻小悅靈，最喜歡跟好朋友一起唱歌。有一天，牠找到一顆亮晶晶的星星，就送給了牠最重要的人。那個人就是你！', '很久很久以前，森林裡有一棵會唱歌的樹。每天晚上，小動物們都會來聽歌，然後甜甜地睡著了。'], ['むかしむかし、うたがだいすきなちいさなアレイがいました。ある日キラキラのほしをみつけて、いちばんだいじな人にプレゼントしました。それはあなたです！', 'むかしむかし、もりにうたうきがありました。よるになると、どうぶつたちがあつまって、すやすやねむりました。'], ['Once upon a time, a little allay found a shiny star and gave it to the most important person. That person is you!', 'Long ago, there was a singing tree in the forest. Every night, the animals came to listen and fell fast asleep.']),
  play: L(['好呀！要玩什麼？', '來玩！點書本可以玩小遊戲喔'], ['いいよ！なにしてあそぶ？', 'あそぼう！本のボタンでミニゲームができるよ'], ['Sure! What shall we play?', "Let's play! Tap the book for mini games"]),
  hungryNoPlay: L(['好想玩…可是我肚子好餓，先給我吃點東西好嗎？', '肚子咕嚕咕嚕叫，飛不動了啦～'], ['あそびたいけど…おなかぺこぺこ。なにかたべさせて？', 'おなかがぐーぐーで、とべないよ〜'], ["I want to play… but I'm so hungry. Can I have a snack first?", "My tummy is rumbling, I can't fly~"]),
  sleepyNoPlay: L(['呼啊…好睏喔，明天再玩好不好？', '眼睛快閉起來了…'], ['ふわぁ…ねむいよ、あしたあそぼう？', 'めがとじちゃう…'], ['Yawn… so sleepy. Play tomorrow?', 'My eyes are closing…']),
  full: L(['吃飽飽了嗎？太好了！', '你吃飽了，我也好開心'], ['おなかいっぱい？よかった！', 'あなたがおなかいっぱいだと、わたしもうれしい'], ["You're full? Yay!", "I'm happy when you're full"]),
  tasty: L(['好好吃嗎？我也想吃一口！', '看起來好好吃喔！'], ['おいしい？わたしもひとくち！', 'おいしそう〜！'], ['Yummy? Can I have a bite?', 'That looks so tasty!']),
  hungry: L(['我也想吃點心！', '肚子咕嚕咕嚕～'], ['わたしもおやつたべたい！', 'おなかぐーぐー〜'], ['I want a snack too!', 'My tummy is rumbling~']),
  name: L(['我是{n}！', '我叫{n}，請多指教！'], ['{n}だよ！', '{n}っていうの、よろしくね！'], ["I'm {n}!", 'My name is {n}, nice to meet you!']),
  sick: L(['生病了嗎？要多喝水、好好休息喔', '我陪著你，快點好起來！'], ['びょうき？おみずのんで、ゆっくりやすんでね', 'そばにいるよ、はやくよくなってね'], ['Are you sick? Drink water and rest, okay?', "I'm here with you. Get well soon!"]),
  cold: L(['好冷喔！要穿外套喔', '來，我幫你取暖！'], ['さむいね！あったかくしてね', 'くっついたらあったかいよ！'], ["Brr! Put on a jacket, okay?", "Come here, I'll keep you warm!"]),
  hot: L(['好熱喔！要記得喝水', '我幫你搧搧風！呼呼～', '來吃冰涼涼的水果吧！', '躲到陰涼的地方休息一下'], ['あついね！おみずのんでね', 'ふーふー、かぜをおくるね！', 'つめたいくだものたべよう！', 'ひかげでひとやすみしよう'], ["It's hot! Remember to drink water", "I'll fan you! Whoosh~", "Let's eat some cold fruit!", "Let's rest in the shade"]),
  rain: L(['下雨了！要帶雨傘喔', '雨滴滴答答，好像在唱歌', '下雨天就在家裡玩吧！', '雨停了說不定會有彩虹喔'], ['あめだね！かさをもっていってね', 'ぽつぽつ、あめがうたってるみたい', 'あめのひは、おうちであそぼう！', 'あめがやんだら、にじがでるかも'], ["It's raining! Take an umbrella", 'Drip drop, the rain is singing', "Rainy day? Let's play inside!", 'Maybe a rainbow after the rain!']),
  scared: L(['不怕不怕，我在這裡保護你', '抱抱就不可怕了'], ['こわくないよ、わたしがまもるからね', 'ぎゅーってしたら、こわくないよ'], ["Don't be scared, I'll protect you", "A hug makes it less scary"]),
  hurt: L(['痛痛飛走！痛痛飛走！', '哪裡痛？我幫你呼呼'], ['いたいのいたいの、とんでいけー！', 'どこがいたいの？ふーふーしてあげる'], ['Pain, pain, fly away!', "Where does it hurt? I'll blow on it"]),
  sad: L(['沒關係，我陪你', '抱抱，你很棒喔', '想哭就哭，我會一直陪著你'], ['だいじょうぶ、そばにいるよ', 'ぎゅー、がんばったね', 'ないてもいいよ、ずっといっしょだよ'], ["It's okay, I'm here with you", "Hugs! You're doing great", "It's okay to cry. I'm staying with you"]),
  happy: L(['你開心我也好開心！', '耶！一起開心！', '你笑起來好好看喔！'], ['あなたがうれしいと、わたしもうれしい！', 'やったー！いっしょにうれしい！', 'あなたのえがお、とってもすてき！'], ["If you're happy, I'm happy too!", "Yay! Let's be happy together!", 'Your smile is so pretty!']),
  angry: L(['深呼吸～呼～吸～，好一點了嗎？', '生氣的時候，我陪你一起靜一靜'], ['しんこきゅう〜すーはー、すこしおちついた？', 'おこったときは、いっしょにおちつこうね'], ['Deep breath~ in… out… Better?', "When you're angry, let's calm down together"]),
  bath: L(['洗澡澡！泡泡好好玩！', '洗香香，等一下再來找我喔'], ['おふろ！あわあわたのしいね！', 'きれいになったら、またあそんでね'], ['Bath time! Bubbles are fun!', 'Get all clean and come back to me']),
  brush: L(['刷刷刷！牙齒亮晶晶！', '上面刷一刷，下面刷一刷', '刷完牙，笑起來最漂亮！', '裡面的牙齒也要刷喔'], ['しゃかしゃか！はがピカピカ！', 'うえもしたも、しゃかしゃか', 'はみがきしたら、えがおがピカピカ！', 'おくのはも、わすれずにね'], ['Brush brush! Sparkly teeth!', 'Brush the top, brush the bottom', 'Clean teeth make the best smile!', "Don't forget the back teeth!"]),
  school: L(['今天在學校學了什麼？', '老師好嗎？要跟我說喔！', '寫作業加油！我在旁邊陪你', '今天有交到新朋友嗎？'], ['きょうはがっこうでなにをならったの？', 'せんせいげんき？おしえてね！', 'しゅくだいがんばって！そばにいるよ', 'きょう、あたらしいともだちできた？'], ['What did you learn at school today?', 'Tell me about your teacher!', "Good luck with homework! I'm here", 'Did you make a new friend today?']),
  friend: L(['我們是最好的朋友！', '朋友越多越開心！', '下次介紹朋友給我認識嘛！', '你的朋友也是我的朋友！'], ['わたしたち、なかよしだね！', 'ともだちがいっぱいだとたのしいね！', 'こんど、ともだちをしょうかいしてね！', 'あなたのともだちは、わたしのともだち！'], ["We're best friends!", 'More friends, more fun!', 'Let me meet your friends someday!', 'Your friends are my friends too!']),
  fly: L(['飛高高囉～咻！', '看我飛到最高！', '我要飛去摸雲朵！', '風吹過來好舒服喔'], ['たかいたかーい！びゅーん！', 'いちばんたかくとぶよ！', 'くもにさわりにいくよ！', 'かぜがきもちいいね'], ['Up, up, and away! Whoosh!', 'Watch me fly the highest!', "I'm flying up to touch the clouds!", 'The wind feels so nice']),
  come: L(['來了來了！', '飛過去囉～', '等我一下，馬上到！', '我飛到你身邊囉'], ['いまいくよ！', 'とんでいくね〜', 'ちょっとまってね、すぐいくよ！', 'あなたのそばまでとんできたよ'], ['Coming, coming!', 'Flying over~', 'Wait for me, almost there!', "I'm here next to you now"]),
  repeat: L(['你一直說這個耶，好好笑！', '我聽到了啦～嘿嘿'], ['それ、なんかいも言ってるよ！', 'きこえてるよ〜えへへ'], ["You keep saying that! So funny!", 'I heard you~ hehe']),
};

/** 依個性的台詞（跟大家的台詞一起抽，出現機率比較高） */
const BY_PERSONALITY: Record<Personality, Partial<Record<Reply, Lines>>> = {
  guardian: {
    greet: L(['你好！今天我也會好好守護你'], ['こんにちは！きょうもまもってあげるね'], ["Hello! I'll watch over you today too"]),
    love: L(['我會一直保護你的！'], ['ずっとまもってあげるね！'], ["I'll always protect you!"]),
    sad: L(['有我在，什麼都不用怕'], ['わたしがいるから、だいじょうぶ'], ["I'm here, nothing to worry about"]),
    scared: L(['我會守在你身邊，一步都不離開'], ['ずっとそばでまもってるからね'], ["I'll stay right by your side"]),
    hurt: L(['讓我看看！要小心一點喔'], ['みせて！きをつけてね'], ['Let me see! Please be careful']),
    night: L(['你先睡，我幫你守夜'], ['さきにねていいよ、みはってるから'], ["You sleep, I'll keep watch"]),
    goOut: L(['路上要小心車子喔！'], ['くるまにきをつけてね！'], ['Watch out for cars!']),
    home: L(['你平安回來了，太好了'], ['ぶじにかえってきてよかった'], ["You're home safe, I'm so glad"]),
    howAreYou: L(['我很好！你今天有沒有累到？'], ['げんきだよ！あなたはつかれてない？'], ["I'm fine! Are you tired today?"]),
    doing: L(['我在守護這個家呀'], ['このおうちをまもってたの'], ['Guarding our home']),
    sick: L(['我會一直在旁邊照顧你'], ['ずっとそばでかんびょうするね'], ["I'll take care of you"]),
    cold: L(['要蓋好被子，不要感冒喔'], ['ふとんをかけて、かぜひかないでね'], ["Stay under the blanket, don't catch a cold"]),
  },
  brave: {
    greet: L(['嗨！今天要去哪裡冒險？'], ['やあ！きょうはどこへぼうけんする？'], ['Hi! Where shall we adventure today?']),
    play: L(['來比賽！我一定會贏！'], ['しょうぶだ！ぜったいかつよ！'], ["Let's race! I'll win for sure!"]),
    scared: L(['有什麼好怕的！我來打倒它！'], ['こわくない！わたしがやっつける！'], ["Nothing to fear! I'll beat it!"]),
    proud: L(['太強了！下一關也衝吧！'], ['つよい！つぎもいこう！'], ["So strong! On to the next level!"]),
    fly: L(['我要飛得比老鷹還高！'], ['ワシよりたかくとぶよ！'], ['I’ll fly higher than an eagle!']),
    rain: L(['下雨也不怕！我們去踩水坑！'], ['あめでもへいき！みずたまりであそぼう！'], ["Rain can't stop us! Let's jump in puddles!"]),
    hurt: L(['勇敢的人也會痛，休息一下再出發！'], ['いたいのはがんばったしょうこ！'], ['Even heroes get hurt. Rest, then go again!']),
    cheer: L(['好！看我的！衝啊！'], ['よーし！いくぞー！'], ["Alright! Watch me! Charge!"]),
    doing: L(['我在練習飛得更快！'], ['もっとはやくとぶれんしゅう！'], ['Practicing flying faster!']),
    likes: L(['我最喜歡冒險和挑戰！'], ['ぼうけんとチャレンジがだいすき！'], ['I love adventures and challenges!']),
  },
  cautious: {
    greet: L(['你、你好…今天也請溫柔一點喔'], ['こ、こんにちは…'], ['H-hello…']),
    love: L(['真、真的嗎？我好開心…'], ['ほ、ほんと？うれしい…'], ['R-really? I’m so happy…']),
    scared: L(['我、我也好怕…我們抱在一起好不好'], ['わ、わたしもこわい…くっついていよう？'], ["I-I'm scared too… let's stay together"]),
    rain: L(['打雷了嗎…我躲在你旁邊'], ['かみなり…？そばにかくれるね'], ['Is that thunder…? I’ll hide by you']),
    play: L(['好…可是要慢慢玩喔'], ['うん…でもゆっくりね'], ['Okay… but let’s go slowly']),
    mean: L(['嗚…這樣說我會難過…'], ['うぅ…かなしくなっちゃう…'], ['Sniff… that makes me sad…']),
    where: L(['我、我在這裡…剛剛躲起來了'], ['こ、ここだよ…かくれてたの'], ['I-I’m here… I was hiding']),
    doing: L(['我在偷偷看你…'], ['こっそりあなたをみてたの…'], ['Just quietly watching you…']),
    night: L(['晚安…可以留一盞小燈嗎？'], ['おやすみ…でんきつけておいてね？'], ['Good night… can we leave a little light on?']),
    goOut: L(['要、要早點回來喔…'], ['は、はやくかえってきてね…'], ['P-please come back soon…']),
  },
  playful: {
    greet: L(['嗨嗨嗨！來玩來玩！'], ['やっほーやっほー！あそぼう！'], ["Hi hi hi! Let's play!"]),
    play: L(['耶！我最愛玩了！'], ['やったー！あそぶのだいすき！'], ['Yay! Playing is my favorite!']),
    dance: L(['轉圈圈～跳舞最好玩了！'], ['くるくる〜おどるのだいすき！'], ['Spinning~ dancing is the best!']),
    sing: L(['啦啦啦～你也一起拍手！'], ['ららら〜てをたたいて！'], ['La la la~ clap your hands!']),
    joke: L(['我學青蛙叫：呱呱！哈哈哈！'], ['カエルのまね：ケロケロ！あはは！'], ['I’m a frog: ribbit ribbit! Hahaha!']),
    bath: L(['泡泡大戰！嘩啦嘩啦！'], ['あわあわたいかい！じゃぶじゃぶ！'], ['Bubble battle! Splash splash!']),
    doing: L(['我在想下一個遊戲！'], ['つぎのあそびをかんがえてたの！'], ['Thinking up our next game!']),
    likes: L(['我喜歡玩遊戲、跳舞，還有搔癢！'], ['ゲームとダンスとくすぐりがすき！'], ['I like games, dancing, and tickles!']),
    bye: L(['掰掰～回來要再陪我玩喔！'], ['バイバイ〜またあそんでね！'], ['Bye~ play with me again later!']),
    happy: L(['耶耶耶！開心到要轉十圈！'], ['わーいわーい！じゅっかいまわっちゃう！'], ["Yay yay yay! I'm spinning ten times!"]),
  },
};

export function talkLine(reply: Reply, lang: Lang, name: string, personality: Personality = 'guardian', rnd = Math.random): string {
  const own = BY_PERSONALITY[personality][reply]?.[lang] ?? [];
  const pool = [...TALK_LINES[reply][lang], ...own, ...own];
  return pickFresh(`talk|${reply}|${lang}|${personality}`, pool, rnd).replaceAll('{n}', name);
}

/** 全部的台詞（事先做神經語音用；有名字 {n} 的句子不算） */
export function allTalkLines(): [Lang, string][] {
  const out: [Lang, string][] = [];
  const add = (lines: Lines) => {
    for (const lang of Object.keys(lines) as Lang[]) for (const t of lines[lang]) if (!t.includes('{n}')) out.push([lang, t]);
  };
  for (const v of Object.values(TALK_LINES)) add(v);
  for (const byReply of Object.values(BY_PERSONALITY)) for (const v of Object.values(byReply)) if (v) add(v);
  return out;
}
