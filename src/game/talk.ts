// 跟悅靈說話（麥克風模式）：把聽到的話轉成文字，找出關鍵字判斷意思，選一句合適的話回答。
// 規則由上往下比對，先比對「比較長、意思比較特別」的說法，例如「你太安靜了」要在「安靜」前面，
// 才不會把「你太安靜了」（希望悅靈多說話）當成「安靜一點」（希望悅靈小聲）。
// 以後可以把 detectIntent 換成本機 AI，回答的部分不用改。

import type { Lang } from '../i18n';
import { normalizeSpeech } from './stickers';

export type Intent =
  | 'tooQuiet' | 'quiet' | 'notCute' | 'love' | 'greet' | 'night' | 'bye' | 'thanks'
  | 'praise' | 'dance' | 'hungry' | 'name' | 'sad' | 'play' | 'morning';

/** 意思 → 各語言的關鍵字（順序就是比對的優先順序） */
const RULES: [Intent, Record<Lang, string[]>][] = [
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
  ['love', {
    zh_tw: ['喜歡你', '愛你', '好可愛', '可愛', '最喜歡', '抱抱'],
    ja_jp: ['すき', '好き', 'かわいい', '可愛い', 'あいしてる', 'だいすき'],
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
  ['bye', {
    zh_tw: ['掰掰', '拜拜', '再見', '再见', '我要走了'],
    ja_jp: ['バイバイ', 'ばいばい', 'またね', 'さようなら', 'いってきます'],
    en_us: ['bye', 'see you', 'goodbye'],
  }],
  ['greet', {
    zh_tw: ['你好', '哈囉', '哈喽', '嗨', '午安', '我回來了'],
    ja_jp: ['こんにちは', 'こんばんは', 'やあ', 'ハロー', 'ただいま'],
    en_us: ['hello', 'hi', 'hey', "i'm home", 'good afternoon'],
  }],
  ['thanks', {
    zh_tw: ['謝謝', '谢谢', '感謝'],
    ja_jp: ['ありがとう'],
    en_us: ['thank'],
  }],
  ['praise', {
    zh_tw: ['好棒', '很棒', '厲害', '好乖', '做得好', '讚'],
    ja_jp: ['すごい', 'えらい', 'いいね', 'じょうず', '上手'],
    en_us: ['good job', 'great', 'awesome', 'well done', 'good girl', 'good boy', 'amazing'],
  }],
  ['dance', {
    zh_tw: ['跳舞', '唱歌', '轉圈'],
    ja_jp: ['おどって', '踊って', 'うたって', '歌って', 'ダンス'],
    en_us: ['dance', 'sing', 'spin'],
  }],
  ['play', {
    zh_tw: ['來玩', '一起玩', '玩遊戲', '好無聊'],
    ja_jp: ['あそぼう', '遊ぼう', 'あそんで', 'たいくつ'],
    en_us: ["let's play", 'play with me', 'bored'],
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
  ['sad', {
    zh_tw: ['難過', '不開心', '傷心', '想哭', '好累'],
    ja_jp: ['かなしい', '悲しい', 'さみしい', 'つかれた'],
    en_us: ['sad', 'lonely', 'tired', 'cry'],
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

/** 悅靈的回答（{n} 是悅靈的名字） */
export const TALK_LINES: Record<Intent, Record<Lang, string[]>> = {
  tooQuiet: {
    zh_tw: ['那我來唱歌給你聽！啦啦啦～', '我在這裡喔！要聊什麼呢？'],
    ja_jp: ['じゃあ歌っちゃう！ららら〜', 'ここにいるよ！なにをお話しする？'],
    en_us: ["Then I'll sing for you! La la la~", "I'm right here! What shall we talk about?"],
  },
  quiet: {
    zh_tw: ['好，我小聲一點…', '噓…我安靜陪你'],
    ja_jp: ['うん、しずかにするね…', 'しーっ…そばにいるね'],
    en_us: ["Okay, I'll be quiet…", 'Shh… I’ll stay quietly with you'],
  },
  notCute: {
    zh_tw: ['嗚嗚…那我要更努力！', '哼，我明明很可愛！'],
    ja_jp: ['えーん…もっとがんばる！', 'むー、かわいいもん！'],
    en_us: ["Aww… I'll try harder!", "Hmph, I'm totally cute!"],
  },
  love: {
    zh_tw: ['我也最喜歡你了！', '嘿嘿，好開心～'],
    ja_jp: ['わたしもだいすき！', 'えへへ、うれしい〜'],
    en_us: ['I love you too!', 'Hehe, that makes me happy~'],
  },
  morning: {
    zh_tw: ['早安！今天也一起加油！', '早安～睡得好嗎？'],
    ja_jp: ['おはよう！今日もいっしょにがんばろう！', 'おはよう〜よくねむれた？'],
    en_us: ["Good morning! Let's have a great day!", 'Morning~ Did you sleep well?'],
  },
  night: {
    zh_tw: ['晚安，做個好夢喔', '呼啊…我也想睡了'],
    ja_jp: ['おやすみ、いいゆめをね', 'ふわぁ…わたしもねむい'],
    en_us: ['Good night, sweet dreams', 'Yawn… I’m sleepy too'],
  },
  bye: {
    zh_tw: ['掰掰！要早點回來喔', '再見～我會等你'],
    ja_jp: ['バイバイ！はやくかえってきてね', 'またね〜まってるよ'],
    en_us: ['Bye! Come back soon', "See you~ I'll wait for you"],
  },
  greet: {
    zh_tw: ['你好呀！', '嗨嗨！我是{n}！'],
    ja_jp: ['こんにちは！', 'やっほー！{n}だよ！'],
    en_us: ['Hello!', "Hi hi! I'm {n}!"],
  },
  thanks: {
    zh_tw: ['不客氣！', '嘿嘿，能幫上忙真好'],
    ja_jp: ['どういたしまして！', 'えへへ、よかった'],
    en_us: ["You're welcome!", 'Hehe, happy to help'],
  },
  praise: {
    zh_tw: ['真的嗎？好開心！', '嘿嘿，被稱讚了～'],
    ja_jp: ['ほんと？うれしい！', 'えへへ、ほめられちゃった〜'],
    en_us: ['Really? Yay!', 'Hehe, thank you~'],
  },
  dance: {
    zh_tw: ['看我轉圈圈！', '一起跳舞吧！'],
    ja_jp: ['くるくる〜見てて！', 'いっしょにおどろう！'],
    en_us: ['Watch me spin!', "Let's dance together!"],
  },
  play: {
    zh_tw: ['好呀！要玩什麼？', '來玩！點書本可以玩小遊戲喔'],
    ja_jp: ['いいよ！なにしてあそぶ？', 'あそぼう！本のボタンでミニゲームができるよ'],
    en_us: ['Sure! What shall we play?', "Let's play! Tap the book for mini games"],
  },
  hungry: {
    zh_tw: ['我也想吃點心！', '肚子咕嚕咕嚕～'],
    ja_jp: ['わたしもおやつたべたい！', 'おなかぐーぐー〜'],
    en_us: ['I want a snack too!', 'My tummy is rumbling~'],
  },
  name: {
    zh_tw: ['我是{n}！', '我叫{n}，請多指教！'],
    ja_jp: ['{n}だよ！', '{n}っていうの、よろしくね！'],
    en_us: ["I'm {n}!", 'My name is {n}, nice to meet you!'],
  },
  sad: {
    zh_tw: ['沒關係，我陪你', '抱抱，你很棒喔'],
    ja_jp: ['だいじょうぶ、そばにいるよ', 'ぎゅー、がんばったね'],
    en_us: ["It's okay, I'm here with you", "Hugs! You're doing great"],
  },
};

export function talkLine(intent: Intent, lang: Lang, name: string, rnd = Math.random): string {
  const list = TALK_LINES[intent][lang];
  return list[Math.floor(rnd() * list.length)].replaceAll('{n}', name);
}
