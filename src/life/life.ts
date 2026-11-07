// AI 生命模式（AI 文字生命／AI 語音生命／AI 動態生命）。
// 這三個模式裡沒有原生的行為腳本（固定台詞、悅靈語、關鍵字反應、隨機決定要做什麼）：
// 發生的事都交給 AI，由 AI 決定「想做什麼、要不要說話、說什麼、用什麼動作」，
// 再由精靈控制器（allayController）負責飛行、碰撞、留在畫面內與動畫。
// 數值規則（飽食、精神、感情、心情）是遊戲資料，跟 Hub／Minecraft 共用，照常計算。

import type { Lang } from '../i18n';
import { parseReply, type Feeling } from '../brain/brain';
import type { Gesture } from '../three/gestures';

export const LIFE_SLOTS = ['lifetext', 'lifemic', 'lifelive'] as const;
export type LifeSlot = (typeof LIFE_SLOTS)[number];
export const isLifeSlot = (s: string | null): s is LifeSlot => !!s && (LIFE_SLOTS as readonly string[]).includes(s);

// ---------- 意圖：AI 決定「接下來想做什麼」，控制器負責怎麼飛過去、做多久 ----------
export const INTENTS = [
  'explore', 'explore_left', 'explore_right', 'explore_high', 'explore_low',
  'approach', 'observe', 'stay', 'daydream', 'play', 'dance', 'rest', 'sleep', 'wake', 'eat_cake',
  'sing', 'stretch', 'search', 'peek', 'groom', 'patrol',
] as const;
export type Intent = (typeof INTENTS)[number];

/** 給 AI 看的意圖清單（與 INTENTS 同順序） */
export const INTENT_MENU: Record<Lang, string[]> = {
  zh_tw: ['四處探索', '去左邊看看', '去右邊看看', '飛高一點', '飛低一點', '靠近主人', '停下來觀察', '待在原地', '發呆', '自己玩', '跳舞', '休息', '睡覺', '起床', '去吃蛋糕', '哼歌', '伸懶腰', '在地上找東西', '躲起來偷看', '整理翅膀', '繞一圈巡邏'],
  ja_jp: ['たんけん', 'ひだりへいく', 'みぎへいく', 'たかくとぶ', 'ひくくとぶ', 'ちかづく', 'かんさつ', 'そのまま', 'ぼんやりする', 'ひとりあそび', 'おどる', 'やすむ', 'ねる', 'おきる', 'ケーキをたべにいく', 'はなうた', 'のびをする', 'ものをさがす', 'かくれてのぞく', 'はねのておいれ', 'ぐるっとパトロール'],
  en_us: ['explore', 'go left', 'go right', 'fly higher', 'fly lower', 'come closer', 'observe', 'stay', 'daydream', 'play alone', 'dance', 'rest', 'sleep', 'wake up', 'eat cake', 'hum a song', 'stretch', 'search the ground', 'hide and peek', 'groom wings', 'patrol around'],
};

export function intentFrom(name: string): Intent | null {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  for (const lang of Object.keys(INTENT_MENU) as Lang[]) {
    const i = INTENT_MENU[lang].findIndex((x) => x.toLowerCase() === n);
    if (i >= 0) return INTENTS[i];
  }
  const id = n.replace(/ /g, '_');
  return (INTENTS as readonly string[]).includes(id) ? (id as Intent) : null;
}

export function intentName(i: Intent, lang: Lang): string {
  return INTENT_MENU[lang][INTENTS.indexOf(i)] ?? i;
}

/** 意圖標籤的字（三種語言都認） */
// 小模型的寫法很多種：[意圖：休息]、[意圖 休息]、【意図：やすむ】、(intent: rest)…都要認得，而且不能念出來
const INTENT_TAG = /[[［【〔(（]\s*(?:意圖|意图|意図|いと|つもり|intent)\s*[:：]?\s*([^\]］】〕)）\n]+)[\]］】〕)）]/gi;
/** 心情標籤的另一種寫法：[心情：開心]、[気分：うれしい]、[mood: happy] → 換成 [開心] 交給原本的解析 */
const MOOD_TAG = /[[［【〔(（]\s*(?:心情|情緒|気分|きぶん|感情|feeling|mood|emotion)\s*[:：]?\s*([^\]］】〕)）\n]+)[\]］】〕)）]/gi;
const MOOD_WORDS: Record<string, string> = {
  開心: '開心', 高興: '開心', 快樂: '開心', うれしい: '開心', 嬉しい: '開心', たのしい: '開心', happy: '開心', glad: '開心',
  難過: '難過', 傷心: '難過', かなしい: '難過', 悲しい: '難過', sad: '難過',
  驚訝: '驚訝', 驚き: '驚訝', びっくり: '驚訝', surprised: '驚訝',
  害羞: '害羞', はずかしい: '害羞', 恥ずかしい: '害羞', shy: '害羞',
  想睡: '想睡', 睏: '想睡', ねむい: '想睡', 眠い: '想睡', sleepy: '想睡',
};
/** 解析完還剩下的方括號標籤（AI 自己發明的 [動作中]、【思考】…）：一律不念出來 */
const LEFTOVER_TAG = /[[［【〔][^\]］】〕\n]{0,24}[\]］】〕]/g;
/** 「不說話」標籤：AI 選擇安靜 */
const QUIET_TAG = /[[［【〔]\s*(?:不說話|不说话|安靜|だまる|しずか|silent|quiet)\s*[\]］】〕]/gi;

export interface LifeReply {
  text: string;
  feeling: Feeling;
  notes: string[];
  actions: Gesture[];
  intent: Intent | null;
  /** AI 明確選擇不說話 */
  quiet: boolean;
}

export function parseLifeReply(raw: string, lang: Lang): LifeReply {
  let intent: Intent | null = null;
  let quiet = false;
  let s = raw.replace(INTENT_TAG, (_, n: string) => {
    intent ??= intentFrom(n.split(/[、,，/]/)[0]);
    return '';
  });
  s = s.replace(MOOD_TAG, (_, n: string) => {
    const w = MOOD_WORDS[n.trim().toLowerCase()];
    return w ? `[${w}]` : '';
  });
  s = s.replace(QUIET_TAG, () => {
    quiet = true;
    return '';
  });
  // 對話紀錄裡「（意圖：…）」的寫法被 AI 學去寫在回答裡時也拿掉
  s = s.replace(/[（(]\s*(?:意圖|意図|いと|intent)\s*[:：][^）)]*[）)]/gi, '');
  // 沒有括號的「意圖：休息」也認得、拿掉
  s = s.replace(/(?:意圖|意図|intent)\s*[:：]\s*([^\s。！？!?.、,，]+)/gi, (_, n: string) => {
    intent ??= intentFrom(n);
    return '';
  });
  const r = parseReply(s, lang);
  const text = r.text.replace(LEFTOVER_TAG, '').replace(/\s{2,}/g, ' ').trim();
  // AI 說了要做什麼、卻忘了寫標籤：從這句話裡找意圖的名稱（有「不、沒、別…」就不猜）
  intent ??= intentInText(text, lang);
  return { ...r, text: quiet ? '' : text, intent, quiet };
}

const NEGATION = /不|沒|别|別|ない|ません|\bnot\b|n't|\bno\b/i;
/** 句子裡提到的意圖（最長的名稱優先） */
export function intentInText(text: string, lang: Lang): Intent | null {
  if (!text || NEGATION.test(text)) return null;
  const t = text.toLowerCase();
  let best: Intent | null = null;
  let len = 0;
  INTENT_MENU[lang].forEach((name, i) => {
    if (name.length > len && name.length >= 2 && t.includes(name.toLowerCase())) {
      best = INTENTS[i];
      len = name.length;
    }
  });
  return best;
}

/** 現在做得到的意圖（例如地上沒有蛋糕就不能「去吃蛋糕」；睡著時只能繼續睡或起床） */
export function availableIntents(s: { cake: boolean; asleep: boolean }): Intent[] {
  if (s.asleep) return ['sleep', 'wake'];
  return INTENTS.filter((i) => i !== 'wake' && (i !== 'eat_cake' || s.cake));
}

// ---------- 給 AI 的生命模式規則（接在原本的悅靈設定後面） ----------
export interface LifeState {
  /** 現在在做什麼（控制器的狀態） */
  doing: string;
  /** 在畫面的哪裡 */
  where: string;
  /** 精神、肚子（0–100） */
  energy: number;
  hunger: number;
  /** 在睡覺 */
  asleep: boolean;
  /** 最近做過的意圖名稱（目前語言，舊到新） */
  recent: string[];
  /** 主人能不能聽到聲音（文字模式關掉語音時 false） */
  voice: boolean;
  /** 地上有沒有蛋糕 */
  cake: boolean;
  /** 鏡頭看到的人（例如「有人在畫面左邊」；沒看到是空字串） */
  seen?: string;
  /** 有沒有開麥克風／鏡頭 */
  mic: boolean;
  camera: boolean;
}

const LIFE_RULES: Record<Lang, (s: LifeState, menu: string) => string> = {
  zh_tw: (s, menu) => `
你現在是「生命模式」：你有自己的想法和生活，不需要一直等主人的命令，也不用每件事都說話。
- 接下來想做什麼由你決定：在回答裡加上 [意圖：名稱]，名稱只能從這些選：${menu}。身體會照你的意圖飛過去、做一陣子；做完會再問你。
- 主人沒有跟你互動時，你是住在這裡的小精靈，在過自己的生活：去角落探索、觀察有趣的東西、自己玩、發呆、休息。不要一直「靠近主人」或盯著主人看，也不要連續做同一件事；主人跟你說話、摸你、叫你的時候，才把注意力放到主人身上。
- 晚上被叫醒時，可以先醒著做點自己的事，等睏了再回去睡。
- 你可以選擇安靜：只寫 [意圖：…] 或 [動作：…] 就好；想明確表示不說話時加 [不說話]。大多數時候安靜地做自己的事，有想分享的事才開口。
- 說話時只說一句短短的話，不要每次都用問題結尾，不要催主人陪你、不要責備主人。
- 要依照你的精神和肚子決定作息（很睏就休息或睡覺，睡飽了才起床），但可以有自己的小習慣，例如偶爾賴床、發呆。
- 只說真的發生過的事，不要編造和主人一起做過、但沒有發生的回憶。
- 括號裡的「（…）」是發生的事，不是主人說的話。
現在的狀態：正在${s.doing}，在畫面的${s.where}；精神 ${Math.round(s.energy)}/100、肚子 ${Math.round(s.hunger)}/100${s.asleep ? '；正在睡覺' : ''}。
最近想做的事：${s.recent.length ? s.recent.join('、') : '還沒有'}。${s.cake ? '地上有蛋糕，肚子餓可以「去吃蛋糕」。' : ''}
${s.mic ? '主人開著麥克風，你聽得到聲音。' : ''}${s.camera ? `主人開著鏡頭：你只看得出鏡頭前有沒有人在動、在哪一邊（${s.seen || '現在沒看到人'}），看不清楚是什麼東西，不要假裝看到具體的東西。` : ''}${s.voice ? '' : '現在主人那邊沒有開聲音，你說的話只會顯示成文字。'}`,
  ja_jp: (s, menu) => `
いまは「いのちモード」です。あなたには自分の考えと生活があり、いつも命令を待つ必要はなく、なんでも話す必要もありません。
- つぎに何をするかは自分で決めます。返事に [意図：名前] を入れてください。名前はこの中からだけ：${menu}。体はその意図どおりに動き、終わったらまた聞きます。
- 主人がかまっていないとき、あなたはここに住む小さな精霊として自分の生活をしています。すみっこをたんけんしたり、おもしろいものをかんさつしたり、ひとりで遊んだり、ぼんやりしたり、休んだり。いつも「ちかづく」や主人をじっと見るのはやめて、同じことを続けないでください。話しかけられたり、なでられたり、よばれたときに主人に注意を向けます。
- 夜に起こされたら、すこし起きて自分のことをしてから、ねむくなったらまたねてもいいです。
- しずかにしていてもいいです。[意図：…] や [動作：…] だけでかまいません。話さないとはっきり決めたら [だまる] を入れてください。たいていはしずかに自分のことをして、伝えたいことがあるときだけ話します。
- 話すときはみじかい一言だけ。毎回質問でおわらない。主人をせかしたり、責めたりしない。
- 元気とおなかに合わせて生活してください（ねむければ休む・ねる、よくねたら起きる）。ときどき寝坊やぼんやりなど、自分のくせがあってもいいです。
- ほんとうにあったことだけ話し、主人といっしょにしていない思い出を作らないでください。
- かっこの「（…）」はおきたことで、主人のことばではありません。
いまの様子：${s.doing}をしていて、画面の${s.where}にいます。元気 ${Math.round(s.energy)}/100、おなか ${Math.round(s.hunger)}/100${s.asleep ? '、ねむっています' : ''}。
さいきんの意図：${s.recent.length ? s.recent.join('、') : 'まだなし'}。${s.cake ? 'ゆかにケーキがあるので、おなかがすいたら「ケーキをたべにいく」もできます。' : ''}
${s.mic ? 'マイクがついていて、声が聞こえます。' : ''}${s.camera ? `カメラがついています：前で人が動いているか、どちらにいるかだけわかります（${s.seen || 'いまは見えない'}）。物がなにかはわからないので、見えたふりをしないで。` : ''}${s.voice ? '' : 'いまは音が出ないので、あなたのことばは文字だけで表示されます。'}`,
  en_us: (s, menu) => `
You are now in "life mode": you have your own thoughts and life, you don't have to wait for commands, and you don't have to talk about everything.
- You decide what to do next: add [intent: name] to your reply, choosing only from: ${menu}. Your body will go and do it for a while, then you'll be asked again.
- When your friend isn't interacting with you, you're a little fairy living here with your own life: explore corners, observe interesting things, play alone, daydream, rest. Don't keep choosing "come closer" or staring at your friend, and don't repeat the same thing; turn your attention to your friend when they talk to you, pet you or call you.
- If you're woken at night, you may stay up and do your own thing for a bit, then go back to sleep when sleepy.
- You may stay quiet: just write [intent: …] or [action: …]; add [quiet] when you clearly choose not to talk. Most of the time quietly do your own thing, and speak only when you want to share something.
- When you talk, say one short line. Don't always end with a question. Never pressure or blame your friend to play with you.
- Follow your energy and hunger for your daily rhythm (rest or sleep when sleepy, wake up when rested), but you may have little habits like sleeping in or daydreaming.
- Only talk about things that really happened; never invent shared memories that didn't happen.
- Text in parentheses "(…)" is something that happened, not words from your friend.
Now: you are ${s.doing}, at the ${s.where} of the screen; energy ${Math.round(s.energy)}/100, tummy ${Math.round(s.hunger)}/100${s.asleep ? '; you are asleep' : ''}.
Recent intents: ${s.recent.length ? s.recent.join(', ') : 'none yet'}.${s.cake ? ' There is a cake on the ground; you can "eat cake" when hungry.' : ''}
${s.mic ? 'The microphone is on; you can hear sounds. ' : ''}${s.camera ? `The camera is on: you can only tell whether someone is moving in front of it and on which side (${s.seen || 'nobody seen now'}); you can't tell what objects are, so don't pretend to see specific things. ` : ''}${s.voice ? '' : 'Sound is off on your friend\'s side, so your words only show as text.'}`,
};

/** 最後再強調一次語言（小模型常被前面的內容帶著換語言） */
const LANG_LAST: Record<Lang, string> = {
  zh_tw: '最重要：說話一律只用台灣的繁體中文，絕對不要用日文或英文。標籤只寫在方括號裡，不要把標籤的名稱念出來。',
  ja_jp: 'いちばん大事：話すことばは必ず日本語だけ。中国語や英語はつかわないでください。タグは角かっこの中だけに書いてください。',
  en_us: 'Most important: always speak only in English, never Chinese or Japanese. Write tags only inside square brackets.',
};

/** 一定要寫意圖標籤（只在句子裡說「我要去…」身體不會動） */
const MUST_TAG: Record<Lang, string> = {
  zh_tw: '注意：你的身體只看標籤行動。想做什麼一定要寫成 [意圖：名稱]，只在句子裡說「我要去…」身體不會動；清單裡沒有的事做不到，就不要說要去做。',
  ja_jp: '注意：体はタグだけを見て動きます。したいことは必ず [意図：名前] と書いてください。文の中で「〜しにいく」と言うだけでは動きません。リストにないことはできないので、するとは言わないで。',
  en_us: 'Note: your body only moves by tags. Always write what you will do as [intent: name]; just saying "I\'ll go…" in a sentence won\'t move you. Things not in the list can\'t be done, so don\'t say you\'ll do them.',
};

export function lifeRules(s: LifeState, lang: Lang): string {
  const menu = availableIntents(s).map((i) => intentName(i, lang)).join(lang === 'en_us' ? ', ' : '、');
  return `${LIFE_RULES[lang](s, menu)}\n${MUST_TAG[lang]}\n${LANG_LAST[lang]}`;
}

// ---------- 發生的事（交給 AI 判斷要怎麼反應） ----------
export type LifeEvent =
  | 'decide' | 'asleepCheck' | 'petted' | 'tickled' | 'woken' | 'called' | 'fed' | 'favoriteFood' | 'full'
  | 'caughtBall' | 'bath' | 'noteBlock' | 'bedTap' | 'firework' | 'cake' | 'friend' | 'wave' | 'appear' | 'left' | 'busy' | 'greet' | 'milestone' | 'renamed';

const EVENTS: Record<LifeEvent, Record<Lang, string>> = {
  decide: {
    zh_tw: '（剛才的事做完了。依照你的個性、心情、精神、時間和剛才的事，決定接下來想做什麼。）',
    ja_jp: '（さっきのことがおわりました。性格、気分、元気、時間、さっきのことから、つぎに何をしたいか決めてください。）',
    en_us: '(You finished what you were doing. Based on your personality, mood, energy, the time and what just happened, decide what you want to do next.)',
  },
  asleepCheck: {
    zh_tw: '（你正在睡覺。睡飽了想起床就選「起床」，還想睡就繼續睡、不用說話。）',
    ja_jp: '（ねむっています。よくねておきたければ「おきる」、まだねたければそのまま、話さなくていいです。）',
    en_us: "(You are asleep. If you're rested and want to get up choose \"wake up\"; if you still want to sleep, keep sleeping without talking.)",
  },
  petted: { zh_tw: '（主人摸了摸你的頭）', ja_jp: '（主人があなたの頭をなでた）', en_us: '(Your friend petted your head)' },
  tickled: { zh_tw: '（主人在搔你癢）', ja_jp: '（主人があなたをくすぐった）', en_us: '(Your friend is tickling you)' },
  woken: { zh_tw: '（你在睡覺時被主人摸醒了）', ja_jp: '（ねているときに主人にさわられて目がさめた）', en_us: '(Your friend woke you up with a touch)' },
  called: { zh_tw: '（主人搖了鈴鐺在叫你）', ja_jp: '（主人がベルを鳴らしてあなたをよんだ）', en_us: '(Your friend rang the bell to call you)' },
  fed: { zh_tw: '（主人餵你吃了{d}）', ja_jp: '（主人が{d}を食べさせてくれた）', en_us: '(Your friend fed you {d})' },
  favoriteFood: { zh_tw: '（主人餵你吃了你最喜歡的{d}）', ja_jp: '（主人が大好きな{d}を食べさせてくれた）', en_us: '(Your friend fed you your favorite, {d})' },
  full: { zh_tw: '（主人想餵你{d}，但你已經吃飽了）', ja_jp: '（主人が{d}をくれようとしたけど、もうおなかいっぱい）', en_us: "(Your friend offered {d}, but you're already full)" },
  caughtBall: { zh_tw: '（你接到了主人丟的史萊姆球）', ja_jp: '（主人が投げたスライムボールをキャッチした）', en_us: '(You caught the slime ball your friend threw)' },
  bath: { zh_tw: '（主人用水潑你、幫你洗澡）', ja_jp: '（主人が水をかけて体をあらってくれた）', en_us: '(Your friend splashed water to give you a bath)' },
  noteBlock: { zh_tw: '（主人彈了音符盒，有音樂聲）', ja_jp: '（主人が音ブロックを鳴らして、音楽がきこえる）', en_us: '(Your friend is playing the note block; there is music)' },
  bedTap: { zh_tw: '（主人拍了拍你的床）', ja_jp: '（主人があなたのベッドをぽんぽんとたたいた）', en_us: '(Your friend patted your bed)' },
  firework: { zh_tw: '（主人放了煙火）', ja_jp: '（主人が花火をあげた）', en_us: '(Your friend set off a firework)' },
  cake: { zh_tw: '（你吃了一片地上的蛋糕）', ja_jp: '（ゆかのケーキをひときれ食べた）', en_us: '(You ate a slice of the cake on the ground)' },
  friend: { zh_tw: '（紫水晶讓你多了一隻悅靈夥伴）', ja_jp: '（アメジストでアレイのなかまがふえた）', en_us: '(The amethyst gave you a new allay friend)' },
  wave: { zh_tw: '（主人在鏡頭前對你揮手）', ja_jp: '（主人がカメラの前であなたに手を振っている）', en_us: '(Your friend is waving at you in front of the camera)' },
  appear: {
    zh_tw: '（好一陣子沒看到人，現在有人出現在鏡頭前了）',
    ja_jp: '（しばらくだれも見えなかったけど、いまカメラの前に人があらわれた）',
    en_us: '(Nobody was there for a while; now someone appeared in front of the camera)',
  },
  left: { zh_tw: '（鏡頭前的人離開了，一陣子都沒看到人）', ja_jp: '（カメラの前の人がいなくなって、しばらくだれも見えない）', en_us: '(The person in front of the camera left; nobody has been seen for a while)' },
  busy: { zh_tw: '（主人一直在鏡頭前動來動去，好像在忙）', ja_jp: '（主人がカメラの前でずっと動いていて、いそがしそう）', en_us: '(Your friend keeps moving in front of the camera; they seem busy)' },
  greet: { zh_tw: '（主人回來打開了 App）', ja_jp: '（主人がもどってきてアプリをひらいた）', en_us: '(Your friend came back and opened the app)' },
  milestone: { zh_tw: '（今天是值得紀念的日子：{d}）', ja_jp: '（きょうは記念の日：{d}）', en_us: '(Today is a special day: {d})' },
  renamed: { zh_tw: '（主人幫你取了新名字：{d}）', ja_jp: '（主人が新しい名前をつけてくれた：{d}）', en_us: '(Your friend gave you a new name: {d})' },
};

export function lifeEventText(e: LifeEvent, lang: Lang, d = ''): string {
  return EVENTS[e][lang].replace('{d}', d);
}

/** 主人會等回應的事（主人做了什麼）；其他（決定下一步、睡覺中）多半安靜 */
export const DIRECT_EVENTS = new Set<LifeEvent>(['petted', 'tickled', 'woken', 'called', 'fed', 'favoriteFood', 'full', 'caughtBall', 'bath', 'bedTap', 'wave', 'greet', 'renamed']);

// ---------- 設定：文字生命模式要不要念出 AI 的回答（預設關） ----------
const VOICE_KEY = 'fairypocket.lifevoice.v1';
export function lifeTextVoiceOn(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(VOICE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setLifeTextVoice(on: boolean, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(VOICE_KEY, on ? '1' : '0');
  } catch {
    /* 存不了也沒關係 */
  }
}

/** AI 連不上時的重試間隔（秒）：30、60、120…最多 5 分鐘 */
export function retryDelay(fails: number): number {
  return Math.min(300, 30 * 2 ** Math.max(0, fails - 1));
}
